package chert

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// DefaultFaceTimeEndpoint is the independent production FaceTime control plane.
const DefaultFaceTimeEndpoint = "https://facetime.trychert.com/api/v1"

// FaceTimeConfig never inherits an iMessage credential or tenant. Token may be
// omitted for public login/catalog calls. ProjectID is required for project calls.
type FaceTimeConfig struct {
	Token, ProjectID string
	EndpointOverride string
	Timeout          time.Duration
	MaxResponseBytes int64
}

func (c FaceTimeConfig) String() string   { return "FaceTimeConfig{redacted}" }
func (c FaceTimeConfig) GoString() string { return c.String() }

// SDKConfig enables either or both independent channels. No server binding is implied.
type SDKConfig struct {
	IMessage *Config
	FaceTime *FaceTimeConfig
}

// SDK groups clients without converting credentials, provisioning, or binding projects.
type SDK struct {
	IMessage *Client
	FaceTime *FaceTimeClient
}

// New constructs the selected clients without network requests or environment reads.
func New(cfg SDKConfig) (*SDK, error) {
	if cfg.IMessage == nil && cfg.FaceTime == nil {
		return nil, invalid()
	}
	s := &SDK{}
	var err error
	if cfg.IMessage != nil {
		s.IMessage, err = NewClient(*cfg.IMessage)
		if err != nil {
			return nil, err
		}
	}
	if cfg.FaceTime != nil {
		s.FaceTime, err = NewFaceTimeClient(*cfg.FaceTime)
		if err != nil {
			return nil, err
		}
	}
	return s, nil
}

// FaceTimeClient is a concurrency-safe HTTP control client, not a media runtime.
type FaceTimeClient struct{ transport *Client }

func (c FaceTimeClient) String() string   { return "FaceTimeClient{redacted}" }
func (c FaceTimeClient) GoString() string { return c.String() }

// NewFaceTimeClient uses production defaults and accepts an explicit API-prefix override.
func NewFaceTimeClient(cfg FaceTimeConfig) (*FaceTimeClient, error) {
	if cfg.ProjectID != "" && !identifier(cfg.ProjectID) {
		return nil, invalid()
	}
	c, err := newClient(Config{EndpointOverride: cfg.EndpointOverride, APIKey: cfg.Token, Timeout: cfg.Timeout, MaxResponseBytes: cfg.MaxResponseBytes}, DefaultFaceTimeEndpoint, true)
	if err != nil {
		return nil, err
	}
	c.project = cfg.ProjectID
	return &FaceTimeClient{c}, nil
}

// AuthScope selects the actual route's credential boundary. Public requests omit
// both headers; UserAuth omits the project header. Server role checks still apply.
type AuthScope uint8

const (
	ProjectAuth AuthScope = iota
	UserAuth
	PublicAuth
)

// FaceTimeRequestOptions is the raw escape hatch's explicit authentication scope.
type FaceTimeRequestOptions struct {
	Auth           AuthScope
	IdempotencyKey *string
}

// Request retains the complete JSON envelope and HTTP metadata for uncovered routes.
func (c *FaceTimeClient) Request(ctx context.Context, method, path string, body any, options FaceTimeRequestOptions) (Response, error) {
	t := *c.transport
	switch options.Auth {
	case PublicAuth:
		t.key, t.project = "", ""
	case UserAuth:
		t.project = ""
		if t.key == "" {
			return Response{}, &APIError{Code: "unauthorized"}
		}
	case ProjectAuth:
		if t.key == "" {
			return Response{}, &APIError{Code: "unauthorized"}
		}
		if t.project == "" {
			return Response{}, &APIError{Code: "project_required"}
		}
	default:
		return Response{}, invalid()
	}
	r, err := t.RequestWithOptions(ctx, method, path, body, RequestOptions{options.IdempotencyKey})
	if r.RequestID == "" {
		var envelope struct {
			RequestID string `json:"request_id"`
		}
		if json.Unmarshal(r.Data, &envelope) == nil {
			r.RequestID = envelope.RequestID
		}
		if e, ok := err.(*APIError); ok {
			e.RequestID = r.RequestID
		}
	}
	return r, err
}

// Result retains the typed data plus the original response, including unknown fields.
// Raw data can contain credentials or personal data: never log it indiscriminately.
type Result[T any] struct {
	Data     T
	Response Response
}

func (r Result[T]) String() string   { return "ChertResult{redacted}" }
func (r Result[T]) GoString() string { return r.String() }

func perform[T any](ctx context.Context, c *FaceTimeClient, method, path string, body any, scope AuthScope, key *string, status int, required ...string) (Result[T], error) {
	var out Result[T]
	r, err := c.Request(ctx, method, path, body, FaceTimeRequestOptions{scope, key})
	out.Response = r
	if err != nil {
		if method != "GET" && r.Status >= 200 && r.Status < 300 {
			return out, &APIError{Status: r.Status, Code: "unconfirmed_facetime_outcome", RequestID: r.RequestID, Data: r.Data, cause: cancellationCause(ctx, err)}
		}
		return out, err
	}
	var envelope struct {
		Data      json.RawMessage `json:"data"`
		RequestID string          `json:"request_id"`
	}
	bad := json.Unmarshal(r.Data, &envelope) != nil || envelope.RequestID == "" || len(envelope.Data) == 0 || (status != 0 && r.Status != status)
	if len(required) > 0 {
		var object map[string]json.RawMessage
		if json.Unmarshal(envelope.Data, &object) != nil || object == nil {
			bad = true
		}
		for _, field := range required {
			value := object[field]
			if len(value) == 0 || string(value) == "null" {
				bad = true
			}
		}
	}
	var value any
	if bad || json.Unmarshal(envelope.Data, &value) != nil || !validResponse(value, out.Data) || json.Unmarshal(envelope.Data, &out.Data) != nil {
		code := "invalid_response"
		if method != "GET" {
			code = "unconfirmed_facetime_outcome"
		}
		return Result[T]{Response: r}, &APIError{Status: r.Status, Code: code, RequestID: r.RequestID, Data: r.Data}
	}
	return out, nil
}

func identifier(s string) bool {
	if len(s) == 0 || len(s) > 160 {
		return false
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}
func resource(base, id, suffix string) string {
	if !identifier(id) {
		return ""
	}
	return "/" + base + "/" + id + suffix
}
func faceTimeKey(key string) bool { return len(key) >= 8 && validHeaderKey(key) }

// PageOptions leaves server defaults intact when Limit is zero; no automatic paging.
type PageOptions struct {
	Limit  int
	Offset int64
}

func pagePath(base string, p PageOptions) string {
	if p.Limit < 0 || p.Limit > 100 || p.Offset < 0 || p.Offset > 9007199254740991 {
		return ""
	}
	q := url.Values{}
	if p.Limit != 0 {
		q.Set("limit", fmt.Sprint(p.Limit))
	}
	if p.Offset != 0 {
		q.Set("offset", fmt.Sprint(p.Offset))
	}
	if len(q) == 0 {
		return "/" + base
	}
	return "/" + base + "?" + q.Encode()
}

// ListCalls reads one authorized page of call snapshots.
func (c *FaceTimeClient) ListCalls(ctx context.Context, p PageOptions) (Result[Page[Call]], error) {
	return perform[Page[Call]](ctx, c, "GET", pagePath("calls", p), nil, ProjectAuth, nil, 200, "items", "total", "limit", "offset")
}

// GetCall reads a snapshot, not evidence of live media.
func (c *FaceTimeClient) GetCall(ctx context.Context, id string) (Result[Call], error) {
	return perform[Call](ctx, c, "GET", resource("calls", id, ""), nil, ProjectAuth, nil, 200, "id", "status", "media")
}

// GetCallEvents reads call events without polling.
func (c *FaceTimeClient) GetCallEvents(ctx context.Context, id string) (Result[CallEvents], error) {
	return perform[CallEvents](ctx, c, "GET", resource("calls", id, "/events"), nil, ProjectAuth, nil, 200, "call_id", "events")
}

// GetTranscript reads explicitly sensitive transcript data.
func (c *FaceTimeClient) GetTranscript(ctx context.Context, id string) (Result[Transcript], error) {
	return perform[Transcript](ctx, c, "GET", resource("calls", id, "/transcript"), nil, ProjectAuth, nil, 200, "call_id", "turns", "schema_version")
}

// CreateCall requests production outbound control once. A receipt does not prove connection.
func (c *FaceTimeClient) CreateCall(ctx context.Context, input CreateCallRequest, key string) (Result[Call], error) {
	if !faceTimeKey(key) || !input.valid() {
		return Result[Call]{}, invalid()
	}
	return perform[Call](ctx, c, "POST", "/calls", struct {
		Direction string `json:"direction"`
		CreateCallRequest
	}{"outbound", input}, ProjectAuth, &key, 201, "id", "status", "media")
}

// CallAction enqueues answer, reject or end. Reason is accepted by the route but
// currently discarded by the server. An acknowledgement is not terminal state.
func (c *FaceTimeClient) CallAction(ctx context.Context, id string, action CallAction, reason string, key string) (Result[Call], error) {
	if !faceTimeKey(key) || (action != Answer && action != Reject && action != End) || len([]rune(strings.TrimSpace(reason))) > 160 {
		return Result[Call]{}, invalid()
	}
	return perform[Call](ctx, c, "POST", resource("calls", id, "/"+string(action)), struct {
		Reason string `json:"reason,omitempty"`
	}{reason}, ProjectAuth, &key, 202, "id", "status")
}

// ListLines reads available authorized lines. The inspected API has no GET line detail.
func (c *FaceTimeClient) ListLines(ctx context.Context, p PageOptions) (Result[Page[Line]], error) {
	return perform[Page[Line]](ctx, c, "GET", pagePath("lines", p), nil, ProjectAuth, nil, 200, "items", "total", "limit", "offset")
}

// ListWorkers reads public worker snapshots, not administrator diagnostics.
func (c *FaceTimeClient) ListWorkers(ctx context.Context, p PageOptions) (Result[Page[Worker]], error) {
	return perform[Page[Worker]](ctx, c, "GET", pagePath("workers", p), nil, ProjectAuth, nil, 200, "items", "total", "limit", "offset")
}

// UpdateLine changes routing configuration; it does not activate or provision a line.
func (c *FaceTimeClient) UpdateLine(ctx context.Context, id string, input UpdateLineRequest) (Result[Line], error) {
	return perform[Line](ctx, c, "PATCH", resource("lines", id, ""), input, ProjectAuth, nil, 200, "id", "status")
}

// ListAssistants reads a single page.
func (c *FaceTimeClient) ListAssistants(ctx context.Context, p PageOptions) (Result[Page[Assistant]], error) {
	return perform[Page[Assistant]](ctx, c, "GET", pagePath("assistants", p), nil, ProjectAuth, nil, 200, "items", "total", "limit", "offset")
}

// GetAssistant reads draft and publication metadata.
func (c *FaceTimeClient) GetAssistant(ctx context.Context, id string) (Result[Assistant], error) {
	return perform[Assistant](ctx, c, "GET", resource("assistants", id, ""), nil, ProjectAuth, nil, 200, "id", "draft_revision", "draft_config")
}

// CreateAssistant submits server-versioned configuration; server validation is authoritative.
func (c *FaceTimeClient) CreateAssistant(ctx context.Context, input CreateAssistantRequest) (Result[Assistant], error) {
	return perform[Assistant](ctx, c, "POST", "/assistants", input, ProjectAuth, nil, 201, "id", "draft_revision", "draft_config")
}

// UpdateAssistant uses optimistic draft revision. Omitted fields remain unchanged.
func (c *FaceTimeClient) UpdateAssistant(ctx context.Context, id string, input UpdateAssistantRequest) (Result[Assistant], error) {
	if input.ExpectedDraftRevision < 1 {
		return Result[Assistant]{}, invalid()
	}
	return perform[Assistant](ctx, c, "PATCH", resource("assistants", id, ""), input, ProjectAuth, nil, 200, "id", "draft_revision", "draft_config")
}

// PublishAssistant creates a version once. This route has no idempotency key contract.
func (c *FaceTimeClient) PublishAssistant(ctx context.Context, id string) (Result[PublishedAssistant], error) {
	return perform[PublishedAssistant](ctx, c, "POST", resource("assistants", id, "/publish"), nil, ProjectAuth, nil, 201, "assistant", "published_version_id")
}

// GetSettings reads the project's allowed LiveKit hosts.
func (c *FaceTimeClient) GetSettings(ctx context.Context) (Result[ProjectSettings], error) {
	return perform[ProjectSettings](ctx, c, "GET", "/settings", nil, ProjectAuth, nil, 200, "livekit_allowed_hosts")
}

// UpdateSettings replaces allowed hosts; host validation remains server-owned.
func (c *FaceTimeClient) UpdateSettings(ctx context.Context, input ProjectSettings) (Result[ProjectSettings], error) {
	return perform[ProjectSettings](ctx, c, "PUT", "/settings", input, ProjectAuth, nil, 200, "livekit_allowed_hosts")
}
