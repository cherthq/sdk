package chert

import (
	"encoding/json"
	"net/url"
	"strings"
	"unicode/utf8"
)

// Page is one server page. Additional fields remain available in Result.Response.
type Page[T any] struct {
	Items  []T   `json:"items"`
	Total  int64 `json:"total"`
	Limit  int   `json:"limit"`
	Offset int64 `json:"offset"`
}

// Media keeps audio and video capabilities independent.
type Media struct {
	Audio bool `json:"audio"`
	Video bool `json:"video"`
}

// Call is a control-plane snapshot. Status remains open to new server states.
type Call struct {
	ID             string  `json:"id"`
	ProjectID      string  `json:"project_id"`
	Direction      string  `json:"direction"`
	Mode           string  `json:"mode"`
	Status         string  `json:"status"`
	Media          Media   `json:"media"`
	LineID         *string `json:"line_id"`
	AssistantID    *string `json:"assistant_id"`
	TerminalReason *string `json:"terminal_reason"`
	// MediaCapabilities is raw; parse it with ParseMediaCapabilities. Absent means unsupported.
	MediaCapabilities json.RawMessage `json:"media_capabilities,omitempty"`
	// ScreenControl is read-only screen-control consent state (none, requested or
	// granted; empty when absent). The public API exposes no control operations.
	ScreenControl string `json:"screen_control,omitempty"`
}

// Line describes an authorized line; availability is not proof of media readiness.
type Line struct {
	ID             string  `json:"id"`
	LineKey        string  `json:"line_key"`
	DisplayName    string  `json:"display_name"`
	Status         string  `json:"status"`
	WorkerID       *string `json:"worker_id"`
	MaskedIdentity *string `json:"masked_identity"`
	SupportsAudio  bool    `json:"supports_audio"`
	SupportsVideo  bool    `json:"supports_video"`
	// MediaCapabilities is raw; parse it with ParseMediaCapabilities. Absent means unsupported.
	MediaCapabilities json.RawMessage `json:"media_capabilities,omitempty"`
	// VideoComposition is raw; parse it with ParseVideoComposition. Absent means unsupported.
	VideoComposition json.RawMessage `json:"video_composition,omitempty"`
}

// Worker is public inventory, not an administrator diagnostic result.
type Worker struct {
	ID          string `json:"id"`
	WorkerKey   string `json:"worker_key"`
	DisplayName string `json:"display_name"`
	Status      string `json:"status"`
	Enabled     bool   `json:"enabled"`
	// MediaCapabilities is present only on line/call-scoped projections.
	MediaCapabilities json.RawMessage `json:"media_capabilities,omitempty"`
}

// CallEvent records one server event; unknown payload fields remain in the raw response.
type CallEvent struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	At       string `json:"at"`
	Sequence *int64 `json:"sequence"`
	Source   string `json:"source"`
}

// CallEvents is the event collection for a call.
type CallEvents struct {
	CallID string      `json:"call_id"`
	Events []CallEvent `json:"events"`
}

// TranscriptTurn contains private conversation text. Do not log it.
type TranscriptTurn struct {
	OccurredAt string `json:"occurred_at"`
	Speaker    string `json:"speaker"`
	Text       string `json:"text"`
}

// Transcript is the server's stored transcript, not a live subscription.
type Transcript struct {
	CallID        string           `json:"call_id"`
	SchemaVersion int              `json:"schema_version"`
	Turns         []TranscriptTurn `json:"turns"`
	CreatedAt     string           `json:"created_at"`
}

// CallAction names the three supported control commands.
type CallAction string

const (
	Answer CallAction = "answer"
	Reject CallAction = "reject"
	End    CallAction = "end"
)

// Recipient is a group destination of type phone_number or email.
type Recipient struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// CreateCallRequest selects managed or customer_managed execution. Choose either
// Destination (optionally typed phone/email/apple_id/facetime_link) or Recipients.
// BYOR requires an explicit line, audio and all three call-scoped room credentials.
type CreateCallRequest struct {
	Mode                      string      `json:"mode"`
	LineID                    string      `json:"line_id,omitempty"`
	AssistantID               string      `json:"assistant_id,omitempty"`
	Destination               string      `json:"destination,omitempty"`
	DestinationType           string      `json:"destination_type,omitempty"`
	Recipients                []Recipient `json:"recipients,omitempty"`
	Media                     Media       `json:"media"`
	MediaTransport            string      `json:"media_transport,omitempty"`
	MediaURL                  string      `json:"media_url,omitempty"`
	MediaToken                string      `json:"media_token,omitempty"`
	LiveKitURL                string      `json:"livekit_url,omitempty"`
	ParticipantToken          string      `json:"participant_token,omitempty"`
	RemoteParticipantIdentity string      `json:"remote_participant_identity,omitempty"`
}

func (r CreateCallRequest) String() string   { return "CreateCallRequest{redacted}" }
func (r CreateCallRequest) GoString() string { return r.String() }
func (r CreateCallRequest) valid() bool {
	if r.LineID != "" && !uuidPattern.MatchString(r.LineID) {
		return false
	}
	switch r.Mode {
	case "managed":
		if !uuidPattern.MatchString(r.AssistantID) || r.LiveKitURL != "" || r.ParticipantToken != "" || r.RemoteParticipantIdentity != "" || r.MediaTransport != "" || r.MediaURL != "" || r.MediaToken != "" {
			return false
		}
	case "customer_managed":
		if r.AssistantID != "" || r.LineID == "" || !r.Media.Audio {
			return false
		}
		switch r.MediaTransport {
		case "", "livekit":
			if r.MediaURL != "" || r.MediaToken != "" || strings.TrimSpace(r.LiveKitURL) == "" || strings.TrimSpace(r.ParticipantToken) == "" || !participantIdentity(r.RemoteParticipantIdentity) {
				return false
			}
		case "direct":
			if r.LiveKitURL != "" || r.ParticipantToken != "" || !directMediaURL(r.MediaURL) || !directMediaToken(r.MediaToken) || (r.RemoteParticipantIdentity != "" && !participantIdentity(r.RemoteParticipantIdentity)) {
				return false
			}
		default:
			return false
		}
	default:
		return false
	}
	if len(r.Recipients) != 0 {
		if len(r.Recipients) > 31 || r.LineID == "" || r.Destination != "" || r.DestinationType != "" {
			return false
		}
		for _, p := range r.Recipients {
			if (p.Type != "phone_number" && p.Type != "email") || strings.TrimSpace(p.Value) == "" || !utf8.ValidString(p.Value) {
				return false
			}
		}
		return true
	}
	switch r.DestinationType {
	case "", "phone", "email", "apple_id", "facetime_link":
	default:
		return false
	}
	if r.DestinationType == "facetime_link" && r.LineID == "" {
		return false
	}
	return utf8.ValidString(r.Destination) && len(strings.TrimSpace(r.Destination)) >= 3 && len(r.Destination) <= 4096
}

// Assistant contains server-versioned configuration, intentionally retained as JSON.
type Assistant struct {
	ID              string          `json:"id"`
	ProjectID       string          `json:"project_id"`
	Name            string          `json:"name"`
	Description     *string         `json:"description"`
	Status          string          `json:"status"`
	DraftRevision   int64           `json:"draft_revision"`
	DraftConfig     json.RawMessage `json:"draft_config"`
	ActiveVersionID *string         `json:"active_version_id"`
}

// PublishedAssistant identifies the newly published immutable version.
type PublishedAssistant struct {
	Assistant          Assistant `json:"assistant"`
	PublishedVersionID string    `json:"published_version_id"`
}

// CreateAssistantRequest supplies a versioned draft validated by the server.
type CreateAssistantRequest struct {
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	DraftConfig json.RawMessage `json:"draft_config"`
}

// UpdateAssistantRequest preserves absent fields. For Description, nil omits,
// json.RawMessage(`null`) clears, and a JSON string replaces the value.
type UpdateAssistantRequest struct {
	ExpectedDraftRevision int64           `json:"expected_draft_revision"`
	Name                  *string         `json:"name,omitempty"`
	Description           json.RawMessage `json:"description,omitempty"`
	Status                *string         `json:"status,omitempty"`
	DraftConfig           json.RawMessage `json:"draft_config,omitempty"`
}

// UpdateLineRequest preserves omitted fields; nullable bindings use JSON null to
// clear and a JSON UUID string to replace. The server validates policy enums.
type UpdateLineRequest struct {
	DisplayName                *string         `json:"display_name,omitempty"`
	IntegrationID              json.RawMessage `json:"integration_id,omitempty"`
	DefaultAssistantID         json.RawMessage `json:"default_assistant_id,omitempty"`
	InboundPolicy              *string         `json:"inbound_policy,omitempty"`
	VideoFraming               *string         `json:"video_framing,omitempty"`
	ConnectingScreenDismissal  *string         `json:"connecting_screen_dismissal,omitempty"`
	ConnectingScreenAppearance *string         `json:"connecting_screen_appearance,omitempty"`
}

// ProjectSettings contains project-scoped LiveKit allowlist configuration.
type ProjectSettings struct {
	LiveKitAllowedHosts []string `json:"livekit_allowed_hosts"`
}

func participantIdentity(value string) bool {
	trimmed := strings.TrimSpace(value)
	return trimmed != "" && len(trimmed) <= 240
}

func printableASCII(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return true
}

func directMediaURL(value string) bool {
	if len(value) > 2048 || strings.Contains(value, "#") || !printableASCII(value) {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.Hostname() == "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return scheme == "wss" || scheme == "ws"
	}
	return scheme == "wss"
}

func directMediaToken(value string) bool {
	return len(value) >= 16 && len(value) <= 4096 && printableASCII(value)
}
