package chert

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const chatID = "A0000000-0000-4000-8000-000000000001"
const publicID = "1234567890abcdef1234567890abcdef"
const msgUUID = "6f1c2b9e-3d4a-4f5b-9c8d-7e6f5a4b3c2d"
const leadUUID = "0b7e2c1d-9a8f-4e3d-8c2b-1a0f9e8d7c6b"

func client(t *testing.T, s *httptest.Server, limit int64, timeout time.Duration) *Client {
	t.Helper()
	c, e := NewClient(Config{BaseURL: s.URL, APIKey: "private-key", Tenant: "fixture", MaxResponseBytes: limit, Timeout: timeout})
	if e != nil {
		t.Fatal(e)
	}
	return c
}
func TestTypedRequests(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer private-key" || r.Header.Get("X-Chert-Tenant") != "fixture" {
			t.Error("missing auth")
		}
		var body map[string]any
		if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
			t.Error(e)
		}
		w.WriteHeader(202)
		if r.URL.Path == "/api/v1/send" {
			if r.Method != "POST" || len(body) != 3 || body["body"] != "  Café 🌅 /\r\n  " || body["idempotency_key"] != " body key " {
				t.Error("changed text")
			}
			fmt.Fprintf(w, `{"status":"queued","message_id":%q,"chat_id":%q,"lead_id":%q,"lead_created":true,"convo_id":"convo-1","phone_line_id":"line-1"}`, msgUUID, strings.ToLower(chatID), leadUUID)
			return
		}
		if r.URL.EscapedPath() != "/api/v1/chats/"+strings.ToLower(chatID)+"/messages/ABC%3A_.-/reactions" || r.Header.Get("Idempotency-Key") != "key  internal" || len(body) != 3 || body["reaction"] != "like" || body["remove"] != true || body["part_index"] != float64(0) {
			t.Error("reaction tuple drift")
		}
		fmt.Fprintf(w, `{"operation_id":%q,"chat_id":%q,"message_id":"ABC:_.-","status":"acknowledged"}`, publicID, strings.ToLower(chatID))
	}))
	defer s.Close()
	c := client(t, s, 0, 0)
	key := " body key "
	out, e := c.SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "  Café 🌅 /\r\n  ", IdempotencyKey: &key})
	if e != nil || out != (QueuedTextReceipt{true, msgUUID, strings.ToLower(chatID), "queued"}) {
		t.Fatalf("text %v %+v", e, out)
	}
	key = "key  internal"
	reaction, e := c.SendReaction(context.Background(), chatID, "ABC:_.-", ReactionRequest{Reaction: "like", Remove: true, IdempotencyKey: &key})
	if e != nil || reaction.Status != "acknowledged" {
		t.Fatalf("reaction %v", e)
	}
	if calls.Load() != 2 {
		t.Fatal("retry")
	}
}
func TestInvalidInputsZeroRequests(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer s.Close()
	c := client(t, s, 0, 0)
	for _, v := range []string{"", " \r\n\ufeff", string([]byte{255}), "x\x00y", strings.Repeat("x", 16385)} {
		if _, e := c.SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: v}); e == nil {
			t.Error("invalid text accepted")
		}
	}
	for _, v := range []string{"", strings.Repeat("x", 201), "a\x00b", string([]byte{255})} {
		if _, e := c.SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x", IdempotencyKey: &v}); e == nil {
			t.Error("invalid key accepted")
		}
	}
	for _, id := range []string{".", "..", "a/b", "abc\n", strings.Repeat("x", 161)} {
		if _, e := c.SendReaction(context.Background(), chatID, id, ReactionRequest{Reaction: "love"}); e == nil {
			t.Error("invalid ID accepted")
		}
	}
	for _, key := range []string{" key", "key ", "ü", "a\r\nb", "", strings.Repeat("x", 201)} {
		if _, e := c.SendReaction(context.Background(), chatID, "id", ReactionRequest{Reaction: "like", IdempotencyKey: &key}); e == nil {
			t.Error("invalid header accepted")
		}
	}
	for _, path := range []string{"https://foreign.test/", "//foreign.test/", "/../x", "/%2e%2e/x", "/a%2fb", "/x#x", "/x?bad=%0a", "/x%zz"} {
		if _, e := c.Request(context.Background(), "POST", path, true); e == nil {
			t.Error("unsafe path accepted")
		}
	}
	for _, v := range []struct{ chat, id, reaction string }{{"bad", "id", "love"}, {chatID, "id", "emoji"}} {
		if _, e := c.SendReaction(context.Background(), v.chat, v.id, ReactionRequest{Reaction: v.reaction}); e == nil {
			t.Error("invalid reaction accepted")
		}
	}
	if _, e := c.SendText(context.Background(), TextRequest{Phone: "1555", Body: "x"}); e == nil {
		t.Error("bad phone")
	}
	if _, e := c.Request(context.Background(), "GET", "/x", true); e == nil {
		t.Error("GET body")
	}
	if _, e := c.Request(context.Background(), "TRACE", "/x", nil); e == nil {
		t.Error("TRACE")
	}
	if calls.Load() != 0 {
		t.Fatal("invalid input reached server")
	}
}
func TestConfiguration(t *testing.T) {
	for _, base := range []string{"http://example.com", "https://key:secret@example.com", "https://example.com/?x=y", "https://example.com/#x", "https://example.com/%2fescape", "https://example.com:99999", "https://example.com/a/../b", "https://example.com\\x"} {
		if _, e := NewClient(Config{BaseURL: base, APIKey: "key"}); e == nil {
			t.Errorf("accepted %s", base)
		}
	}
	for _, cfg := range []Config{{BaseURL: "https://example.com", APIKey: "x\r\ny"}, {BaseURL: "https://example.com", APIKey: "key", Timeout: -1}, {BaseURL: "https://example.com", APIKey: "key", MaxResponseBytes: -1}} {
		if _, e := NewClient(cfg); e == nil {
			t.Error("invalid config")
		}
	}
}
func TestSentAndDuplicateReceipts(t *testing.T) {
	for _, status := range []string{"sent", "duplicate"} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.Path != "/api/v1/send" {
				t.Errorf("text target %s %s", r.Method, r.URL.Path)
			}
			fmt.Fprintf(w, `{"status":%q,"message_id":%q,"chat_id":%q,"lead_id":%q,"lead_created":false,"convo_id":"convo-1","phone_line_id":"line-1","service":"iMessage","delivered":false}`, status, msgUUID, chatID, leadUUID)
		}))
		out, e := client(t, s, 0, 0).SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x"})
		s.Close()
		if e != nil || out != (QueuedTextReceipt{true, msgUUID, chatID, status}) {
			t.Fatalf("%s receipt %v %+v", status, e, out)
		}
	}
}
func TestUnconfirmedReceipts(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"queuedAs200", `{"status":"queued","message_id":"` + msgUUID + `","chat_id":"` + chatID + `","lead_id":"` + leadUUID + `","secret":"private-key"}`, 200},
		{"sentAs202", `{"status":"sent","message_id":"` + msgUUID + `","chat_id":"` + chatID + `"}`, 202},
		{"otherStatus", `{"status":"queued","message_id":"` + msgUUID + `","chat_id":"` + chatID + `"}`, 201},
		{"unknownStatus", `{"status":"delivered","message_id":"` + msgUUID + `","chat_id":"` + chatID + `"}`, 200},
		{"nullMessageID", `{"status":"queued","message_id":null,"chat_id":"` + chatID + `"}`, 202},
		{"missingChatID", `{"status":"queued","message_id":"` + msgUUID + `"}`, 202},
		{"invalidMessageID", `{"status":"queued","message_id":"bad id","chat_id":"` + chatID + `"}`, 202},
		{"malformed", "private-key", 202}, {"array", "[]", 202},
		{"duplicate", `{"status":"queued","status":"queued","message_id":"` + msgUUID + `","chat_id":"` + chatID + `"}`, 202},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var n atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n.Add(1)
				w.Header().Set("X-Request-ID", "trace")
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer s.Close()
			_, e := client(t, s, 0, 0).SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x"})
			var api *APIError
			if !errors.As(e, &api) || api.Status != 502 || api.Code != "unconfirmed_text_outcome" || api.RequestID != "trace" || n.Load() != 1 {
				t.Fatalf("wrong failure %v", e)
			}
			if strings.Contains(fmt.Sprintf("%v %#v %+v %v %#v", e, e, e, *api, *api), "private-key") {
				t.Fatal("secret leak")
			}
		})
	}
}
func TestReactionReceiptIdentity(t *testing.T) {
	for _, tuple := range []struct{ chat, id, status string }{{chatID, "Exact", "acknowledged"}, {strings.ToLower(chatID), "exact", "acknowledged"}, {strings.ToLower(chatID), "Exact", "applied"}} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(202)
			fmt.Fprintf(w, `{"operation_id":%q,"chat_id":%q,"message_id":%q,"status":%q}`, publicID, tuple.chat, tuple.id, tuple.status)
		}))
		_, e := client(t, s, 0, 0).SendReaction(context.Background(), chatID, "Exact", ReactionRequest{Reaction: "love"})
		if e == nil {
			t.Error("accepted wrong receipt")
		}
		s.Close()
	}
}
func TestHTTPErrorAndRedirect(t *testing.T) {
	var n atomic.Int32
	foreign := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { n.Add(1) }))
	defer foreign.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/redirect" {
			http.Redirect(w, r, foreign.URL, 307)
			return
		}
		w.WriteHeader(502)
		fmt.Fprint(w, `{"error":{"code":4103,"message":"private-key"},"message_id":"`+publicID+`"}`)
	}))
	defer s.Close()
	c := client(t, s, 0, 0)
	_, e := c.Request(context.Background(), "POST", "/redirect", true)
	var api *APIError
	if !errors.As(e, &api) || api.Status != 307 || n.Load() != 0 {
		t.Fatal("redirect")
	}
	_, e = c.SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x"})
	if !errors.As(e, &api) || api.Code != "4103" || !strings.Contains(string(api.Data), publicID) {
		t.Fatal("lost error data")
	}
	if strings.Contains(fmt.Sprintf("%#v %#v", c, *c), "private-key") {
		t.Fatal("client leaked")
	}
}
func TestBoundsAndCancellation(t *testing.T) {
	t.Run("oversize", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, strings.Repeat("x", 200)) }))
		defer s.Close()
		_, e := client(t, s, 16, 0).SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x"})
		var api *APIError
		if !errors.As(e, &api) || api.Code != "unconfirmed_text_outcome" {
			t.Fatal("unbounded")
		}
	})
	for _, pre := range []bool{true, false} {
		t.Run(fmt.Sprint(pre), func(t *testing.T) {
			var n atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { n.Add(1); <-r.Context().Done() }))
			defer s.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if pre {
				cancel()
			}
			_, e := client(t, s, 0, 25*time.Millisecond).Request(ctx, "GET", "/wait", nil)
			if pre && !errors.Is(e, context.Canceled) || !pre && !errors.Is(e, context.DeadlineExceeded) {
				t.Fatalf("cancel identity %v", e)
			}
			if pre && n.Load() != 0 || n.Load() > 1 {
				t.Fatal("extra effect")
			}
		})
	}
}
func TestGenericAndJSON(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/custom/whoami" || r.URL.RawQuery != "mode=one" {
			t.Error("prefix/query")
		}
		fmt.Fprint(w, `{"value":1}`)
	}))
	defer s.Close()
	c, e := NewClient(Config{BaseURL: s.URL + "/custom", APIKey: "key"})
	if e != nil {
		t.Fatal(e)
	}
	r, e := c.Request(context.Background(), "GET", "/whoami?mode=one", nil)
	if e != nil || r.Status != 200 || string(r.Data) != `{"value":1}` {
		t.Fatal(e)
	}
	for _, raw := range []string{strings.Repeat("[", 140) + "0" + strings.Repeat("]", 140), `{"a":1,"a":2}`, "{} {}", string([]byte{255})} {
		if _, e := decodeJSON([]byte(raw)); e == nil {
			t.Error("invalid JSON accepted")
		}
	}
}

func TestConcurrentClient(t *testing.T) {
	var n atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		w.WriteHeader(202)
		fmt.Fprintf(w, `{"status":"queued","message_id":%q,"chat_id":"chat"}`, msgUUID)
	}))
	defer s.Close()
	c := client(t, s, 0, 0)
	done := make(chan error, 8)
	for range 8 {
		go func() {
			_, err := c.SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "x"})
			done <- err
		}()
	}
	for range 8 {
		if err := <-done; err != nil {
			t.Error(err)
		}
	}
	if n.Load() != 8 {
		t.Fatal("unexpected request count")
	}
}
func TestResponseBodyDeadlineAndEmpty(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/empty" {
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer s.Close()
	c := client(t, s, 0, 25*time.Millisecond)
	if _, err := c.Request(context.Background(), "GET", "/empty", nil); err != nil {
		t.Fatal(err)
	}
	_, err := c.Request(context.Background(), "GET", "/slow-body", nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("lost body timeout: %v", err)
	}
}

func TestLostAcknowledgementNeverRetries(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		if err := conn.Close(); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	key := "one-operation"
	_, err := client(t, s, 0, 0).SendReaction(context.Background(), chatID, "Exact", ReactionRequest{Reaction: "like", IdempotencyKey: &key})
	var api *APIError
	if !errors.As(err, &api) || api.Code != "request_failed" || calls.Load() != 1 {
		t.Fatalf("lost acknowledgement retried or misclassified: %v", err)
	}
}
