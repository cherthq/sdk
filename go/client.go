// Package chert provides one-attempt authenticated JSON requests to Chert.
// Queue acceptance and reaction acknowledgement do not establish delivery or application.
package chert

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Config supplies explicit credentials and transport bounds. Zero bounds use defaults.
type Config struct {
	// EndpointOverride is optional, for tests, self-hosting or advanced deployments.
	EndpointOverride string
	// BaseURL is the legacy endpoint override. Do not set both overrides.
	BaseURL, APIKey, Tenant string
	Timeout                 time.Duration
	MaxResponseBytes        int64
}

// DefaultIMessageEndpoint is the production messaging API, independent of FaceTime.
const DefaultIMessageEndpoint = "https://console.trychert.com/api/v1"

func (c Config) String() string   { return "ChertConfig{redacted}" }
func (c Config) GoString() string { return c.String() }

// Client is safe for concurrent requests. Construction performs no network requests.
type Client struct {
	base, key, tenant string
	project           string
	contract          string
	http              *http.Client
	limit             int64
}

func (c Client) String() string   { return "ChertClient{redacted}" }
func (c Client) GoString() string { return c.String() }

// APIError exposes bounded response data explicitly; formatting never includes it.
type APIError struct {
	Status          int
	Code, RequestID string
	Data            json.RawMessage
	cause           error
}

func (e APIError) Error() string {
	return fmt.Sprintf("Chert request failed (%d); reconcile uncertain operations before retrying", e.Status)
}
func (e APIError) GoString() string { return e.Error() }

// Unwrap preserves context cancellation/deadline identity without exposing transport details.
func (e *APIError) Unwrap() error { return e.cause }

// Response preserves actual HTTP metadata and bounded JSON bytes.
type Response struct {
	Status    int
	RequestID string
	Data      json.RawMessage
}

var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{1,14}$`)
var uuidPattern = regexp.MustCompile(`^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$`)
var publicPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var chatPattern = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,160}$`)
var messagePattern = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,160}$`)
var methodPattern = regexp.MustCompile(`^[A-Za-z]+$`)

func invalid() error { return &APIError{Code: "invalid_request"} }
func cleanHeader(s string) bool {
	if s == "" || strings.TrimSpace(s) == "" {
		return false
	}
	for _, r := range s {
		if r < 32 || r >= 127 {
			return false
		}
	}
	return true
}
func cleanURL(s string) bool {
	if len(s) > 16384 || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if r <= 32 || r == 127 || r == '\\' {
			return false
		}
	}
	return true
}
func safePath(path string) bool {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || !cleanURL(path) {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		decoded, err := url.PathUnescape(part)
		if err != nil || decoded == "." || decoded == ".." || strings.ContainsAny(decoded, "/\\%?#") || !cleanURL(decoded) {
			return false
		}
	}
	return true
}

// NewClient refuses redirects, ambient proxies and remote cleartext HTTP.
func NewClient(cfg Config) (*Client, error) {
	return newClient(cfg, DefaultIMessageEndpoint, false)
}

func newClient(cfg Config, defaultEndpoint string, public bool) (*Client, error) {
	if cfg.EndpointOverride != "" {
		if cfg.BaseURL != "" {
			return nil, invalid()
		}
		cfg.BaseURL = cfg.EndpointOverride
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultEndpoint
	}
	if !cleanURL(cfg.BaseURL) || strings.ContainsAny(cfg.BaseURL, "?#") || (!public || cfg.APIKey != "") && !cleanHeader(cfg.APIKey) || cfg.Tenant != "" && !cleanHeader(cfg.Tenant) {
		return nil, invalid()
	}
	base, err := url.Parse(cfg.BaseURL)
	if err != nil || base.User != nil || base.Host == "" || base.Opaque != "" || strings.Contains(base.Host, "%") {
		return nil, invalid()
	}
	host := base.Hostname()
	for _, r := range base.Host {
		if r > 127 {
			return nil, invalid()
		}
	}
	if base.Scheme != "https" && !(base.Scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1")) {
		return nil, invalid()
	}
	if base.Port() != "" {
		if _, err := net.LookupPort("tcp", base.Port()); err != nil {
			return nil, invalid()
		}
	}
	path := base.EscapedPath()
	if path == "" || path == "/" {
		path = "/api/v1"
	}
	if !safePath(path) {
		return nil, invalid()
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}
	if cfg.MaxResponseBytes == 0 {
		cfg.MaxResponseBytes = 8 * 1024 * 1024
	}
	if cfg.Timeout < 0 || cfg.MaxResponseBytes < 1 || cfg.MaxResponseBytes == int64(^uint64(0)>>1) {
		return nil, invalid()
	}
	transport := &http.Transport{DisableKeepAlives: true, TLSHandshakeTimeout: 10 * time.Second} // Fresh connections prevent transport replay of keyed POSTs.
	return &Client{base: base.Scheme + "://" + base.Host + strings.TrimRight(path, "/"), key: cfg.APIKey, tenant: cfg.Tenant, limit: cfg.MaxResponseBytes, http: &http.Client{Transport: transport, Timeout: cfg.Timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// Request performs one relative-path request. Nil body means no body; credentials cannot be overridden.
func (c *Client) Request(ctx context.Context, method, path string, body any) (Response, error) {
	return c.request(ctx, method, path, body, "")
}

// RequestOptions supplies a caller-owned header key; nil means absent, not empty.
type RequestOptions struct{ IdempotencyKey *string }

// RequestWithOptions preserves raw JSON access for routes without a typed method.
// A key does not imply that the selected server route implements idempotency.
func (c *Client) RequestWithOptions(ctx context.Context, method, path string, body any, options RequestOptions) (Response, error) {
	key := ""
	if options.IdempotencyKey != nil {
		key = *options.IdempotencyKey
		if !validHeaderKey(key) {
			return Response{}, invalid()
		}
	}
	return c.request(ctx, method, path, body, key)
}

func (c *Client) request(ctx context.Context, method, path string, body any, key string) (Response, error) {
	var result Response
	if ctx == nil || !cleanURL(path) || strings.Contains(path, "#") || !methodPattern.MatchString(method) {
		return result, invalid()
	}
	method = strings.ToUpper(method)
	if method == "CONNECT" || method == "TRACE" || method == "TRACK" || body != nil && (method == "GET" || method == "HEAD") {
		return result, invalid()
	}
	parts, err := url.Parse(path)
	if err != nil || parts.IsAbs() || parts.Host != "" || !safePath(parts.EscapedPath()) {
		return result, invalid()
	}
	query, err := url.QueryUnescape(parts.RawQuery)
	if err != nil || !cleanURL(query) {
		return result, invalid()
	}
	target := c.base + path
	if len(target) > 16384 {
		return result, invalid()
	}
	var raw []byte
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return result, invalid()
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(raw))
	if err != nil {
		return result, invalid()
	}
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	req.Header.Set("Accept", "application/json")
	if c.contract != "" {
		req.Header.Set("X-Chert-Contract", c.contract)
	}
	if c.project != "" {
		req.Header.Set("X-Chert-Project-ID", c.project)
	}
	if c.tenant != "" {
		req.Header.Set("X-Chert-Tenant", c.tenant)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return result, &APIError{Code: "request_failed", cause: cancellationCause(ctx, err)}
	}
	defer res.Body.Close()
	if err := c.checkContract(res); err != nil {
		return result, err
	}
	result.Status = res.StatusCode
	result.RequestID = res.Header.Get("X-Request-ID")
	data, err := io.ReadAll(io.LimitReader(res.Body, c.limit+1))
	if err != nil || int64(len(data)) > c.limit {
		return result, &APIError{Status: result.Status, Code: "invalid_response", RequestID: result.RequestID, cause: cancellationCause(ctx, err)}
	}
	result.Data = data
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		code := "request_failed"
		var v map[string]json.RawMessage
		if json.Unmarshal(data, &v) == nil {
			if e := v["error"]; e != nil {
				var obj map[string]json.RawMessage
				if json.Unmarshal(e, &obj) == nil {
					if b := obj["code"]; b != nil {
						code = strings.Trim(string(b), "\"")
					}
				}
			}
		}
		return result, &APIError{Status: result.Status, Code: code, RequestID: result.RequestID, Data: data}
	}
	if len(data) == 0 && (res.StatusCode == 204 || method == "HEAD") {
		return result, nil
	}
	if _, err = decodeJSON(data); err != nil {
		return result, &APIError{Status: result.Status, Code: "invalid_response", RequestID: result.RequestID}
	}
	return result, nil
}

// TextRequest preserves exact plaintext and optional body idempotency key.
type TextRequest struct {
	Phone          string  `json:"phone"`
	Body           string  `json:"body"`
	IdempotencyKey *string `json:"idempotency_key,omitempty"`
}

// QueuedTextReceipt is queue acceptance only.
type QueuedTextReceipt struct {
	Success   bool   `json:"success"`
	MessageID string `json:"message_id"`
	ChatID    string `json:"chat_id"`
	Status    string `json:"status"`
}

func blank(s string) bool {
	return strings.TrimFunc(s, func(r rune) bool {
		return r >= 9 && r <= 13 || r == 32 || r == 0xa0 || r == 0x1680 || r >= 0x2000 && r <= 0x200a || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
	}) == ""
}
func validText(s string) bool {
	return utf8.ValidString(s) && len(s) <= 16384 && !strings.ContainsRune(s, 0) && !blank(s)
}
func validBodyKey(s string) bool {
	return s != "" && len(s) <= 200 && utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}
func unconfirmed(r Response, code string) error {
	return &APIError{Status: 502, Code: code, RequestID: r.RequestID, Data: r.Data}
}
func receiptObject(r Response, err error, code string) (map[string]any, error) {
	if err != nil && (r.Status < 200 || r.Status >= 300) {
		return nil, err
	}
	v, e := decodeJSON(r.Data)
	obj, ok := v.(map[string]any)
	if err != nil || e != nil || !ok || r.Status != 202 || len(obj) != 4 {
		failure := unconfirmed(r, code).(*APIError)
		if errors.Is(err, context.Canceled) {
			failure.cause = context.Canceled
		}
		if errors.Is(err, context.DeadlineExceeded) {
			failure.cause = context.DeadlineExceeded
		}
		return nil, failure
	}
	return obj, nil
}

// SendText reserves a strict plaintext operation once; uncertain outcomes are never retried.
func (c *Client) SendText(ctx context.Context, input TextRequest) (QueuedTextReceipt, error) {
	var out QueuedTextReceipt
	if !phonePattern.MatchString(input.Phone) || !validText(input.Body) || input.IdempotencyKey != nil && !validBodyKey(*input.IdempotencyKey) {
		return out, invalid()
	}
	r, err := c.request(ctx, "POST", "/text-operations/v1", input, "")
	obj, err := receiptObject(r, err, "unconfirmed_text_outcome")
	if err != nil {
		return out, err
	}
	id, _ := obj["message_id"].(string)
	chat, _ := obj["chat_id"].(string)
	if obj["success"] != true || obj["status"] != "queued" || !publicPattern.MatchString(id) || !chatPattern.MatchString(chat) {
		return out, unconfirmed(r, "unconfirmed_text_outcome")
	}
	return QueuedTextReceipt{true, id, chat, "queued"}, nil
}

// ReactionRequest targets part zero using one of six standard names.
type ReactionRequest struct {
	Reaction       string
	Remove         bool
	IdempotencyKey *string
}

// ReactionReceipt acknowledges dispatch, never applied state.
type ReactionReceipt struct {
	OperationID string `json:"operation_id"`
	ChatID      string `json:"chat_id"`
	MessageID   string `json:"message_id"`
	Status      string `json:"status"`
}

func validHeaderKey(s string) bool {
	return len(s) <= 200 && cleanHeader(s) && s[0] != ' ' && s[len(s)-1] != ' '
}

// SendReaction canonicalizes only chat UUID case; message identity remains exact.
func (c *Client) SendReaction(ctx context.Context, chat, message string, input ReactionRequest) (ReactionReceipt, error) {
	var out ReactionReceipt
	supported := map[string]bool{"love": true, "like": true, "dislike": true, "laugh": true, "emphasize": true, "question": true}
	if !uuidPattern.MatchString(chat) || !messagePattern.MatchString(message) || message == "." || message == ".." || !supported[input.Reaction] || input.IdempotencyKey != nil && !validHeaderKey(*input.IdempotencyKey) {
		return out, invalid()
	}
	chat = strings.ToLower(chat)
	key := ""
	if input.IdempotencyKey != nil {
		key = *input.IdempotencyKey
	}
	segment := strings.ReplaceAll(url.PathEscape(message), ":", "%3A")
	r, err := c.request(ctx, "POST", "/chats/"+chat+"/messages/"+segment+"/reactions", map[string]any{"reaction": input.Reaction, "remove": input.Remove, "part_index": 0}, key)
	obj, err := receiptObject(r, err, "unconfirmed_reaction_outcome")
	if err != nil {
		return out, err
	}
	id, _ := obj["operation_id"].(string)
	if !publicPattern.MatchString(id) || obj["chat_id"] != chat || obj["message_id"] != message || obj["status"] != "acknowledged" {
		return out, unconfirmed(r, "unconfirmed_reaction_outcome")
	}
	return ReactionReceipt{id, chat, message, "acknowledged"}, nil
}

// decodeJSON rejects invalid UTF-8, duplicate object keys and trailing data.
func decodeJSON(raw []byte) (any, error) {
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("invalid JSON")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	v, err := decodeValue(d, 0)
	if err != nil {
		return nil, err
	}
	if _, err = d.Token(); err != io.EOF {
		return nil, fmt.Errorf("invalid JSON")
	}
	return v, nil
}
func decodeValue(d *json.Decoder, depth int) (any, error) {
	if depth > 128 {
		return nil, fmt.Errorf("JSON depth exceeds bound")
	}
	t, err := d.Token()
	if err != nil {
		return nil, err
	}
	switch t {
	case json.Delim('{'):
		m := map[string]any{}
		for d.More() {
			k, e := d.Token()
			if e != nil {
				return nil, e
			}
			key, ok := k.(string)
			if !ok {
				return nil, fmt.Errorf("invalid JSON")
			}
			if _, exists := m[key]; exists {
				return nil, fmt.Errorf("duplicate JSON key")
			}
			value, e := decodeValue(d, depth+1)
			if e != nil {
				return nil, e
			}
			m[key] = value
		}
		_, err = d.Token()
		return m, err
	case json.Delim('['):
		a := []any{}
		for d.More() {
			v, e := decodeValue(d, depth+1)
			if e != nil {
				return nil, e
			}
			a = append(a, v)
		}
		_, err = d.Token()
		return a, err
	default:
		if _, bad := t.(json.Delim); bad {
			return nil, fmt.Errorf("invalid JSON")
		}
		return t, nil
	}
}

func cancellationCause(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return nil
}
