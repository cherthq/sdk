package chert

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

// MediaDirection selects WHIP publish or experimental WHEP subscribe. v1 is video-only.
type MediaDirection string

const (
	MediaPublish   MediaDirection = "publish"
	MediaSubscribe MediaDirection = "subscribe"
)

// VideoCodec is a v1 custom-video codec. H.264 uses Annex B byte streams.
type VideoCodec string

const (
	H264 VideoCodec = "h264"
	VP8  VideoCodec = "vp8"
)

// MediaSessionContent is what a session carries. Publish: camera (default) or
// screen (an agent's screen, capped at 15 fps). Subscribe: empty for the
// caller's video, or caller_screen for the caller's shared screen (only while
// sharing). A call has one publish slot (media_session_conflict).
type MediaSessionContent string

const (
	MediaContentCamera       MediaSessionContent = "camera"
	MediaContentScreen       MediaSessionContent = "screen"
	MediaContentCallerScreen MediaSessionContent = "caller_screen"
)

// CreateMediaSessionRequest omits codecs when nil and content when empty. A
// non-nil codecs list must be a non-empty ordered unique subset of h264 and vp8.
// Content must be camera or screen for publish, or caller_screen for subscribe.
type CreateMediaSessionRequest struct {
	Direction MediaDirection      `json:"direction"`
	Codecs    []VideoCodec        `json:"codecs,omitempty"`
	Content   MediaSessionContent `json:"content,omitempty"`
}

func validContent(direction MediaDirection, content MediaSessionContent) bool {
	if direction == MediaPublish {
		return content == "" || content == MediaContentCamera || content == MediaContentScreen
	}
	return content == "" || content == MediaContentCallerScreen
}

// ICEServer mirrors the WebRTC RTCIceServer shape. URLs has at least one entry
// (a single wire string becomes one entry). Formatting redacts the credential.
type ICEServer struct {
	URLs           []string
	Username       string
	Credential     string
	CredentialType string
}

func (s ICEServer) String() string             { return "ICEServer{redacted}" }
func (s ICEServer) GoString() string           { return s.String() }
func (s ICEServer) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, s.String()) }

// MediaLimits are server-granted bounds for one session.
type MediaLimits struct {
	MaxWidth, MaxHeight, MaxFPS int
	MaxFrameBytes               int
}

// MediaSessionGrant is one session-bound signaling grant. Endpoint is opaque:
// pass it with Token to a standard WHIP (RFC 9725) or WHEP client and send the
// same bearer on PATCH/DELETE to the returned Location. Formatting redacts it.
type MediaSessionGrant struct {
	SessionID  string
	Direction  MediaDirection
	Endpoint   string
	Token      string
	ConnectBy  time.Time
	ExpiresAt  time.Time
	ICEServers []ICEServer
	Codecs     []VideoCodec
	Limits     MediaLimits
	// Content echoes the requested content; empty on grants for the default content.
	Content MediaSessionContent
}

func (g MediaSessionGrant) String() string             { return "MediaSessionGrant{redacted}" }
func (g MediaSessionGrant) GoString() string           { return g.String() }
func (g MediaSessionGrant) Format(f fmt.State, _ rune) { _, _ = fmt.Fprint(f, g.String()) }

func validCodecs(codecs []VideoCodec) bool {
	seen := map[VideoCodec]bool{}
	for _, c := range codecs {
		if (c != H264 && c != VP8) || seen[c] {
			return false
		}
		seen[c] = true
	}
	return len(codecs) > 0
}

// CreateMediaSession mints one WHIP (publish) or experimental WHEP (subscribe)
// session for an active call. It is a single attempt and never retried.
func (c *FaceTimeClient) CreateMediaSession(ctx context.Context, callID string, input CreateMediaSessionRequest) (Result[MediaSessionGrant], error) {
	path := resource("calls", callID, "/media-sessions")
	if path == "" || (input.Direction != MediaPublish && input.Direction != MediaSubscribe) || input.Codecs != nil && !validCodecs(input.Codecs) || !validContent(input.Direction, input.Content) {
		return Result[MediaSessionGrant]{}, invalid()
	}
	r, err := c.Request(ctx, "POST", path, input, FaceTimeRequestOptions{Auth: ProjectAuth})
	if err != nil {
		return Result[MediaSessionGrant]{}, mediaError(err)
	}
	var envelope struct {
		Data      json.RawMessage `json:"data"`
		RequestID string          `json:"request_id"`
	}
	var grant MediaSessionGrant
	ok := r.Status == 201 && json.Unmarshal(r.Data, &envelope) == nil && envelope.RequestID != ""
	if ok {
		grant, ok = parseGrant(envelope.Data, input.Direction, input.Codecs, input.Content)
	}
	if !ok {
		// Raw data is withheld: an invalid grant may still carry a bearer token.
		return Result[MediaSessionGrant]{}, &APIError{Status: r.Status, Code: "invalid_response", RequestID: r.RequestID}
	}
	return Result[MediaSessionGrant]{grant, r}, nil
}

// mediaSafeCodes are the server error codes surfaced verbatim; others become request_failed.
var mediaSafeCodes = map[string]bool{
	"unauthorized": true, "forbidden": true, "cli_scope_denied": true, "billing_owner_required": true, "billing_unavailable": true,
	"project_required": true, "invalid_request": true, "cli_login_expired": true, "cli_login_not_found": true, "cli_login_forbidden": true,
	"slow_down": true, "cli_login_rate_limited": true, "cli_login_busy": true, "not_found": true, "conflict": true,
	"media_capability_unsupported": true, "media_session_conflict": true, "caller_screen_not_shared": true, "call_not_active": true, "call_ended": true,
	"call_not_found": true, "media_session_expired": true, "media_transport_unavailable": true,
}

// mediaError never returns raw response data. Server error responses keep their status
// and an allowlisted code; local and transport errors keep their code.
func mediaError(err error) error {
	api, ok := err.(*APIError)
	if !ok {
		return err
	}
	out := &APIError{Status: api.Status, Code: api.Code, RequestID: api.RequestID, cause: api.cause}
	if api.Status >= 300 && api.Data != nil && !mediaSafeCodes[api.Code] {
		out.Code = "request_failed"
	}
	return out
}

var sessionIDPattern = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

// jsInteger matches JavaScript Number.isInteger(v) && 0 < v <= max.
func jsInteger(v any, max float64) (int, bool) {
	n, ok := v.(float64)
	if !ok || n <= 0 || n > max || math.Trunc(n) != n {
		return 0, false
	}
	return int(n), true
}

var rfc3339Pattern = regexp.MustCompile(`^(?i)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$`)

// rfc3339 accepts lowercase t/z like the reference SDK; Go's layout needs uppercase.
func rfc3339(v any) (time.Time, bool) {
	s, ok := v.(string)
	if !ok || !rfc3339Pattern.MatchString(s) {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, strings.ToUpper(s))
	return t, err == nil
}

func optionalString(o map[string]any, field string) (string, bool) {
	v, present := o[field]
	s, ok := v.(string)
	return s, ok || !present
}

func mediaEndpoint(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Opaque != "" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return u.Scheme == "https" || u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "::1")
}

func parseGrant(raw json.RawMessage, direction MediaDirection, requested []VideoCodec, content MediaSessionContent) (MediaSessionGrant, bool) {
	var g MediaSessionGrant
	var o map[string]any
	if json.Unmarshal(raw, &o) != nil || o == nil {
		return g, false
	}
	// A requested content must be echoed exactly; a default request accepts no echo or camera (either direction).
	echo, present := o["content"]
	if content != "" && echo != string(content) ||
		content == "" && present && echo != string(MediaContentCamera) {
		return g, false
	}
	if present {
		g.Content = MediaSessionContent(echo.(string))
	}
	maxFPS := 30.0
	if g.Content == MediaContentScreen {
		maxFPS = 15
	}
	endpoint, _ := o["endpoint"].(string)
	token, _ := o["token"].(string)
	id, _ := o["session_id"].(string)
	connectBy, okConnect := rfc3339(o["connect_by"])
	expiresAt, okExpires := rfc3339(o["expires_at"])
	if o["direction"] != string(direction) || !sessionIDPattern.MatchString(id) || !mediaEndpoint(endpoint) ||
		token == "" || strings.ContainsAny(token, "\r\n") || !okConnect || !okExpires ||
		connectBy.UnixMilli() > expiresAt.UnixMilli() { // Millisecond instants, as JavaScript Date.parse compares.
		return g, false
	}
	servers, ok := o["ice_servers"].([]any)
	if !ok {
		return g, false
	}
	for _, item := range servers {
		s, ok := item.(map[string]any)
		if !ok {
			return g, false
		}
		var server ICEServer
		switch urls := s["urls"].(type) {
		case string:
			server.URLs = []string{urls}
		case []any:
			if len(urls) == 0 {
				return g, false
			}
			for _, u := range urls {
				text, ok := u.(string)
				if !ok {
					return g, false
				}
				server.URLs = append(server.URLs, text)
			}
		default:
			return g, false
		}
		// Optional fields must be absent or strings (JSON null rejects); credentialType is only "password".
		var okUser, okCredential bool
		server.Username, okUser = optionalString(s, "username")
		server.Credential, okCredential = optionalString(s, "credential")
		if credentialType, present := s["credentialType"]; present {
			if credentialType != "password" {
				return g, false
			}
			server.CredentialType = "password"
		}
		if !okUser || !okCredential {
			return g, false
		}
		g.ICEServers = append(g.ICEServers, server)
	}
	codecs, ok := o["codecs"].([]any)
	if !ok || len(codecs) == 0 {
		return g, false
	}
	seen := map[any]bool{}
	for _, c := range codecs {
		if c != string(H264) && c != string(VP8) || seen[c] || requested != nil && !slices.Contains(requested, VideoCodec(c.(string))) {
			return g, false
		}
		seen[c] = true
		g.Codecs = append(g.Codecs, VideoCodec(c.(string)))
	}
	width, height := 1920.0, 1080.0
	if direction == MediaSubscribe {
		width, height = 1280, 720
	}
	limits, _ := o["limits"].(map[string]any)
	var okW, okH, okF, okB bool
	g.Limits.MaxWidth, okW = jsInteger(limits["max_width"], width)
	g.Limits.MaxHeight, okH = jsInteger(limits["max_height"], height)
	g.Limits.MaxFPS, okF = jsInteger(limits["max_fps"], maxFPS)
	g.Limits.MaxFrameBytes, okB = jsInteger(limits["max_frame_bytes"], MaxFrameBytes)
	if !okW || !okH || !okF || !okB {
		return g, false
	}
	if g.ICEServers == nil {
		g.ICEServers = []ICEServer{}
	}
	g.SessionID, g.Direction, g.Endpoint, g.Token, g.ConnectBy, g.ExpiresAt = id, direction, endpoint, token, connectBy, expiresAt
	return g, true
}

// MediaCapabilities is the explicit, versioned media_capabilities object. A nil
// section is unsupported. Never infer support from generic video flags.
type MediaCapabilities struct {
	Version            int                           `json:"version"`
	CustomVideo        *CustomVideoCapability        `json:"custom_video"`
	InboundCallerVideo *InboundCallerVideoCapability `json:"inbound_caller_video"`
}

// CustomVideoCapability describes customer-published video (WHIP or LiveKit).
type CustomVideoCapability struct {
	Supported  bool         `json:"supported"`
	Transports []string     `json:"transports"`
	Codecs     []VideoCodec `json:"codecs"`
	MaxWidth   int          `json:"max_width"`
	MaxHeight  int          `json:"max_height"`
	MaxFPS     int          `json:"max_fps"`
	// Contents lists what may be published (camera, screen); never empty.
	Contents []MediaSessionContent `json:"contents"`
}

// InboundCallerVideoCapability describes caller video delivered to the customer (WHEP or LiveKit).
type InboundCallerVideoCapability struct {
	Supported  bool     `json:"supported"`
	Transports []string `json:"transports"`
	MaxWidth   int      `json:"max_width"`
	MaxHeight  int      `json:"max_height"`
	MaxFPS     int      `json:"max_fps"`
	// Contents lists what may be received (camera, screen); screen means a
	// caller_screen subscription is available. Never empty.
	Contents []MediaSessionContent `json:"contents"`
}

func allowedList(v any, allowed ...string) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	seen := map[string]bool{}
	for _, item := range items {
		s, _ := item.(string)
		valid := false
		for _, a := range allowed {
			valid = valid || item == a
		}
		if !valid {
			return nil
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// mediaContents ignores unknown entries for forward compatibility; absent or empty means camera only.
func mediaContents(v any) []MediaSessionContent {
	items, _ := v.([]any)
	out := []MediaSessionContent{}
	for _, item := range items {
		s, _ := item.(string)
		c := MediaSessionContent(s)
		if (c == MediaContentCamera || c == MediaContentScreen) && !slices.Contains(out, c) {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		out = append(out, MediaContentCamera)
	}
	return out
}

// ParseMediaCapabilities parses a raw media_capabilities value. Absent, malformed
// or unknown-version input is unsupported; a malformed section disables only that
// section. Bounds are capped at SDK v1 limits.
func ParseMediaCapabilities(raw json.RawMessage) MediaCapabilities {
	out := MediaCapabilities{Version: 1}
	var o map[string]any
	if json.Unmarshal(raw, &o) != nil || o == nil || o["version"] != 1.0 {
		return out
	}
	if cv, _ := o["custom_video"].(map[string]any); cv != nil && cv["supported"] == true {
		transports, codecs := allowedList(cv["transports"], "whip", "livekit"), allowedList(cv["codecs"], "h264", "vp8")
		w, okW := jsInteger(cv["max_width"], 1920)
		h, okH := jsInteger(cv["max_height"], 1080)
		f, okF := jsInteger(cv["max_fps"], 30)
		if len(transports) > 0 && len(codecs) > 0 && okW && okH && okF {
			typed := make([]VideoCodec, len(codecs))
			for i, c := range codecs {
				typed[i] = VideoCodec(c)
			}
			out.CustomVideo = &CustomVideoCapability{true, transports, typed, w, h, f, mediaContents(cv["contents"])}
		}
	}
	if iv, _ := o["inbound_caller_video"].(map[string]any); iv != nil && iv["supported"] == true {
		transports := allowedList(iv["transports"], "whep", "livekit")
		w, okW := jsInteger(iv["max_width"], 1280)
		h, okH := jsInteger(iv["max_height"], 720)
		f, okF := jsInteger(iv["max_fps"], 30)
		if len(transports) > 0 && okW && okH && okF {
			out.InboundCallerVideo = &InboundCallerVideoCapability{true, transports, w, h, f, mediaContents(iv["contents"])}
		}
	}
	return out
}

// PixelFormat is a portable raw video layout.
type PixelFormat string

const (
	I420 PixelFormat = "i420"
	NV12 PixelFormat = "nv12"
	RGBA PixelFormat = "rgba"
	BGRA PixelFormat = "bgra"
)

// ColorSpace defaults to bt709-limited for YUV and srgb-full for RGB when empty.
type ColorSpace string

const (
	BT709Limited ColorSpace = "bt709-limited"
	BT601Limited ColorSpace = "bt601-limited"
	SRGBFull     ColorSpace = "srgb-full"
)

// v1 raw frame bounds.
const (
	MaxFrameWidth  = 1920
	MaxFrameHeight = 1080
	MinFrameSide   = 16
	MaxFrameBytes  = 8 * 1024 * 1024
)

// Plane is one image plane; Stride is bytes per row.
type Plane struct {
	Data   []byte
	Stride int
}

// VideoFrame is a raw frame descriptor. TimestampUs is monotonic microseconds
// from the source clock. DurationUs zero means absent. Rotation is clockwise degrees.
type VideoFrame struct {
	Format        PixelFormat
	Width, Height int
	Planes        []Plane
	TimestampUs   int64
	DurationUs    int64
	Rotation      int
	ColorSpace    ColorSpace
}

// MediaFrameError reports Code "invalid_frame" or "frame_too_large".
type MediaFrameError struct {
	Code    string
	message string
}

func (e *MediaFrameError) Error() string { return e.message }

func frameError(code, format string, args ...any) error {
	return &MediaFrameError{code, fmt.Sprintf(format, args...)}
}

// CheckFrameDimensions requires even sides between 16x16 and 1920x1080.
func CheckFrameDimensions(width, height int) error {
	if width%2 != 0 || height%2 != 0 || width < MinFrameSide || height < MinFrameSide || width > MaxFrameWidth || height > MaxFrameHeight {
		return frameError("invalid_frame", "Dimensions must be even integers between %d and %dx%d.", MinFrameSide, MaxFrameWidth, MaxFrameHeight)
	}
	return nil
}

// CopyVideoFrame validates a raw frame and copies only the bytes each plane
// requires (stride*(rows-1)+rowBytes), so callers may reuse their buffers.
func CopyVideoFrame(in VideoFrame) (VideoFrame, error) {
	type layout struct{ rowBytes, rows int }
	var planes []layout
	cw, ch := in.Width/2, in.Height/2
	switch in.Format {
	case RGBA, BGRA:
		planes = []layout{{in.Width * 4, in.Height}}
	case I420:
		planes = []layout{{in.Width, in.Height}, {cw, ch}, {cw, ch}}
	case NV12:
		planes = []layout{{in.Width, in.Height}, {in.Width, ch}}
	default:
		return VideoFrame{}, frameError("invalid_frame", "Unsupported pixel format.")
	}
	if err := CheckFrameDimensions(in.Width, in.Height); err != nil {
		return VideoFrame{}, err
	}
	if in.TimestampUs < 0 {
		return VideoFrame{}, frameError("invalid_frame", "TimestampUs must be non-negative.")
	}
	if in.DurationUs < 0 {
		return VideoFrame{}, frameError("invalid_frame", "DurationUs must be positive when set.")
	}
	if in.Rotation != 0 && in.Rotation != 90 && in.Rotation != 180 && in.Rotation != 270 {
		return VideoFrame{}, frameError("invalid_frame", "Unsupported rotation.")
	}
	if in.ColorSpace != "" && in.ColorSpace != BT709Limited && in.ColorSpace != BT601Limited && in.ColorSpace != SRGBFull {
		return VideoFrame{}, frameError("invalid_frame", "Unsupported color space.")
	}
	if len(in.Planes) != len(planes) {
		return VideoFrame{}, frameError("invalid_frame", "%s requires %d plane(s).", in.Format, len(planes))
	}
	out := in
	out.Planes = make([]Plane, len(planes))
	total := 0
	for i, p := range in.Planes {
		l := planes[i]
		if p.Stride < l.rowBytes || p.Stride > l.rowBytes+256 {
			return VideoFrame{}, frameError("invalid_frame", "Plane %d stride must be between %d and %d bytes.", i, l.rowBytes, l.rowBytes+256)
		}
		needed := p.Stride*(l.rows-1) + l.rowBytes
		if len(p.Data) < needed {
			return VideoFrame{}, frameError("invalid_frame", "Plane %d needs at least %d bytes.", i, needed)
		}
		total += needed
		if total > MaxFrameBytes {
			return VideoFrame{}, frameError("frame_too_large", "Frame exceeds 8 MiB.")
		}
		out.Planes[i] = Plane{append([]byte(nil), p.Data[:needed]...), p.Stride}
	}
	if out.ColorSpace == "" {
		out.ColorSpace = SRGBFull
		if in.Format == I420 || in.Format == NV12 {
			out.ColorSpace = BT709Limited
		}
	}
	return out, nil
}
