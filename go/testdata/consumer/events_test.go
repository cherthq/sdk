package consumer_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	chert "github.com/cherthq/sdk/go"
)

func TestInstalledMessagingEvents(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" {
			t.Error("missing auth")
		}
		var body string
		switch r.URL.Path {
		case "/api/v1/events":
			body = `{"events":[],"next_cursor":null,"count":0}`
		case "/api/v1/events/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			body = "event: close\ndata: {\"reconnect_with_since\":\"next\"}\n\n"
		default:
			t.Error("unexpected route")
			w.WriteHeader(404)
			body = `{}`
		}
		if _, err := fmt.Fprint(w, body); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	c, err := chert.NewClient(chert.Config{EndpointOverride: s.URL, APIKey: "key"})
	if err != nil {
		t.Fatal(err)
	}
	limit := 1
	page, err := c.ListEvents(context.Background(), chert.EventListOptions{Limit: &limit})
	if err != nil || page.Data.Count != 0 {
		t.Fatalf("list: %v", err)
	}
	frames := 0
	err = c.StreamEvents(context.Background(), chert.StreamEventsOptions{}, func(frame chert.MessagingStreamFrame) error {
		frames++
		if frame.Event != "close" {
			t.Error("frame")
		}
		return nil
	})
	if err != nil || frames != 1 {
		t.Fatalf("stream: %v", err)
	}
	if chert.VerifyWebhook([]byte(`{}`), "invalid", "secret") {
		t.Fatal("invalid signature")
	}
}
