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
	"slices"
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

func TestScreenMediaSessions(t *testing.T) {
	ctx := context.Background()
	screen := patchGrant(t, `{"content":"screen","limits":{"max_width":1920,"max_height":1080,"max_fps":15,"max_frame_bytes":8388608}}`)
	callerScreen := patchGrant(t, `{"direction":"subscribe","content":"caller_screen","limits":{"max_width":1280,"max_height":720,"max_fps":30,"max_frame_bytes":8388608}}`)
	reply := func(data string) func() (int, string) {
		return func() (int, string) { return 201, `{"data":` + data + `,"request_id":"trace"}` }
	}
	f := &mediaFixture{reply: reply(screen)}
	c, done := mediaServer(t, f)
	defer done()
	r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish, Content: MediaContentScreen})
	if err != nil || r.Data.Content != MediaContentScreen || r.Data.Limits.MaxFPS != 15 {
		t.Fatalf("screen: %v %v", err, r.Data.Content)
	}
	f.set(reply(callerScreen))
	r, err = c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaSubscribe, Content: MediaContentCallerScreen})
	if err != nil || r.Data.Content != MediaContentCallerScreen {
		t.Fatalf("caller screen: %v", err)
	}
	if !reflect.DeepEqual(f.bodies, []string{`{"direction":"publish","content":"screen"}`, `{"direction":"subscribe","content":"caller_screen"}`}) {
		t.Fatalf("bodies %q", f.bodies)
	}

	// Wrong combinations fail locally with no request.
	for _, bad := range []CreateMediaSessionRequest{{Direction: MediaPublish, Content: MediaContentCallerScreen}, {Direction: MediaSubscribe, Content: MediaContentScreen}, {Direction: MediaSubscribe, Content: MediaContentCamera}, {Direction: MediaPublish, Content: "window"}} {
		var api *APIError
		if _, err := c.CreateMediaSession(ctx, "call-1", bad); !errors.As(err, &api) || api.Code != "invalid_request" {
			t.Fatalf("accepted %v", bad)
		}
	}
	if f.requests() != 2 {
		t.Fatal("invalid content reached the network")
	}

	// A screen grant above 15 fps, a missing or different echo, or an echo on a default request is a contract violation.
	var noEcho map[string]any
	_ = json.Unmarshal([]byte(screen), &noEcho)
	delete(noEcho, "content")
	missing, _ := json.Marshal(noEcho)
	for _, tc := range []struct {
		input CreateMediaSessionRequest
		data  string
	}{
		{CreateMediaSessionRequest{Direction: MediaPublish, Content: MediaContentScreen}, patchGrant(t, `{"content":"screen"}`)},
		{CreateMediaSessionRequest{Direction: MediaPublish, Content: MediaContentScreen}, string(missing)},
		{CreateMediaSessionRequest{Direction: MediaPublish, Content: MediaContentScreen}, patchGrant(t, `{"content":"camera","limits":{"max_width":1920,"max_height":1080,"max_fps":15,"max_frame_bytes":8388608}}`)},
		{CreateMediaSessionRequest{Direction: MediaPublish}, screen},
		{CreateMediaSessionRequest{Direction: MediaSubscribe}, callerScreen},
	} {
		f.set(reply(tc.data))
		var api *APIError
		if _, err := c.CreateMediaSession(ctx, "call-1", tc.input); !errors.As(err, &api) || api.Code != "invalid_response" {
			t.Fatalf("accepted %v %s: %v", tc.input, tc.data, err)
		}
	}
	// The backend echoes the resolved camera content on default requests in both directions.
	f.set(reply(patchGrant(t, `{"content":"camera"}`)))
	if r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish}); err != nil || r.Data.Content != MediaContentCamera {
		t.Fatalf("camera echo: %v", err)
	}
	f.set(reply(strings.Replace(callerScreen, `"content":"caller_screen"`, `"content":"camera"`, 1)))
	if r, err := c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaSubscribe}); err != nil || r.Data.Content != MediaContentCamera {
		t.Fatalf("subscribe camera echo: %v", err)
	}

	f.set(func() (int, string) {
		return 409, `{"error":{"code":"caller_screen_not_shared","message":"internal host 10.0.0.5"},"request_id":"trace"}`
	})
	_, err = c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaSubscribe, Content: MediaContentCallerScreen})
	var api *APIError
	if !errors.As(err, &api) || api.Status != 409 || api.Code != "caller_screen_not_shared" || strings.Contains(fmt.Sprintf("%+v", err), "10.0.0.5") {
		t.Fatalf("caller_screen_not_shared: %v", err)
	}
	for _, d := range []struct {
		status int
		code   string
	}{{409, "media_content_unsupported"}, {409, "caller_screen_unsupported"}, {422, "media_limit_exceeded"}} {
		f.set(func() (int, string) {
			return d.status, `{"error":{"code":"` + d.code + `","message":"internal host 10.0.0.5"},"request_id":"trace"}`
		})
		_, err = c.CreateMediaSession(ctx, "call-1", CreateMediaSessionRequest{Direction: MediaPublish, Content: MediaContentScreen})
		if !errors.As(err, &api) || api.Status != d.status || api.Code != d.code || strings.Contains(fmt.Sprintf("%+v", err), "10.0.0.5") {
			t.Fatalf("%s: %v", d.code, err)
		}
	}
}

func TestMediaCapabilityContents(t *testing.T) {
	parse := func(cvContents, ivContents string) MediaCapabilities {
		return ParseMediaCapabilities(json.RawMessage(`{"version":1,"custom_video":{"supported":true,"transports":["whip"],"codecs":["h264"],"max_width":1920,"max_height":1080,"max_fps":30` + cvContents + `},"inbound_caller_video":{"supported":true,"transports":["whep"],"max_width":1280,"max_height":720,"max_fps":30` + ivContents + `}}`))
	}
	got := parse(`,"contents":["screen","window","camera","screen"]`, `,"contents":["screen"]`)
	if !reflect.DeepEqual(got.CustomVideo.Contents, []MediaSessionContent{MediaContentScreen, MediaContentCamera}) || !reflect.DeepEqual(got.InboundCallerVideo.Contents, []MediaSessionContent{MediaContentScreen}) {
		t.Fatalf("contents %v %v", got.CustomVideo.Contents, got.InboundCallerVideo.Contents)
	}
	for _, contents := range []string{``, `,"contents":[]`, `,"contents":["window"]`, `,"contents":"screen"`, `,"contents":null`, `,"contents":[7]`} {
		got := parse(contents, contents)
		camera := []MediaSessionContent{MediaContentCamera}
		if !reflect.DeepEqual(got.CustomVideo.Contents, camera) || !reflect.DeepEqual(got.InboundCallerVideo.Contents, camera) {
			t.Fatalf("%s: %v", contents, got.CustomVideo.Contents)
		}
	}
}

func TestParseMediaCapabilities(t *testing.T) {
	full := `{"version":1,"custom_video":{"supported":true,"transports":["whip","livekit","whip"],"codecs":["vp8","h264","vp8"],"max_width":1920,"max_height":1080.0,"max_fps":30},"inbound_caller_video":{"supported":true,"transports":["whep"],"max_width":1280,"max_height":720,"max_fps":15}}`
	got := ParseMediaCapabilities(json.RawMessage(full))
	want := MediaCapabilities{1, &CustomVideoCapability{true, []string{"whip", "livekit"}, []VideoCodec{VP8, H264}, 1920, 1080, 30, []MediaSessionContent{MediaContentCamera}}, &InboundCallerVideoCapability{true, []string{"whep"}, 1280, 720, 15, []MediaSessionContent{MediaContentCamera}}}
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

type videoCall struct{ method, path, body, key string }

func callVideoServer(t *testing.T, reply func() (int, any)) (*FaceTimeClient, func() []videoCall, func()) {
	var mu sync.Mutex
	var seen []videoCall
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		seen = append(seen, videoCall{r.Method, r.URL.RequestURI(), string(body), r.Header.Get("Idempotency-Key")})
		code, payload := reply()
		mu.Unlock()
		out, _ := json.Marshal(payload)
		w.WriteHeader(code)
		writeFixture(t, w, string(out))
	}))
	c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "ft-secret", ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}
	return c, func() []videoCall { mu.Lock(); defer mu.Unlock(); return slices.Clone(seen) }, s.Close
}

func videoFixtures(t *testing.T) (layered, pageOnly map[string]any, base, captions map[string]any, session func(fps float64, call string) map[string]any) {
	var grant map[string]any
	if json.Unmarshal([]byte(patchGrant(t, `{"content":"camera","codecs":["h264"],"limits":{"max_width":1920,"max_height":1080,"max_fps":24,"max_frame_bytes":8388608}}`)), &grant) != nil {
		t.Fatal("bad fixture")
	}
	session = func(fps float64, call string) map[string]any {
		return map[string]any{"session_id": "ls", "call_id": call, "deployment_id": "dep", "status": "starting", "viewport": map[string]any{"width": 1920, "height": 270},
			"fps": fps, "ready_at": nil, "last_heartbeat_at": nil, "error_code": nil}
	}
	base = map[string]any{"id": "base", "z": 0, "source": map[string]any{"kind": "camera"}, "publish": grant}
	captions = map[string]any{"id": "captions", "z": 1, "living_session": session(12, "call"), "region": map[string]any{"x": 0, "y": 0.75, "width": 1, "height": 0.25},
		"background": "transparent", "opacity": 0.8, "input": []any{"pointer"}}
	layered = map[string]any{"composition_id": "cmp", "call_id": "call", "revision": 3, "status": "starting", "output": map[string]any{"width": 1920, "height": 1080, "fps": 24},
		"error_code": nil, "layers": []any{base, captions}}
	pageOnly = with(layered, map[string]any{"output": map[string]any{"width": 1280, "height": 720, "fps": 30}, "layers": []any{map[string]any{"id": "page", "z": 1,
		"living_session": session(30, "call"), "region": map[string]any{"x": 0, "y": 0, "width": 1, "height": 1}, "background": "opaque", "opacity": 1, "input": []any{}}}})
	return
}

func with(base map[string]any, patch map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range patch {
		out[k] = v
	}
	return out
}

func TestCallVideoRequests(t *testing.T) {
	ctx := context.Background()
	layered, pageOnly, _, _, _ := videoFixtures(t)
	data := pageOnly
	c, seen, done := callVideoServer(t, func() (int, any) { return 200, map[string]any{"data": data, "request_id": "trace"} })
	defer done()
	r, err := c.SetCallVideo(ctx, "call", SetCallVideoRequest{Page: &CompositionPage{"dep-1"}}, "video-key-1")
	if err != nil || r.Data.Output != (CompositionOutput{1280, 720, 30}) || len(r.Data.Layers) != 1 || r.Data.Layers[0].LivingSession.FPS != 30 || r.Data.Layers[0].Input == nil {
		t.Fatalf("page shortcut: %v", err)
	}
	data = layered
	opacity, revision := 0.8, int64(2)
	r, err = c.SetCallVideo(ctx, "call", SetCallVideoRequest{Revision: &revision, Layers: []VideoLayerInput{
		{ID: "base", Source: &CompositionBase{CompositionCamera}},
		{ID: "captions", Z: 1, Page: CompositionPage{"dep"}, Region: &CompositionRegion{0, 0.75, 1, 0.25}, Background: CompositionTransparent, Opacity: &opacity,
			Input: []LivingInputKind{LivingPointer}, InitialState: json.RawMessage(`{ "lang": "en" }`)},
	}}, "video-key-2")
	if err != nil {
		t.Fatal(err)
	}
	v := r.Data
	if v.CompositionID != "cmp" || v.Revision != 3 || v.Status != "starting" || v.ErrorCode != nil || v.Layers[0].Publish == nil || v.Layers[0].Publish.Token != "grant-secret-token" ||
		v.Layers[0].Publish.Content != MediaContentCamera || v.Layers[0].Publish.Limits.MaxFPS != 24 || v.Layers[0].Source.Kind != CompositionCamera ||
		v.Layers[1].Region != (CompositionRegion{0, 0.75, 1, 0.25}) || v.Layers[1].Opacity != 0.8 || v.Layers[1].LivingSession.CallID != "call" {
		t.Fatalf("layered %+v", v.Layers[1])
	}
	for _, verb := range []string{"%v", "%+v", "%#v"} {
		if s := fmt.Sprintf(verb, v) + fmt.Sprintf(verb, r); strings.Contains(s, "grant-secret") {
			t.Fatalf("%s leaked: %s", verb, s)
		}
	}
	if _, err := c.GetCallVideo(ctx, "call"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ClearCallVideo(ctx, "call"); err != nil {
		t.Fatal(err)
	}
	want := []videoCall{
		{"PUT", "/api/v1/calls/call/video", `{"layers":[{"id":"page","z":1,"page":{"deployment_id":"dep-1"},"region":{"x":0,"y":0,"width":1,"height":1},"background":"opaque","opacity":1}]}`, "video-key-1"},
		{"PUT", "/api/v1/calls/call/video", `{"revision":2,"layers":[{"id":"base","z":0,"source":{"kind":"camera"}},{"id":"captions","z":1,"page":{"deployment_id":"dep"},"region":{"x":0,"y":0.75,"width":1,"height":0.25},"background":"transparent","opacity":0.8,"input":["pointer"],"initial_state":{"lang":"en"}}]}`, "video-key-2"},
		{"GET", "/api/v1/calls/call/video", "", ""},
		{"DELETE", "/api/v1/calls/call/video", "", ""},
	}
	if got := seen(); !reflect.DeepEqual(got, want) {
		t.Fatalf("wire\n%q\nwant\n%q", got, want)
	}
	// Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
	if l := CompositionInputTarget(v, 0.5, 0.9); l == nil || l.ID != "captions" {
		t.Fatal("captions target")
	}
	if CompositionInputTarget(v, 0.5, 0.74) != nil || CompositionInputTarget(v, 1.5, 0.9) != nil {
		t.Fatal("outside target")
	}
	data = pageOnly
	page, _ := c.GetCallVideo(ctx, "call")
	if CompositionInputTarget(page.Data, 0.5, 0.5) != nil { // declares no input
		t.Fatal("non-interactive target")
	}
}

func TestCallVideoLocalValidation(t *testing.T) {
	ctx := context.Background()
	layered, _, _, _, _ := videoFixtures(t)
	c, seen, done := callVideoServer(t, func() (int, any) { return 200, map[string]any{"data": layered, "request_id": "trace"} })
	defer done()
	f := func(v float64) *float64 { return &v }
	page := VideoLayerInput{ID: "p", Z: 1, Page: CompositionPage{"dep"}}
	base := VideoLayerInput{ID: "base", Source: &CompositionBase{CompositionCamera}}
	mod := func(l VideoLayerInput, change func(*VideoLayerInput)) VideoLayerInput { change(&l); return l }
	negative := int64(-1)
	huge := int64(maxSafeInteger + 1)
	deep := strings.Repeat("[", 66) + strings.Repeat("]", 66)
	for i, input := range []SetCallVideoRequest{
		{Layers: []VideoLayerInput{}}, {}, {Layers: []VideoLayerInput{base, page, mod(page, func(l *VideoLayerInput) { l.ID, l.Z = "q", 2 })}}, // 0 and 3 layers
		{Layers: []VideoLayerInput{base, mod(base, func(l *VideoLayerInput) { l.ID = "b2" })}}, {Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.ID = "base" })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Z = 0 })}}, {Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Z = 65 })}},
		{Layers: []VideoLayerInput{mod(base, func(l *VideoLayerInput) { l.Z = 1 }), page}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Region = &CompositionRegion{0.5, 0, 0.6, 1} })}}, // leaves the frame
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Region = &CompositionRegion{0, 0, 0, 1} })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Opacity = f(1.2) })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Background = "blurred" })}},
		{Layers: []VideoLayerInput{mod(page, func(l *VideoLayerInput) { l.Background = CompositionTransparent })}}, // nothing below to show through
		{Layers: []VideoLayerInput{mod(page, func(l *VideoLayerInput) { l.Opacity = f(0.5) })}},
		{Layers: []VideoLayerInput{mod(page, func(l *VideoLayerInput) { l.Region = &CompositionRegion{0, 0, 0.5, 1} })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Input = []LivingInputKind{LivingPointer, LivingPointer} })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Input = []LivingInputKind{"scroll"} })}},
		{Layers: []VideoLayerInput{{ID: "base", Source: &CompositionBase{"screen"}}}},
		{Page: &CompositionPage{""}}, {Page: &CompositionPage{strings.Repeat("d", 129)}}, // native SDKs need a ready deployment ID
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Page = CompositionPage{} })}},
		{Page: &CompositionPage{"dep"}, Revision: &negative}, {Page: &CompositionPage{"dep"}, Revision: &huge},
		{Layers: []VideoLayerInput{mod(page, func(l *VideoLayerInput) { l.ID = "Upper" })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.InitialState = json.RawMessage(`{bad`) })}},
		{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.InitialState = json.RawMessage(deep) })}},
		{Page: &CompositionPage{"dep"}, InitialState: json.RawMessage(`"` + strings.Repeat("x", 64*1024) + `"`)},
	} {
		var api *APIError
		if _, err := c.SetCallVideo(ctx, "call", input, "video-key-1"); !errors.As(err, &api) || api.Code != "invalid_request" {
			t.Fatalf("case %d accepted: %v", i, err)
		}
	}
	for _, key := range []string{"short", " leading-space", strings.Repeat("k", 201)} {
		if _, err := c.SetCallVideo(ctx, "call", SetCallVideoRequest{Page: &CompositionPage{"dep"}}, key); err == nil {
			t.Fatalf("key %q accepted", key)
		}
	}
	for _, id := range []string{"", "../x", "a/b"} {
		_, errSet := c.SetCallVideo(ctx, id, SetCallVideoRequest{Page: &CompositionPage{"dep"}}, "video-key-1")
		_, errGet := c.GetCallVideo(ctx, id)
		_, errClear := c.ClearCallVideo(ctx, id)
		if errSet == nil || errGet == nil || errClear == nil {
			t.Fatal("bad call id")
		}
	}
	if len(seen()) != 0 {
		t.Fatal("invalid input reached the network")
	}
	// A region touching the frame edge is inside it.
	if _, err := c.SetCallVideo(ctx, "call", SetCallVideoRequest{Layers: []VideoLayerInput{base, mod(page, func(l *VideoLayerInput) { l.Region = &CompositionRegion{0.75, 0.75, 0.25, 0.25} })}}, "video-key-1"); err != nil || len(seen()) != 1 {
		t.Fatalf("edge region: %v", err)
	}
}

func TestCallVideoResponseValidation(t *testing.T) {
	ctx := context.Background()
	layered, _, base, captions, session := videoFixtures(t)
	var data any
	c, seen, done := callVideoServer(t, func() (int, any) { return 200, map[string]any{"data": data, "request_id": "trace"} })
	defer done()
	layers := func(l ...any) map[string]any { return with(layered, map[string]any{"layers": l}) }
	grant := base["publish"].(map[string]any)
	noError := with(layered, nil)
	delete(noError, "error_code")
	for i, bad := range []any{
		layers(base, with(captions, map[string]any{"living_session": session(30, "call")})),                                   // page fps above output fps
		with(layers(base, captions), map[string]any{"output": map[string]any{"width": 1920, "height": 1080, "fps": 30}}),      // output fps above the base grant
		layers(map[string]any{"id": "base", "z": 0, "source": map[string]any{"kind": "managed"}, "publish": grant}, captions), // grant on a managed base
		layers(with(base, map[string]any{"publish": with(grant, map[string]any{"content": "screen"})}), captions),
		layers(base, captions, with(captions, map[string]any{"id": "more", "z": 2})),
		layers(base, with(captions, map[string]any{"living_session": session(12, "other")})),
		layers(base, with(captions, map[string]any{"region": map[string]any{"x": 0.5, "y": 0, "width": 0.6, "height": 1}})),
		layers(base, with(captions, map[string]any{"z": 0})),
		with(layered, map[string]any{"status": "paused"}), with(layered, map[string]any{"output": map[string]any{"width": 1921, "height": 1080, "fps": 24}}),
		layers(base, with(captions, map[string]any{"living_session": with(session(12, "call"), map[string]any{"status": "paused"})})),
		layers(base, with(captions, map[string]any{"living_session": with(session(12, "call"), map[string]any{"viewport": map[string]any{"width": 15, "height": 270}})})),
		layers(base, with(captions, map[string]any{"living_session": with(session(12, "call"), map[string]any{"session_id": ""})})),
		layers(base, with(captions, map[string]any{"input": []any{"pointer", "pointer"}})),
		with(layered, map[string]any{"revision": 1.5}), noError, nil, []any{},
	} {
		data = bad
		r, err := c.GetCallVideo(ctx, "call")
		var api *APIError
		if !errors.As(err, &api) || api.Code != "invalid_response" || api.Status != 200 || api.Data != nil || r.Response.Data != nil {
			t.Fatalf("case %d accepted: %v", i, err)
		}
	}
	data = layers(map[string]any{"id": "base", "z": 0, "source": map[string]any{"kind": "managed"}}, captions)
	if r, err := c.GetCallVideo(ctx, "call"); err != nil || r.Data.Layers[0].Source.Kind != CompositionManaged || r.Data.Layers[0].Publish != nil {
		t.Fatalf("managed base: %v", err)
	}
	if n := len(seen()); n != 19 {
		t.Fatalf("requests %d", n)
	}
}

func TestCallVideoErrorCodes(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		status int
		code   string
	}{{409, "video_composition_unsupported"}, {422, "composition_invalid"}, {409, "composition_revision_conflict"}, {409, "composition_base_unavailable"}, {409, "media_session_conflict"}, {409, "composition_secret"}} {
		c, _, done := callVideoServer(t, func() (int, any) {
			return tc.status, map[string]any{"error": map[string]any{"code": tc.code, "message": "internal detail"}, "request_id": "trace"}
		})
		_, err := c.SetCallVideo(ctx, "call", SetCallVideoRequest{Page: &CompositionPage{"dep"}}, "video-key-1")
		done()
		want := tc.code
		if tc.code == "composition_secret" {
			want = "request_failed"
		}
		var api *APIError
		if !errors.As(err, &api) || api.Status != tc.status || api.Code != want || api.Data != nil || strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "internal detail") {
			t.Fatalf("%d %s: %v", tc.status, tc.code, err)
		}
	}
}

func TestParseVideoComposition(t *testing.T) {
	cap := `{"version":1,"supported":true,"max_layers":4,"bases":["camera","hologram","managed","camera"],"page_alpha":true,"regions":true,"max_width":3840,"max_height":1080,"max_fps":60}`
	got := ParseVideoComposition(json.RawMessage(cap))
	if got == nil || !reflect.DeepEqual(*got, VideoCompositionCapability{1, true, 2, []CompositionBaseKind{CompositionCamera, CompositionManaged}, true, true, 1920, 1080, 30}) {
		t.Fatalf("parsed %+v", got)
	}
	if p := ParseVideoComposition(json.RawMessage(strings.Replace(cap, `"page_alpha":true`, `"page_alpha":"yes"`, 1))); p == nil || p.PageAlpha {
		t.Fatal("page_alpha")
	}
	for _, bad := range []string{``, `null`, `"v1"`, strings.Replace(cap, `"version":1`, `"version":2`, 1), strings.Replace(cap, `"supported":true`, `"supported":false`, 1),
		strings.Replace(cap, `"max_layers":4`, `"max_layers":0`, 1), strings.Replace(cap, `["camera","hologram","managed","camera"]`, `"camera"`, 1),
		strings.Replace(cap, `"max_fps":60`, `"max_fps":1.5`, 1)} {
		if ParseVideoComposition(json.RawMessage(bad)) != nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
