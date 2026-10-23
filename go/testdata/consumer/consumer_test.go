package consumer_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chert "github.com/cherthq/sdk/go"
)

func TestInstalledModule(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/text-operations/v1" {
			if r.Header.Get("Authorization") != "Bearer im-key" || r.Header.Get("X-Chert-Tenant") != "im-tenant" || r.Header.Get("X-Chert-Project-ID") != "" {
				t.Error("iMessage scope")
			}
			w.WriteHeader(202)
			if _, err := fmt.Fprint(w, `{"success":true,"message_id":"0123456789abcdef0123456789abcdef","chat_id":"chat-1","status":"queued"}`); err != nil {
				t.Error(err)
			}
			return
		}
		if r.URL.Path != "/api/v1/calls/call-1" || r.Header.Get("Authorization") != "Bearer ft-key" || r.Header.Get("X-Chert-Project-ID") != "ft-project" || r.Header.Get("X-Chert-Tenant") != "" {
			t.Error("FaceTime scope")
		}
		if _, err := fmt.Fprint(w, `{"data":{"id":"call-1","status":"queued","media":{"audio":true,"video":false},"future":{"revision":9}},"request_id":"trace"}`); err != nil {
			t.Error(err)
		}
	}))
	defer s.Close()
	sdk, err := chert.New(chert.SDKConfig{IMessage: &chert.Config{APIKey: "im-key", Tenant: "im-tenant", EndpointOverride: s.URL}, FaceTime: &chert.FaceTimeConfig{Token: "ft-key", ProjectID: "ft-project", EndpointOverride: s.URL}})
	if err != nil {
		t.Fatal(err)
	}
	text, err := sdk.IMessage.SendText(context.Background(), chert.TextRequest{Phone: "+15550000002", Body: "hello"})
	if err != nil || text.Status != "queued" {
		t.Fatalf("text: %v", err)
	}
	call, err := sdk.FaceTime.GetCall(context.Background(), "call-1")
	if err != nil || call.Data.ID != "call-1" || !call.Data.Media.Audio || call.Data.Media.Video || call.Response.RequestID != "trace" || call.Response.Status != 200 {
		t.Fatalf("call: %v", err)
	}
	if !strings.Contains(string(call.Response.Data), `"future":{"revision":9}`) {
		t.Fatal("unknown fields lost")
	}
}
