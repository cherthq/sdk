package chert

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

const mediaGrant = `{"session_id":"0f8fad5b-d9cb-469f-a165-70867728950e","direction":"publish","endpoint":"https://signal.example/whip/s1","token":"grant-secret-token","connect_by":"2026-10-25T10:00:00Z","expires_at":"2026-10-25T12:00:00.5+02:00","ice_servers":[{"urls":"stun:stun.example:3478"},{"urls":["turn:turn.example:3478"],"username":"u","credential":"c","credentialType":"password"}],"codecs":["h264","vp8"],"limits":{"max_width":1920,"max_height":1080,"max_fps":30,"max_frame_bytes":8388608}}`

func patchGrant(t *testing.T, patch string) string {
	t.Helper()
	var base, extra map[string]any
	if json.Unmarshal([]byte(mediaGrant), &base) != nil || json.Unmarshal([]byte(patch), &extra) != nil {
		t.Fatal("bad fixture")
	}
	for k, v := range extra {
		base[k] = v
	}
	out, _ := json.Marshal(base)
	return string(out)
}

// mediaFixture serializes handler state with the test goroutine.
type mediaFixture struct {
	mu     sync.Mutex
	count  int
	bodies []string
	reply  func() (int, string)
}

func (f *mediaFixture) set(reply func() (int, string)) { f.mu.Lock(); f.reply = reply; f.mu.Unlock() }
func (f *mediaFixture) requests() int                  { f.mu.Lock(); defer f.mu.Unlock(); return f.count }

func mediaServer(t *testing.T, f *mediaFixture) (*FaceTimeClient, func()) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.count++
		if r.Method != "POST" || r.URL.RequestURI() != "/api/v1/calls/call-1/media-sessions" || r.Header.Get("Authorization") != "Bearer ft-secret" || r.Header.Get("X-Chert-Project-ID") != "project-1" || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Idempotency-Key") != "" {
			t.Errorf("wire %s %s", r.Method, r.URL.RequestURI())
		}
		body, _ := io.ReadAll(r.Body)
		f.bodies = append(f.bodies, string(body))
		code, payload := f.reply()
		w.WriteHeader(code)
		writeFixture(t, w, payload)
	}))
	c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "ft-secret", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	return c, s.Close
}

func TestCreateMediaSessionRequestAndGrant(t *testing.T) {
	ctx := context.Background()
	f := &mediaFixture{reply: func() (int, string) { return 201, `{"data":` + mediaGrant + `,"request_id":"trace"}` }}
	c, done := mediaServer(t, f)
	defer done()
	r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish})
	if err != nil {
		t.Fatal(err)
	}
	g := r.Data
	if g.Token != "grant-secret-token" || g.Endpoint != "https://signal.example/whip/s1" || g.Direction != MediaPublish || g.Limits != (MediaLimits{1920, 1080, 30, 8388608}) ||
		!reflect.DeepEqual(g.Codecs, []VideoCodec{H264, VP8}) || g.ConnectBy.IsZero() || g.ExpiresAt.IsZero() || r.Response.RequestID != "trace" {
		t.Fatalf("grant %#v", g.Limits)
	}
	if !reflect.DeepEqual(g.ICEServers, []ICEServer{{URLs: []string{"stun:stun.example:3478"}}, {[]string{"turn:turn.example:3478"}, "u", "c", "password"}}) {
		t.Fatal("ice servers")
	}
	if _, err = c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish, Codecs: []VideoCodec{VP8, H264}}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.bodies, []string{`{"direction":"publish"}`, `{"direction":"publish","codecs":["vp8","h264"]}`}) {
		t.Fatalf("bodies %q", f.bodies)
	}
	for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%d", "%x", "%q"} {
		ice := fmt.Sprintf(verb, g.ICEServers[1]) + fmt.Sprintf(verb, &g.ICEServers[1]) + fmt.Sprintf(verb, g.ICEServers)
		if strings.Contains(ice, "turn.example") || strings.Contains(ice, `"c"`) || !strings.Contains(ice, "redacted") {
			t.Fatalf("%s ICE server leaked: %s", verb, ice)
		}
		if s := fmt.Sprintf(verb, g) + fmt.Sprintf(verb, &g) + fmt.Sprintf(verb, r); strings.Contains(s, "grant-secret") || strings.Contains(s, "signal.example") {
			t.Fatalf("%s leaked: %s", verb, s)
		}
	}

	// Local validation: no request.
	before := f.requests()
	for _, bad := range []CreateMediaSessionRequest{{Direction: "both"}, {}, {Direction: MediaPublish, Codecs: []VideoCodec{}}, {Direction: MediaPublish, Codecs: []VideoCodec{"av1"}}, {Direction: MediaPublish, Codecs: []VideoCodec{H264, H264}}} {
		var api *APIError
		if _, err := c.CreateMediaSession(ctx, "call-1", bad); !errors.As(err, &api) || api.Code != "invalid_request" {
			t.Fatalf("accepted %v", bad)
		}
	}
	for _, id := range []string{"", "../x", "a/b"} {
		if _, err := c.CreateMediaSession(ctx, id, CreateMediaSessionRequest{Direction: MediaPublish}); err == nil {
			t.Fatal("bad call id")
		}
	}
	if f.requests() != before {
		t.Fatal("invalid input reached the network")
	}

	// A publish-sized grant is not a valid subscribe grant; each violation is invalid_response.
	subscribe := strings.Replace(mediaGrant, `"direction":"publish"`, `"direction":"subscribe"`, 1)
	cases := []struct {
		direction MediaDirection
		status    int
		body      string
		codecs    []VideoCodec
	}{
		{MediaSubscribe, 201, `{"data":` + subscribe + `,"request_id":"trace"}`, nil},
		{MediaSubscribe, 201, `{"data":` + mediaGrant + `,"request_id":"trace"}`, nil},
		{MediaPublish, 200, `{"data":` + mediaGrant + `,"request_id":"trace"}`, nil},
		{MediaPublish, 201, `{"data":` + mediaGrant + `}`, nil},
		{MediaPublish, 201, `{"data":null,"request_id":"trace"}`, nil},
		{MediaPublish, 201, `not json`, nil},
	}
	for _, patch := range []string{`{"endpoint":"http://signal.example/x"}`, `{"endpoint":"https://u:p@signal.example/x"}`, `{"endpoint":"https://signal.example/x#f"}`, `{"endpoint":"/relative"}`, `{"endpoint":7}`,
		`{"token":"a\r\nb"}`, `{"token":""}`, `{"token":null}`, `{"connect_by":"soon"}`, `{"expires_at":null}`, `{"codecs":["av1"]}`, `{"codecs":[]}`, `{"ice_servers":[{"urls":7}]}`, `{"ice_servers":[{"urls":[1]}]}`, `{"ice_servers":[null]}`, `{"ice_servers":{}}`,
		`{"limits":{"max_width":1920,"max_height":1080,"max_fps":30,"max_frame_bytes":9000000}}`, `{"limits":{"max_width":1920,"max_height":1080,"max_fps":31,"max_frame_bytes":1}}`, `{"limits":{"max_width":1920.5,"max_height":1080,"max_fps":30,"max_frame_bytes":1}}`, `{"limits":{"max_width":0,"max_height":1080,"max_fps":30,"max_frame_bytes":1}}`, `{"limits":null}`,
		`{"session_id":"x"}`, `{"direction":"subscribe"}`,
		// Tightened reference rules: unique codecs, ordered instants, strict ICE servers.
		`{"codecs":["h264","h264"]}`, `{"connect_by":"2026-10-25T10:00:00.002Z","expires_at":"2026-10-25T10:00:00.001Z"}`,
		`{"connect_by":"2026-10-25T10:00:00+00:00","expires_at":"2026-10-25T11:00:00+02:00"}`,
		`{"ice_servers":[{"urls":[]}]}`, `{"ice_servers":[{"urls":"stun:a","username":null}]}`, `{"ice_servers":[{"urls":"stun:a","username":7}]}`,
		`{"ice_servers":[{"urls":"stun:a","credential":null}]}`, `{"ice_servers":[{"urls":"stun:a","credential":{}}]}`,
		`{"ice_servers":[{"urls":"stun:a","credentialType":"oauth"}]}`, `{"ice_servers":[{"urls":"stun:a","credentialType":null}]}`} {
		cases = append(cases, struct {
			direction MediaDirection
			status    int
			body      string
			codecs    []VideoCodec
		}{MediaPublish, 201, `{"data":` + patchGrant(t, patch) + `,"request_id":"trace"}`, nil})
	}
	// A returned codec outside the requested list is rejected.
	cases = append(cases, struct {
		direction MediaDirection
		status    int
		body      string
		codecs    []VideoCodec
	}{MediaPublish, 201, `{"data":` + mediaGrant + `,"request_id":"trace"}`, []VideoCodec{VP8}})
	for _, tc := range cases {
		f.set(func() (int, string) { return tc.status, tc.body })
		before := f.requests()
		r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: tc.direction, Codecs: tc.codecs})
		var api *APIError
		if !errors.As(err, &api) || api.Code != "invalid_response" || f.requests() != before+1 || r.Data.Token != "" || strings.Contains(string(api.Data), "grant-secret") {
			t.Fatalf("accepted invalid grant %s: %v", tc.body, err)
		}
	}
	// Subscribe within 1280x720 and integral floats (JavaScript Number.isInteger) are accepted.
	subscribe = patchGrant(t, `{"direction":"subscribe","endpoint":"http://[::1]:8443/whep","limits":{"max_width":1280,"max_height":720.0,"max_fps":30,"max_frame_bytes":8388608}}`)
	f.set(func() (int, string) { return 201, `{"data":` + subscribe + `,"request_id":"trace"}` })
	if r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaSubscribe}); err != nil || r.Data.Limits.MaxHeight != 720 {
		t.Fatalf("subscribe: %v", err)
	}

	// Accepted: a subset of the requested codecs, equal or ordered instants across offsets
	// (lowercase t/z as in the reference pattern), and complete ICE servers.
	for _, tc := range []struct {
		patch  string
		codecs []VideoCodec
	}{
		{`{"codecs":["h264"]}`, []VideoCodec{VP8, H264}},
		{`{"connect_by":"2026-10-25T10:00:00+02:00","expires_at":"2026-10-25T09:00:00Z"}`, nil},
		{`{"connect_by":"2026-10-25t08:00:00z","expires_at":"2026-10-25T10:00:00.0009+02:00"}`, nil},
		{`{"ice_servers":[{"urls":"","username":"u","credential":"c","credentialType":"password"}]}`, nil},
	} {
		body := `{"data":` + patchGrant(t, tc.patch) + `,"request_id":"trace"}`
		f.set(func() (int, string) { return 201, body })
		if _, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish, Codecs: tc.codecs}); err != nil {
			t.Fatalf("rejected valid grant %s: %v", tc.patch, err)
		}
	}

	// Unknown server codes become request_failed; raw data and response are never returned.
	f.set(func() (int, string) {
		return 418, `{"error":{"code":"internal_detail","message":"internal host 192.0.2.5"},"request_id":"trace"}`
	})
	if r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish}); true {
		var api *APIError
		if !errors.As(err, &api) || api.Status != 418 || api.Code != "request_failed" || api.Data != nil || api.RequestID != "trace" || r.Response.Data != nil || r.Response.Status != 0 {
			t.Fatalf("unknown code: %v %+v", err, r.Response)
		}
	}

	// Server errors surface verbatim codes and never server text.
	for _, tc := range []struct {
		status int
		code   string
	}{{401, "unauthorized"}, {401, "media_session_expired"}, {404, "call_not_found"}, {409, "media_capability_unsupported"}, {409, "media_session_conflict"}, {409, "call_not_active"}, {410, "call_ended"}, {503, "media_transport_unavailable"}} {
		f.set(func() (int, string) {
			return tc.status, `{"error":{"code":"` + tc.code + `","message":"internal host 192.0.2.5"},"request_id":"trace"}`
		})
		before := f.requests()
		_, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish})
		var api *APIError
		if !errors.As(err, &api) || api.Status != tc.status || api.Code != tc.code || f.requests() != before+1 || api.Data != nil ||
			strings.Contains(err.Error(), "192.0.2.5") || strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "192.0.2.5") {
			t.Fatalf("%d %s: %v", tc.status, tc.code, err)
		}
	}
}

func TestParseMediaCapabilities(t *testing.T) {
	full := `{"version":1,"custom_video":{"supported":true,"transports":["whip","livekit","whip"],"codecs":["vp8","h264","vp8"],"max_width":1920,"max_height":1080.0,"max_fps":30},"inbound_caller_video":{"supported":true,"transports":["whep"],"max_width":1280,"max_height":720,"max_fps":15}}`
	got := ParseMediaCapabilities(json.RawMessage(full))
	want := MediaCapabilities{1, &CustomVideoCapability{true, []string{"whip", "livekit"}, []VideoCodec{VP8, H264}, 1920, 1080, 30}, &InboundCallerVideoCapability{true, []string{"whep"}, 1280, 720, 15}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("full %+v", got)
	}
	for _, raw := range []string{``, `null`, `[]`, `"x"`, `{}`, `{"version":2,"custom_video":{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1,"max_height":1,"max_fps":1}}`, `{"version":"1"}`, `not json`} {
		if got := ParseMediaCapabilities(json.RawMessage(raw)); got != (MediaCapabilities{Version: 1}) {
			t.Fatalf("%s supported: %+v", raw, got)
		}
	}
	section := func(cv, iv string) MediaCapabilities {
		return ParseMediaCapabilities(json.RawMessage(`{"version":1,"custom_video":` + cv + `,"inbound_caller_video":` + iv + `}`))
	}
	okIV := `{"supported":true,"transports":["livekit"],"max_width":640,"max_height":360,"max_fps":30}`
	for _, cv := range []string{
		`{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1921,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1920,"max_height":1081,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":31}`,
		`{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":0,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1.5,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["rtmp"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["whip","rtmp"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":[],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"codecs":["av1"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"codecs":[],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":"true","transports":["whip"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`{"supported":false,"transports":["whip"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30}`,
		`[]`, `null`,
	} {
		if got := section(cv, okIV); got.CustomVideo != nil || got.InboundCallerVideo == nil {
			t.Fatalf("custom video %s: %+v", cv, got)
		}
	}
	okCV := `{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":640,"max_height":360,"max_fps":30}`
	for _, iv := range []string{
		`{"supported":true,"transports":["whep"],"max_width":1281,"max_height":720,"max_fps":30}`,
		`{"supported":true,"transports":["whep"],"max_width":1280,"max_height":721,"max_fps":30}`,
		`{"supported":true,"transports":["whip"],"max_width":1280,"max_height":720,"max_fps":30}`,
		`{"supported":true,"transports":"whep","max_width":1280,"max_height":720,"max_fps":30}`,
	} {
		if got := section(okCV, iv); got.InboundCallerVideo != nil || got.CustomVideo == nil {
			t.Fatalf("inbound video %s: %+v", iv, got)
		}
	}
	// Generic flags never imply support.
	var line Line
	if json.Unmarshal([]byte(`{"id":"l","status":"available","supports_audio":true,"supports_video":true}`), &line) != nil || ParseMediaCapabilities(line.MediaCapabilities) != (MediaCapabilities{Version: 1}) {
		t.Fatal("inferred from supports_video")
	}
}

func TestCopyVideoFrame(t *testing.T) {
	buf := func(n int) []byte { return make([]byte, n) }
	i420 := VideoFrame{Format: I420, Width: 16, Height: 16, Planes: []Plane{{buf(16 * 16), 16}, {buf(8 * 8), 8}, {buf(8 * 8), 8}}, TimestampUs: 0}
	frame, err := CopyVideoFrame(i420)
	if err != nil || frame.ColorSpace != BT709Limited || frame.Rotation != 0 {
		t.Fatalf("i420: %v", err)
	}
	// Copies exactly stride*(rows-1)+rowBytes, detached from caller memory.
	src := make([]byte, 100*20)
	src[0] = 7
	rgba := VideoFrame{Format: RGBA, Width: 16, Height: 20, Planes: []Plane{{src, 100}}, TimestampUs: 5, Rotation: 270}
	frame, err = CopyVideoFrame(rgba)
	if err != nil || len(frame.Planes[0].Data) != 100*19+64 || frame.ColorSpace != SRGBFull || frame.Rotation != 270 {
		t.Fatalf("rgba: %v", err)
	}
	src[0] = 9
	if frame.Planes[0].Data[0] != 7 || &frame.Planes[0] == &rgba.Planes[0] {
		t.Fatal("frame aliases caller memory")
	}
	nv12 := VideoFrame{Format: NV12, Width: 1920, Height: 1080, Planes: []Plane{{buf(1920 * 1080), 1920}, {buf(1920 * 540), 1920}}, ColorSpace: BT601Limited}
	if frame, err = CopyVideoFrame(nv12); err != nil || frame.ColorSpace != BT601Limited {
		t.Fatalf("nv12: %v", err)
	}
	if _, err = CopyVideoFrame(VideoFrame{Format: BGRA, Width: 1920, Height: 1080, Planes: []Plane{{buf(7680 * 1080), 7680}}}); err != nil {
		t.Fatalf("max bgra: %v", err)
	}
	code := func(f VideoFrame) string {
		_, err := CopyVideoFrame(f)
		var frameErr *MediaFrameError
		if !errors.As(err, &frameErr) {
			return ""
		}
		return frameErr.Code
	}
	if c := code(VideoFrame{Format: RGBA, Width: 1920, Height: 1080, Planes: []Plane{{buf(7936 * 1080), 7936}}}); c != "frame_too_large" {
		t.Fatalf("8 MiB bound: %q", c)
	}
	with := func(f VideoFrame, edit func(*VideoFrame)) VideoFrame {
		f.Planes = append([]Plane(nil), f.Planes...)
		edit(&f)
		return f
	}
	for name, bad := range map[string]VideoFrame{
		"format":      with(i420, func(f *VideoFrame) { f.Format = "yuy2" }),
		"odd":         with(i420, func(f *VideoFrame) { f.Width = 17 }),
		"small":       with(i420, func(f *VideoFrame) { f.Width, f.Height = 14, 14 }),
		"wide":        with(nv12, func(f *VideoFrame) { f.Width = 1922 }),
		"tall":        with(nv12, func(f *VideoFrame) { f.Height = 1082 }),
		"timestamp":   with(i420, func(f *VideoFrame) { f.TimestampUs = -1 }),
		"duration":    with(i420, func(f *VideoFrame) { f.DurationUs = -1 }),
		"rotation":    with(i420, func(f *VideoFrame) { f.Rotation = 45 }),
		"color":       with(i420, func(f *VideoFrame) { f.ColorSpace = "p3" }),
		"planes":      with(i420, func(f *VideoFrame) { f.Planes = f.Planes[:2] }),
		"low stride":  with(i420, func(f *VideoFrame) { f.Planes[1].Stride = 7 }),
		"high stride": with(i420, func(f *VideoFrame) { f.Planes[0].Stride = 16 + 257 }),
		"short":       with(i420, func(f *VideoFrame) { f.Planes[2].Data = buf(8*8 - 1) }),
	} {
		if c := code(bad); c != "invalid_frame" {
			t.Fatalf("%s: %q", name, c)
		}
	}
	if code(with(i420, func(f *VideoFrame) { f.Planes[0] = Plane{buf(272*15 + 16), 16 + 256} })) != "" {
		t.Fatal("max stride padding rejected")
	}
}
