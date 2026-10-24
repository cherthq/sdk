package consumer_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chert "github.com/cherthq/sdk/go"
)

func TestInstalledUnifiedFactoryFailsClosed(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/sdk/capabilities" || r.Header.Get("Authorization") != "" {
			t.Error("unexpected discovery or credential disclosure")
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer s.Close()
	sdk, err := chert.ConnectUnified(context.Background(), chert.UnifiedSessionConfig{
		AccessToken: "chu_" + strings.Repeat("a", 43), ProjectID: "12345678-1234-1234-1234-123456789abc",
		IMessageOrigin: s.URL, FaceTimeOrigin: s.URL,
	})
	var apiErr *chert.APIError
	if sdk != nil || !errors.As(err, &apiErr) || apiErr.Code != "unsupported_unified_backend" {
		t.Fatalf("old backend accepted: %v", err)
	}
}
