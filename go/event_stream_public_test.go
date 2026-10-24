package chert_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chert "github.com/cherthq/sdk/go"
)

func TestStreamEventsCRLFFrameBound(t *testing.T) {
	const limit = 1024 * 1024
	type testCase struct {
		name, wire string
		frames     int
		fail       bool
	}
	cases := []testCase{
		{"comment-heavy-overflow", strings.Repeat(":\r\n", 400000) + "data: {}\r\n\r\n", 0, true},
		{"completed-CRLF-does-not-charge-next-frame", "data: {}\r\n\r\n:" + strings.Repeat("x", limit-12) + "\ndata: {}\n\n", 2, false},
		{"bare-CR-at-EOF", "data: {}\r\r", 1, false},
		{"close-bare-CR-at-EOF", "event: close\rdata: {}\r\r", 1, false},
	}
	for _, event := range []string{"message", "close"} {
		for _, delta := range []int{-1, 0, 1} {
			suffix := "\r\ndata: {}\r\n\r\n"
			if event == "close" {
				suffix = "\r\nevent: close\r\ndata: {}\r\n\r\n"
			}
			wire := ":" + strings.Repeat("x", limit+delta-1-len(suffix)) + suffix
			frames := 1
			if delta > 0 {
				frames = 0
			}
			cases = append(cases, testCase{fmt.Sprintf("%s-limit%+d", event, delta), wire, frames, delta > 0})
		}
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				// Rejection may close the connection while the server is still writing.
				_, _ = io.WriteString(w, tc.wire)
			}))
			defer s.Close()
			c, err := chert.NewClient(chert.Config{EndpointOverride: s.URL, APIKey: "key"})
			if err != nil {
				t.Fatal(err)
			}
			frames := 0
			err = c.StreamEvents(context.Background(), chert.StreamEventsOptions{}, func(chert.MessagingStreamFrame) error { frames++; return nil })
			if (err != nil) != tc.fail || frames != tc.frames {
				t.Fatalf("frames=%d error=%v", frames, err)
			}
			if tc.fail {
				var apiErr *chert.APIError
				if !errors.As(err, &apiErr) || apiErr.Code != "invalid_event_stream" {
					t.Fatalf("unexpected error: %v", err)
				}
			}
		})
	}
}

func TestEventUnknownFieldsRetainedInRawResponse(t *testing.T) {
	const body = `{"id":"row-1","payload":{"future":{"nested":[1,true,null]}},"future_metadata":{"revision":7},"delivery":{"future_delivery":true}}`
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.WriteString(w, body); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	c, err := chert.NewClient(chert.Config{EndpointOverride: s.URL, APIKey: "key"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := c.GetEvent(context.Background(), "row-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(result.Data.Payload["future"]) != `{"nested":[1,true,null]}` {
		t.Fatal("unknown payload lost")
	}
	if string(result.Response.Data) != body {
		t.Fatal("original metadata lost from raw response")
	}
}
