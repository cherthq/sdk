package chert

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

// MessagingEvent is a recorded event, not proof of recipient delivery.
type MessagingEvent struct {
	ID        string                     `json:"id"`
	Type      string                     `json:"type"`
	EventID   string                     `json:"event_id"`
	LeadID    *string                    `json:"lead_id"`
	ConvoID   *string                    `json:"convo_id"`
	Payload   map[string]json.RawMessage `json:"payload"`
	CreatedAt string                     `json:"created_at"`
}

// WebhookDeliveryAttempt describes one webhook HTTP attempt.
type WebhookDeliveryAttempt struct {
	At         string  `json:"at"`
	Status     *int    `json:"status"`
	DurationMS float64 `json:"duration_ms"`
	Error      *string `json:"error,omitempty"`
}

// WebhookDelivery is webhook delivery state, not iMessage delivery state.
type WebhookDelivery struct {
	Status      string                   `json:"status"`
	URL         *string                  `json:"url"`
	Attempts    []WebhookDeliveryAttempt `json:"attempts"`
	DeliveredAt *string                  `json:"delivered_at"`
}

// RecordedMessagingEvent includes webhook delivery metadata.
type RecordedMessagingEvent struct {
	MessagingEvent
	Delivery  WebhookDelivery `json:"delivery"`
	UpdatedAt *string         `json:"updated_at,omitempty"`
}

// MessagingEventPage is one page; NextCursor is opaque and nullable.
type MessagingEventPage struct {
	Events     []RecordedMessagingEvent `json:"events"`
	NextCursor *string                  `json:"next_cursor"`
	Count      int                      `json:"count"`
}

// EventListOptions filters a single page. Nil Limit uses the server default.
// Status filters webhook delivery; Since and Cursor are not stream continuation tokens.
type EventListOptions struct {
	Type, Status, LeadID, Since, Cursor string
	Limit                               *int
}

// WebhookSubscription describes a registered webhook endpoint.
type WebhookSubscription struct {
	ID                  string   `json:"id"`
	URL                 string   `json:"url"`
	Events              []string `json:"events"`
	Version             string   `json:"version"`
	IsActive            bool     `json:"is_active"`
	CreatedAt           string   `json:"created_at"`
	ConsecutiveFailures *int     `json:"consecutive_failures,omitempty"`
	LastSuccessAt       *string  `json:"last_success_at,omitempty"`
	LastFailureAt       *string  `json:"last_failure_at,omitempty"`
	UpdatedAt           *string  `json:"updated_at,omitempty"`
}

// CreateWebhookSubscription supplies public creation fields; nil Events omits it.
type CreateWebhookSubscription struct {
	URL     string    `json:"url"`
	Events  *[]string `json:"events,omitempty"`
	Version *string   `json:"version,omitempty"`
}

// UpdateWebhookSubscription distinguishes omitted fields from false or empty values.
type UpdateWebhookSubscription struct {
	URL      *string   `json:"url,omitempty"`
	Events   *[]string `json:"events,omitempty"`
	Version  *string   `json:"version,omitempty"`
	IsActive *bool     `json:"is_active,omitempty"`
}

// WebhookSubscriptions is the collection response.
type WebhookSubscriptions struct {
	Subscriptions []WebhookSubscription `json:"subscriptions"`
}

// WebhookSubscriptionResult is the item response.
type WebhookSubscriptionResult struct {
	Subscription WebhookSubscription `json:"subscription"`
}

// CreatedWebhookSubscription contains the one-time signing secret.
type CreatedWebhookSubscription struct {
	WebhookSubscription
	Secret string `json:"secret"`
}

func (v CreatedWebhookSubscription) String() string   { return "CreatedWebhookSubscription{redacted}" }
func (v CreatedWebhookSubscription) GoString() string { return v.String() }

// CreatedWebhookSubscriptionResult is the creation response; protect its secret.
type CreatedWebhookSubscriptionResult struct {
	Subscription CreatedWebhookSubscription `json:"subscription"`
}

// DeletedWebhookSubscription reports deletion of a subscription, not event history.
type DeletedWebhookSubscription struct {
	Deleted bool   `json:"deleted"`
	ID      string `json:"id"`
}

func messagingResult[T any](ctx context.Context, c *Client, method, path string, body any) (Result[T], error) {
	r, err := c.Request(ctx, method, path, body)
	out := Result[T]{Response: r}
	if err != nil {
		return out, err
	}
	if bytes.Equal(bytes.TrimSpace(r.Data), []byte("null")) || json.Unmarshal(r.Data, &out.Data) != nil {
		return out, &APIError{Status: r.Status, Code: "invalid_response", RequestID: r.RequestID}
	}
	return out, nil
}

// ListEvents fetches one event page without polling or automatic pagination.
func (c *Client) ListEvents(ctx context.Context, options EventListOptions) (Result[MessagingEventPage], error) {
	q := url.Values{}
	for k, v := range map[string]string{"type": options.Type, "status": options.Status, "lead_id": options.LeadID, "since": options.Since, "cursor": options.Cursor} {
		if v != "" {
			q.Set(k, v)
		}
	}
	if options.Limit != nil {
		if *options.Limit < 1 || *options.Limit > 200 {
			return Result[MessagingEventPage]{}, invalid()
		}
		q.Set("limit", strconv.Itoa(*options.Limit))
	}
	return messagingResult[MessagingEventPage](ctx, c, "GET", "/events?"+q.Encode(), nil)
}

// GetEvent addresses the recorded row ID, not the payload event_id.
func (c *Client) GetEvent(ctx context.Context, rowID string) (Result[RecordedMessagingEvent], error) {
	return messagingResult[RecordedMessagingEvent](ctx, c, "GET", resource("events", rowID, ""), nil)
}

// ListWebhookSubscriptions fetches configured webhook subscriptions.
func (c *Client) ListWebhookSubscriptions(ctx context.Context) (Result[WebhookSubscriptions], error) {
	return messagingResult[WebhookSubscriptions](ctx, c, "GET", "/webhook-subscriptions", nil)
}

// GetWebhookSubscription fetches one subscription.
func (c *Client) GetWebhookSubscription(ctx context.Context, id string) (Result[WebhookSubscriptionResult], error) {
	return messagingResult[WebhookSubscriptionResult](ctx, c, "GET", resource("webhook-subscriptions", id, ""), nil)
}

// CreateWebhookSubscription makes one creation attempt; it never retries.
func (c *Client) CreateWebhookSubscription(ctx context.Context, input CreateWebhookSubscription) (Result[CreatedWebhookSubscriptionResult], error) {
	return messagingResult[CreatedWebhookSubscriptionResult](ctx, c, "POST", "/webhook-subscriptions", input)
}

// UpdateWebhookSubscription patches only supplied public fields.
func (c *Client) UpdateWebhookSubscription(ctx context.Context, id string, input UpdateWebhookSubscription) (Result[WebhookSubscriptionResult], error) {
	return messagingResult[WebhookSubscriptionResult](ctx, c, "PATCH", resource("webhook-subscriptions", id, ""), input)
}

// DeleteWebhookSubscription makes one deletion attempt.
func (c *Client) DeleteWebhookSubscription(ctx context.Context, id string) (Result[DeletedWebhookSubscription], error) {
	return messagingResult[DeletedWebhookSubscription](ctx, c, "DELETE", resource("webhook-subscriptions", id, ""), nil)
}

var webhookSignaturePattern = regexp.MustCompile(`^v1,([0-9]+),([a-fA-F0-9]{64})$`)

// VerifyWebhook verifies v1,timestamp,hex over timestamp+'.'+exact raw body.
// Verify before JSON parsing. Timestamps must be within 300 seconds of now.
func VerifyWebhook(rawBody []byte, signature, secret string) bool {
	return verifyWebhookAt(rawBody, signature, secret, time.Now())
}
func verifyWebhookAt(rawBody []byte, signature, secret string, now time.Time) bool {
	m := webhookSignaturePattern.FindStringSubmatch(signature)
	if m == nil || secret == "" {
		return false
	}
	ts, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil || ts > 9007199254740991 {
		return false
	}
	delta := float64(now.Unix()) + float64(now.Nanosecond())/1e9 - float64(ts)
	if delta < -300 || delta > 300 {
		return false
	}
	digest, err := hex.DecodeString(m[2])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(m[1] + "."))
	mac.Write(rawBody)
	return hmac.Equal(digest, mac.Sum(nil))
}
