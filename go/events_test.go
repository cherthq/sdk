package chert

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/iotest"
	"time"
)

func TestMessagingEventRoutes(t *testing.T) {
	var calls atomic.Int32
	sub := `{"id":"sub-1","url":"https://example.com/hook","events":["message.received"],"version":"v1","is_active":true,"created_at":"now"}`
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("X-Chert-Tenant") != "tenant" {
			t.Error("auth")
		}
		w.Header().Set("X-Request-ID", "trace")
		out := ""
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/events":
			q := r.URL.Query()
			for k, v := range map[string]string{"type": "message.received", "status": "failed", "lead_id": "lead-1", "since": "2026-01-01T00:00:00Z", "cursor": "opaque+/=", "limit": "200"} {
				if q.Get(k) != v {
					t.Errorf("%s: %q", k, q.Get(k))
				}
			}
			out = `{"events":[],"next_cursor":"next","count":0,"future":true}`
		case "GET /api/v1/events/row-1":
			out = `{"id":"row-1","event_id":"different","type":"message.received","lead_id":null,"convo_id":null,"payload":{"text":"hello"},"created_at":"now","delivery":{"status":"failed","url":null,"attempts":[{"at":"now","status":null,"duration_ms":1.5,"error":"timeout"}],"delivered_at":null}}`
		case "GET /api/v1/webhook-subscriptions":
			out = `{"subscriptions":[` + sub + `]}`
		case "GET /api/v1/webhook-subscriptions/sub-1":
			out = `{"subscription":` + sub + `}`
		case "POST /api/v1/webhook-subscriptions":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if len(body) != 1 || body["url"] != "https://example.com/hook" {
				t.Errorf("create body: %v", body)
			}
			w.WriteHeader(201)
			out = `{"subscription":` + strings.TrimSuffix(sub, "}") + `,"secret":"one-time"}}`
		case "PATCH /api/v1/webhook-subscriptions/sub-1":
			b, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
			}
			if string(b) != `{"events":[],"is_active":false}` {
				t.Errorf("patch: %s", b)
			}
			out = `{"subscription":` + sub + `}`
		case "DELETE /api/v1/webhook-subscriptions/sub-1":
			out = `{"deleted":true,"id":"sub-1"}`
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL)
			w.WriteHeader(404)
			out = `{}`
		}
		if _, err := io.WriteString(w, out); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	c, err := NewClient(Config{EndpointOverride: s.URL, APIKey: "key", Tenant: "tenant"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	limit := 200
	page, err := c.ListEvents(ctx, EventListOptions{Type: "message.received", Status: "failed", LeadID: "lead-1", Since: "2026-01-01T00:00:00Z", Cursor: "opaque+/=", Limit: &limit})
	if err != nil || page.Data.NextCursor == nil || *page.Data.NextCursor != "next" || page.Response.RequestID != "trace" || !strings.Contains(string(page.Response.Data), "future") {
		t.Fatalf("page: %v", err)
	}
	event, err := c.GetEvent(ctx, "row-1")
	if err != nil || event.Data.EventID != "different" || event.Data.Delivery.Status != "failed" {
		t.Fatalf("event: %v", err)
	}
	list, err := c.ListWebhookSubscriptions(ctx)
	if err != nil || len(list.Data.Subscriptions) != 1 {
		t.Fatalf("list: %v", err)
	}
	item, err := c.GetWebhookSubscription(ctx, "sub-1")
	if err != nil || item.Data.Subscription.ID != "sub-1" {
		t.Fatalf("item: %v", err)
	}
	created, err := c.CreateWebhookSubscription(ctx, CreateWebhookSubscription{URL: "https://example.com/hook"})
	if err != nil || created.Data.Subscription.Secret != "one-time" {
		t.Fatalf("create: %v", err)
	}
	if strings.Contains(fmt.Sprintf("%+v", created), "one-time") {
		t.Fatal("secret formatting")
	}
	active := false
	events := []string{}
	if _, err := c.UpdateWebhookSubscription(ctx, "sub-1", UpdateWebhookSubscription{Events: &events, IsActive: &active}); err != nil {
		t.Fatal(err)
	}
	deleted, err := c.DeleteWebhookSubscription(ctx, "sub-1")
	if err != nil || !deleted.Data.Deleted {
		t.Fatalf("delete: %v", err)
	}
	for _, limit := range []int{0, -1, 201} {
		if _, err := c.ListEvents(ctx, EventListOptions{Limit: &limit}); err == nil {
			t.Error("invalid limit")
		}
	}
	for _, id := range []string{"", "..", "../escape", "x/y", "x?query"} {
		if _, err := c.GetEvent(ctx, id); err == nil {
			t.Error("invalid id")
		}
	}
	if calls.Load() != 7 {
		t.Fatalf("calls: %d", calls.Load())
	}
}

func TestMessagingStreamParser(t *testing.T) {
	for _, tc := range []struct {
		name, wire string
		count      int
		fail       bool
	}{
		{"fragmented", ": heartbeat\r\nevent: message\r\ndata: {\r\ndata: \"text\":\"雪🙂\"}\r\n\r\nevent: error\ndata: {\"reason\":\"wait\"}\n\nevent: close\rdata: {\"reconnect_with_since\":\"opaque\"}\r\rdata: {}\n\n", 3, false},
		{"default", "data: null\n\n", 1, false},
		{"unterminated", "data: {}", 0, false},
		{"comments", ": heartbeat\n\n", 0, false},
		{"bad-json", "data: nope\n\n", 0, true},
		{"bad-utf8", "data: \"\xff\"\n\n", 0, true},
		{"oversize", "data: " + strings.Repeat("x", 1024*1024), 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var frames []MessagingStreamFrame
			err := readMessagingStream(iotest.OneByteReader(strings.NewReader(tc.wire)), func(f MessagingStreamFrame) error { frames = append(frames, f); return nil })
			if (err != nil) != tc.fail || len(frames) != tc.count {
				t.Fatalf("frames %d err %v", len(frames), err)
			}
			if tc.name == "fragmented" && (frames[0].Event != "message" || frames[1].Event != "error" || frames[2].Event != "close" || !strings.Contains(string(frames[0].Data), "雪🙂")) {
				t.Fatal("frames changed")
			}
		})
	}
}

func TestMessagingStreamCleanup(t *testing.T) {
	for _, mode := range []string{"cancel", "callback", "close", "redirect", "content-type", "timeout", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			ended := make(chan struct{})
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				defer close(ended)
				if r.URL.Path != "/api/v1/events/stream" || r.URL.Query().Get("since") != "opaque +/=雪" || r.Header.Get("Last-Event-ID") != "" || r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("X-Chert-Tenant") != "tenant" || r.Header.Get("Accept") != "text/event-stream" {
					t.Error("stream request")
				}
				if mode == "redirect" {
					w.Header().Set("Location", "/elsewhere")
					w.WriteHeader(302)
					return
				}
				if mode == "content-type" {
					w.Header().Set("Content-Type", "application/json")
					return
				}
				w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
				wire := "data: {}\n\n"
				if mode == "close" {
					wire = "event: close\ndata: {\"reconnect_with_since\":\"token\"}\n\n"
				}
				if mode == "timeout" {
					wire = ": heartbeat\n\n"
				}
				if mode == "invalid" {
					wire = "data: not-json\n\n"
				}
				if _, err := io.WriteString(w, wire); err != nil {
					t.Error(err)
					return
				}
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer s.Close()
			cfg := Config{EndpointOverride: s.URL, APIKey: "key", Tenant: "tenant"}
			if mode == "timeout" {
				cfg.Timeout = 100 * time.Millisecond
			}
			c, err := NewClient(cfg)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			stop := errors.New("stop")
			err = c.StreamEvents(ctx, StreamEventsOptions{Since: "opaque +/=雪"}, func(f MessagingStreamFrame) error {
				if mode == "cancel" {
					cancel()
				}
				if mode == "callback" {
					return stop
				}
				return nil
			})
			if mode == "close" && err != nil || mode == "cancel" && !errors.Is(err, context.Canceled) || mode == "callback" && !errors.Is(err, stop) || (mode == "redirect" || mode == "content-type") && err == nil {
				t.Fatalf("error: %v", err)
			}
			if mode == "timeout" && !errors.Is(err, context.DeadlineExceeded) || mode == "invalid" && err == nil {
				t.Fatalf("stream failure: %v", err)
			}
			select {
			case <-ended:
			case <-time.After(time.Second):
				t.Fatal("body not closed")
			}
			if calls.Load() != 1 {
				t.Fatal("reconnected")
			}
		})
	}
}

func TestWebhookSignature(t *testing.T) {
	now := time.Unix(1800000000, 0)
	body := []byte("{\"text\": \"雪\"}\n")
	sign := func(ts string) string {
		mac := hmac.New(sha256.New, []byte("secret"))
		mac.Write([]byte(ts + "."))
		mac.Write(body)
		return "v1," + ts + "," + hex.EncodeToString(mac.Sum(nil))
	}
	for _, offset := range []int64{-301, -300, 0, 300, 301} {
		t.Run(fmt.Sprint(offset), func(t *testing.T) {
			sig := sign(fmt.Sprint(now.Unix() + offset))
			if verifyWebhookAt(body, sig, "secret", now) != (offset >= -300 && offset <= 300) {
				t.Fatal("timestamp tolerance")
			}
		})
	}
	sig := sign("1800000000")
	for _, bad := range []string{"", sig + "\n", strings.Replace(sig, "v1,", "v2,", 1), "v1,999999999999999999999999,abcd", sig[:len(sig)-1] + "z"} {
		if verifyWebhookAt(body, bad, "secret", now) {
			t.Fatal("bad signature accepted")
		}
	}
	if verifyWebhookAt(append(body, ' '), sig, "secret", now) || verifyWebhookAt(body, sig, "wrong", now) || verifyWebhookAt(body, sig, "", now) {
		t.Fatal("tampering accepted")
	}
	if !verifyWebhookAt(body, "v1,1800000000,"+strings.ToUpper(strings.Split(sig, ",")[2]), "secret", now) {
		t.Fatal("hex case")
	}
	if !VerifyWebhook(body, sign(fmt.Sprint(time.Now().Unix())), "secret") {
		t.Fatal("public verifier")
	}
}
