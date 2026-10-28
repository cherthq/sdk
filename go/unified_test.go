package chert_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	chert "github.com/cherthq/sdk/go"
)

const unifiedProject = "12345678-1234-1234-1234-123456789abc"

var unifiedToken = "chu_" + strings.Repeat("a", 43)

func descriptor(im, ft string) map[string]any {
	return map[string]any{"data": map[string]any{
		"contract": "chert-unified", "contract_version": 1,
		"auth":     map[string]any{"scheme": "Bearer", "token_prefix": "chu_", "audience": "chert.unified-api:v1", "login_url": ft + "/api/v1/cli/logins"},
		"services": map[string]any{"imessage": map[string]any{"base_url": im + "/api/v1"}, "facetime": map[string]any{"base_url": ft + "/api/v1"}},
		"scopes":   []string{"imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send", "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"},
	}}
}

func TestConnectUnifiedDiscoveryValidation(t *testing.T) {
	for _, mode := range []string{"404", "malformed", "oversize", "redirect", "contract", "version", "scheme", "prefix", "audience", "login", "im-origin", "ft-origin", "scopes", "scope-null", "scope-number", "scope-bool", "scope-object", "scope-array", "scope-duplicate", "scope-duplicate-unknown", "scope-extra"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			var origin string
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "GET" || r.URL.Path != "/api/v1/sdk/capabilities" || r.Header.Get("Authorization") != "" || r.Header.Get("X-Chert-Tenant") != "" || r.Header.Get("X-Chert-Project-ID") != "" || r.Header.Get("X-Chert-Contract") != "" {
					t.Error("discovery sent auth or wrong route")
				}
				switch mode {
				case "404":
					w.WriteHeader(404)
					return
				case "redirect":
					w.Header().Set("Location", origin+"/steal")
					w.WriteHeader(302)
					return
				case "malformed":
					if _, err := io.WriteString(w, "{"); err != nil {
						t.Error(err)
					}
					return
				case "oversize":
					_, _ = io.WriteString(w, strings.Repeat(" ", 65537))
					return // Client can close early.
				}
				envelope := descriptor(origin, origin)
				d := envelope["data"].(map[string]any)
				auth := d["auth"].(map[string]any)
				services := d["services"].(map[string]any)
				switch mode {
				case "contract":
					d["contract"] = "other"
				case "version":
					d["contract_version"] = 2
				case "scheme":
					auth["scheme"] = "Basic"
				case "prefix":
					auth["token_prefix"] = "ftu_"
				case "audience":
					auth["audience"] = "other"
				case "login":
					auth["login_url"] = "https://example.com/api/v1/cli/logins"
				case "im-origin":
					services["imessage"] = map[string]any{"base_url": "https://example.com/api/v1"}
				case "ft-origin":
					services["facetime"] = map[string]any{"base_url": "https://example.com/api/v1"}
				case "scopes":
					d["scopes"] = []string{"imessage:events:read"}
				}
				if strings.HasPrefix(mode, "scope-") {
					scopes := []any{}
					for _, scope := range d["scopes"].([]string) {
						scopes = append(scopes, scope)
					}
					switch mode {
					case "scope-null":
						scopes = append(scopes, nil)
					case "scope-number":
						scopes = append(scopes, 1)
					case "scope-bool":
						scopes = append(scopes, true)
					case "scope-object":
						scopes = append(scopes, map[string]any{})
					case "scope-array":
						scopes = append(scopes, []string{})
					case "scope-duplicate":
						scopes = append(scopes, "imessage:events:read")
					case "scope-duplicate-unknown":
						scopes = append(scopes, "future:read", "future:read")
					case "scope-extra":
						scopes = append(scopes, "future:read", "future:write")
					}
					d["scopes"] = scopes
				}
				if err := json.NewEncoder(w).Encode(envelope); err != nil {
					t.Error(err)
				}
			}))
			defer s.Close()
			origin = s.URL
			sdk, err := chert.ConnectUnified(context.Background(), chert.UnifiedSessionConfig{AccessToken: unifiedToken, ProjectID: unifiedProject, IMessageOrigin: origin, FaceTimeOrigin: origin})
			if mode == "scope-extra" {
				if err != nil || sdk == nil || calls.Load() != 1 {
					t.Fatalf("unique future scopes rejected: err=%v calls=%d", err, calls.Load())
				}
				return
			}
			var apiErr *chert.APIError
			if sdk != nil || !errors.As(err, &apiErr) || apiErr.Code != "unsupported_unified_backend" || calls.Load() != 1 {
				t.Fatalf("sdk=%v err=%v calls=%d", sdk, err, calls.Load())
			}
		})
	}
}

func TestUnifiedBothChannelsAndStreamEcho(t *testing.T) {
	for _, echo := range []string{chert.UnifiedContract, "", "wrong", "duplicate"} {
		t.Run("echo-"+echo, func(t *testing.T) {
			var calls, discovery atomic.Int32
			var imOrigin, ftOrigin string
			handler := func(isFT bool) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/api/v1/sdk/capabilities" {
						discovery.Add(1)
						if isFT || r.Header.Get("Authorization") != "" {
							t.Error("discovery auth/origin")
						}
						if err := json.NewEncoder(w).Encode(descriptor(imOrigin, ftOrigin)); err != nil {
							t.Error(err)
						}
						return
					}
					calls.Add(1)
					if r.Header.Get("Authorization") != "Bearer "+unifiedToken || r.Header.Get("X-Chert-Contract") != chert.UnifiedContract || r.Header.Get("X-Chert-Tenant") != "" {
						t.Error("unified auth scope")
					}
					project := ""
					if isFT {
						project = unifiedProject
					}
					if r.Header.Get("X-Chert-Project-ID") != project {
						t.Error("project scope")
					}
					if echo == "duplicate" {
						w.Header().Add("X-Chert-Contract", chert.UnifiedContract)
						w.Header().Add("X-Chert-Contract", chert.UnifiedContract)
					} else if echo != "" {
						w.Header().Set("X-Chert-Contract", echo)
					}
					body := `{}`
					if r.URL.Path == "/api/v1/events/stream" {
						if isFT || r.Header.Get("Last-Event-ID") != "" || r.URL.Query().Get("since") != "opaque +/=雪" {
							t.Error("SSE scope")
						}
						w.Header().Set("Content-Type", "text/event-stream")
						body = "event: close\ndata: {}\r\n\r\n"
					}
					if r.URL.Path == "/api/v1/send" {
						if isFT || r.Method != "POST" || r.Header.Get("Idempotency-Key") != "" {
							t.Error("text route or idempotency scope changed")
						}
						var input map[string]string
						if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
							t.Error(err)
						}
						if len(input) != 3 || input["phone"] != "+15550000002" || input["body"] != "Exact plaintext 雪" || input["idempotency_key"] != "caller-owned-key" {
							t.Errorf("text body changed: %v", input)
						}
						w.WriteHeader(http.StatusAccepted)
						body = `{"status":"queued","message_id":"6f1c2b9e-3d4a-4f5b-9c8d-7e6f5a4b3c2d","chat_id":"chat-1","lead_id":"0b7e2c1d-9a8f-4e3d-8c2b-1a0f9e8d7c6b","lead_created":true,"convo_id":"convo-1","phone_line_id":"line-1"}`
					}
					if _, err := io.WriteString(w, body); err != nil {
						t.Error(err)
					}
				}
			}
			im := httptest.NewServer(handler(false))
			defer im.Close()
			imOrigin = im.URL
			ft := httptest.NewServer(handler(true))
			defer ft.Close()
			ftOrigin = ft.URL
			sdk, err := chert.ConnectUnified(context.Background(), chert.UnifiedSessionConfig{AccessToken: unifiedToken, ProjectID: unifiedProject, IMessageOrigin: imOrigin, FaceTimeOrigin: ftOrigin})
			if err != nil {
				t.Fatal(err)
			}
			_, imErr := sdk.IMessage.Request(context.Background(), "GET", "/events", nil)
			_, ftErr := sdk.FaceTime.Request(context.Background(), "GET", "/calls", nil, chert.FaceTimeRequestOptions{})
			frames := 0
			streamErr := sdk.IMessage.StreamEvents(context.Background(), chert.StreamEventsOptions{Since: "opaque +/=雪"}, func(chert.MessagingStreamFrame) error { frames++; return nil })
			key := "caller-owned-key"
			receipt, sendErr := sdk.IMessage.SendText(context.Background(), chert.TextRequest{Phone: "+15550000002", Body: "Exact plaintext 雪", IdempotencyKey: &key})
			if echo == chert.UnifiedContract && (!receipt.Success || receipt.MessageID != "6f1c2b9e-3d4a-4f5b-9c8d-7e6f5a4b3c2d" || receipt.ChatID != "chat-1" || receipt.Status != "queued") {
				t.Fatal("queued receipt changed")
			}
			for _, err := range []error{imErr, ftErr, streamErr, sendErr} {
				if echo == chert.UnifiedContract {
					if err != nil {
						t.Fatal(err)
					}
				} else {
					var apiErr *chert.APIError
					if !errors.As(err, &apiErr) || apiErr.Code != "unsupported_unified_backend" {
						t.Fatalf("echo accepted: %v", err)
					}
				}
			}
			wantFrames := 0
			if echo == chert.UnifiedContract {
				wantFrames = 1
			}
			if frames != wantFrames || discovery.Load() != 1 || calls.Load() != 4 {
				t.Fatalf("frames=%d discovery=%d calls=%d", frames, discovery.Load(), calls.Load())
			}
		})
	}
}

func TestUnifiedInputValidationBeforeNetwork(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("invalid config sent request") }))
	defer s.Close()
	for _, mode := range []string{"token", "project", "path", "remote-http", "credentials", "query"} {
		cfg := chert.UnifiedSessionConfig{AccessToken: unifiedToken, ProjectID: unifiedProject, IMessageOrigin: s.URL, FaceTimeOrigin: s.URL}
		switch mode {
		case "token":
			cfg.AccessToken = "ftu_old"
		case "project":
			cfg.ProjectID = "not-uuid"
		case "path":
			cfg.FaceTimeOrigin = s.URL + "/api/v1"
		case "remote-http":
			cfg.FaceTimeOrigin = "http://example.com"
		case "credentials":
			cfg.FaceTimeOrigin = "https://user:password@example.com"
		case "query":
			cfg.FaceTimeOrigin = s.URL + "?x=1"
		}
		if _, err := chert.ConnectUnified(context.Background(), cfg); err == nil {
			t.Errorf("accepted %s", mode)
		}
	}
}
