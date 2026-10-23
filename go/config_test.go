package chert

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProductionDefaultAndExplicitOverride(t *testing.T) {
	t.Setenv("CHERT_BASE_URL", "http://untrusted.invalid")
	t.Setenv("CHERT_API_KEY", "ambient-secret")
	c, err := NewClient(Config{APIKey: "explicit-secret"})
	if err != nil || c.base != "https://console.trychert.com/api/v1" || c.key != "explicit-secret" {
		t.Fatalf("default: %v", err)
	}
	if _, err = NewClient(Config{}); err == nil {
		t.Fatal("ambient credential used")
	}
	for _, endpoint := range []string{"https://self.example", "https://self.example/prefix/", "http://127.0.0.1:8080/custom"} {
		c, err = NewClient(Config{APIKey: "key", EndpointOverride: endpoint})
		want := strings.TrimRight(endpoint, "/")
		if endpoint == "https://self.example" {
			want += "/api/v1"
		}
		if err != nil || c.base != want {
			t.Fatalf("override %s: %v", endpoint, err)
		}
	}
	for _, endpoint := range []string{"http://remote.example", "https://user:secret@self.example", "https://self.example?x", "https://self.example/#x", "https://self.example/%2e%2e", " https://self.example", "https://self.example:99999"} {
		if _, err = NewClient(Config{APIKey: "key", EndpointOverride: endpoint}); err == nil {
			t.Errorf("accepted %s", endpoint)
		}
	}
	if _, err = NewClient(Config{APIKey: "key", BaseURL: "https://a.example", EndpointOverride: "https://b.example"}); err == nil {
		t.Fatal("ambiguous overrides")
	}
	cfg := Config{APIKey: "private-secret", Tenant: "private-tenant"}
	if strings.Contains(fmt.Sprintf("%v %+v %#v", cfg, cfg, cfg), "private-") {
		t.Fatal("configuration leaked")
	}
}

func TestTypedResponseBodyCancellationIdentity(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			t.Error(err)
		}
		w.WriteHeader(202)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer s.Close()
	_, err := client(t, s, 0, 30*time.Millisecond).SendText(context.Background(), TextRequest{Phone: "+15550000002", Body: "hello"})
	var api *APIError
	if !errors.Is(err, context.DeadlineExceeded) || !errors.As(err, &api) || api.Code != "unconfirmed_text_outcome" {
		t.Fatalf("lost cancellation: %v", err)
	}
}

func TestRawIdempotency(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Idempotency-Key") != "stable-key" {
			t.Error("missing key")
		}
		fmt.Fprint(w, `{}`)
	}))
	defer s.Close()
	c := client(t, s, 0, 0)
	key := "stable-key"
	if _, err := c.RequestWithOptions(context.Background(), "POST", "/future", map[string]bool{"ok": true}, RequestOptions{&key}); err != nil {
		t.Fatal(err)
	}
	key = ""
	if _, err := c.RequestWithOptions(context.Background(), "POST", "/future", nil, RequestOptions{&key}); err == nil {
		t.Fatal("empty key accepted")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls %d", calls.Load())
	}
}
