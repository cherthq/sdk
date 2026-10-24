package chert

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// UnifiedContract is the proposed, version-gated single-session wire contract.
const UnifiedContract = "chert-unified-v1"

// UnifiedSessionConfig supplies an already-issued session; the CLI owns login.
// Origins are explicitly trusted by the caller, never selected by discovery.
// Empty origins use the production defaults. No deployment support is implied.
type UnifiedSessionConfig struct {
	AccessToken, ProjectID         string
	IMessageOrigin, FaceTimeOrigin string
	Timeout                        time.Duration
	MaxResponseBytes               int64
}

func (c UnifiedSessionConfig) String() string   { return "UnifiedSessionConfig{redacted}" }
func (c UnifiedSessionConfig) GoString() string { return c.String() }

var unifiedTokenPattern = regexp.MustCompile(`^chu_[A-Za-z0-9_-]{43}$`)

// ConnectUnified discovers the proposed v1 contract without credentials before
// constructing two clients with the same token. It never logs in, refreshes,
// retries, falls back to legacy auth, or changes the existing send route.
func ConnectUnified(ctx context.Context, cfg UnifiedSessionConfig) (*SDK, error) {
	if ctx == nil || !unifiedTokenPattern.MatchString(cfg.AccessToken) || !uuidPattern.MatchString(cfg.ProjectID) {
		return nil, invalid()
	}
	imOrigin, err := approvedUnifiedOrigin(cfg.IMessageOrigin, "https://console.trychert.com")
	if err != nil {
		return nil, err
	}
	ftOrigin, err := approvedUnifiedOrigin(cfg.FaceTimeOrigin, "https://facetime.trychert.com")
	if err != nil {
		return nil, err
	}
	// Validate all configuration before discovery. Neither construction sends data.
	im, err := newClient(Config{EndpointOverride: imOrigin, Timeout: cfg.Timeout, MaxResponseBytes: cfg.MaxResponseBytes}, DefaultIMessageEndpoint, true)
	if err != nil {
		return nil, err
	}
	ft, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: ftOrigin, ProjectID: cfg.ProjectID, Timeout: cfg.Timeout, MaxResponseBytes: cfg.MaxResponseBytes})
	if err != nil {
		return nil, err
	}
	discovery := *im
	if discovery.limit > 65536 {
		discovery.limit = 65536
	}
	discoveryHTTP := *im.http
	if discoveryHTTP.Timeout > 15*time.Second {
		discoveryHTTP.Timeout = 15 * time.Second
	}
	discovery.http = &discoveryHTTP
	r, err := discovery.Request(ctx, "GET", "/sdk/capabilities", nil)
	if err != nil {
		return nil, &APIError{Code: "unsupported_unified_backend", cause: cancellationCause(ctx, err)}
	}
	var envelope struct {
		Data struct {
			Contract string `json:"contract"`
			Version  int    `json:"contract_version"`
			Auth     struct {
				Scheme   string `json:"scheme"`
				Prefix   string `json:"token_prefix"`
				Audience string `json:"audience"`
				LoginURL string `json:"login_url"`
			} `json:"auth"`
			Services struct {
				IMessage struct {
					BaseURL string `json:"base_url"`
				} `json:"imessage"`
				FaceTime struct {
					BaseURL string `json:"base_url"`
				} `json:"facetime"`
			} `json:"services"`
			Scopes []any `json:"scopes"`
		} `json:"data"`
	}
	if json.Unmarshal(r.Data, &envelope) != nil {
		return nil, &APIError{Code: "unsupported_unified_backend"}
	}
	d := envelope.Data
	if d.Contract != "chert-unified" || d.Version != 1 || d.Auth.Scheme != "Bearer" || d.Auth.Prefix != "chu_" || d.Auth.Audience != "chert.unified-api:v1" || d.Auth.LoginURL != ftOrigin+"/api/v1/cli/logins" || d.Services.IMessage.BaseURL != imOrigin+"/api/v1" || d.Services.FaceTime.BaseURL != ftOrigin+"/api/v1" {
		return nil, &APIError{Code: "unsupported_unified_backend"}
	}
	grantedScopes := make(map[string]bool, len(d.Scopes))
	for _, value := range d.Scopes {
		scope, ok := value.(string)
		if !ok || grantedScopes[scope] {
			return nil, &APIError{Code: "unsupported_unified_backend"}
		}
		grantedScopes[scope] = true
	}
	for _, scope := range []string{"imessage:events:read", "imessage:webhooks:manage", "imessage:messages:send", "facetime:calls:read", "facetime:calls:create", "facetime:calls:control"} {
		if !grantedScopes[scope] {
			return nil, &APIError{Code: "unsupported_unified_backend"}
		}
	}
	im.key, im.contract = cfg.AccessToken, UnifiedContract
	ft.transport.key, ft.transport.contract = cfg.AccessToken, UnifiedContract
	return &SDK{IMessage: im, FaceTime: ft}, nil
}

func approvedUnifiedOrigin(value, fallback string) (string, error) {
	if value == "" {
		value = fallback
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.Host == "" || u.Opaque != "" || (u.Path != "" && u.Path != "/") || strings.ContainsAny(value, "?#") || !cleanURL(value) {
		return "", invalid()
	}
	// newClient performs the remaining HTTPS/loopback/host validation.
	return u.Scheme + "://" + u.Host, nil
}

func (c *Client) checkContract(res *http.Response) error {
	if c.contract != "" {
		values := res.Header.Values("X-Chert-Contract")
		if len(values) != 1 || values[0] != c.contract {
			return &APIError{Status: res.StatusCode, Code: "unsupported_unified_backend", RequestID: res.Header.Get("X-Request-ID")}
		}
	}
	return nil
}
