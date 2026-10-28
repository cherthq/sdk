package chert

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"regexp"
	"slices"
	"sort"
)

// Call video composition (draft, unreleased): the call's video as a stack of
// layers, composed server-side and published through the call's single publish
// slot. A base layer (z 0) carries camera frames over a publish grant, or a
// backend-managed source; page layers (z >= 1) are living sessions of ready
// deployments. This SDK only validates and sends compositions: it cannot deploy
// URL pages or drive page state, events or input (TypeScript SDK only).

// CompositionMaxLayers is the SDK v1 bound. The capability's MaxLayers is the backend's real limit.
const CompositionMaxLayers = 2

// CompositionBaseKind is camera (frames over the response's publish grant) or
// managed (a backend-provided source, only where the capability lists it).
type CompositionBaseKind string

const (
	CompositionCamera  CompositionBaseKind = "camera"
	CompositionManaged CompositionBaseKind = "managed"
)

// CompositionBackground: transparent renders the page with alpha (premultiplied source-over).
type CompositionBackground string

const (
	CompositionOpaque      CompositionBackground = "opaque"
	CompositionTransparent CompositionBackground = "transparent"
)

// LivingInputKind is an agent-relayed page input kind.
type LivingInputKind string

const (
	LivingPointer  LivingInputKind = "pointer"
	LivingKeyboard LivingInputKind = "keyboard"
	LivingText     LivingInputKind = "text"
)

// CompositionBase is a base layer's source.
type CompositionBase struct {
	Kind CompositionBaseKind `json:"kind"`
}

// CompositionRegion is normalized to the output frame: 0..1, Width/Height > 0,
// and X+Width, Y+Height <= 1.
type CompositionRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// CompositionPage is a ready living-service deployment. URL pages are not
// accepted natively: deploy them with the TypeScript SDK and pass the ID.
type CompositionPage struct {
	DeploymentID string `json:"deployment_id"`
}

// VideoLayerInput is a base layer when Source is non-nil (Z must be 0), otherwise
// a page layer with a unique Z in 1..64. Region nil is the full frame,
// Background empty is opaque, Opacity nil is 1. Input nil omits it (a
// non-interactive layer); InitialState nil omits it and must otherwise be plain
// JSON of at most 64 KiB.
type VideoLayerInput struct {
	ID           string
	Source       *CompositionBase
	Z            int
	Page         CompositionPage
	Region       *CompositionRegion
	Background   CompositionBackground
	Opacity      *float64
	Input        []LivingInputKind
	InitialState json.RawMessage
}

// SetCallVideoRequest is the page shortcut (Page non-nil and Layers nil: one
// opaque full-frame page layer with id "page" at z 1) or up to two Layers. A
// non-nil Revision makes the PUT compare-and-set.
type SetCallVideoRequest struct {
	Page         *CompositionPage
	Input        []LivingInputKind
	InitialState json.RawMessage
	Layers       []VideoLayerInput
	Revision     *int64
}

// CompositionStatus is the composition lifecycle.
type CompositionStatus string

// CompositionOutput is the effective output; page layers render at or below FPS.
type CompositionOutput struct {
	Width  int `json:"width"`
	Height int `json:"height"`
	FPS    int `json:"fps"`
}

// LivingViewport is a living session's effective viewport.
type LivingViewport struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// LivingSession is a page layer's living session (minimal model).
// Status is starting, ready, live, stopping, stopped or failed.
type LivingSession struct {
	SessionID       string
	CallID          string
	DeploymentID    string
	Status          string
	Viewport        LivingViewport
	FPS             int
	ReadyAt         *string
	LastHeartbeatAt *string
	ErrorCode       *string
}

// VideoLayer is a base layer when Source is non-nil (Publish is set only for a
// camera base when the backend issues a grant), otherwise a page layer.
type VideoLayer struct {
	ID            string
	Z             int
	Source        *CompositionBase
	Publish       *MediaSessionGrant
	LivingSession *LivingSession
	Region        CompositionRegion
	Background    CompositionBackground
	Opacity       float64
	Input         []LivingInputKind
}

// CallVideoComposition is a validated composition. Status is starting, live,
// stopping, stopped or failed.
type CallVideoComposition struct {
	CompositionID string
	CallID        string
	Revision      int64
	Status        CompositionStatus
	Output        CompositionOutput
	Layers        []VideoLayer
	ErrorCode     *string
}

// VideoCompositionCapability is the explicit, versioned video_composition
// capability. Never inferred from custom_video or living_services.
type VideoCompositionCapability struct {
	Version   int                   `json:"version"`
	Supported bool                  `json:"supported"`
	MaxLayers int                   `json:"max_layers"`
	Bases     []CompositionBaseKind `json:"bases"`
	PageAlpha bool                  `json:"page_alpha"`
	Regions   bool                  `json:"regions"`
	MaxWidth  int                   `json:"max_width"`
	MaxHeight int                   `json:"max_height"`
	MaxFPS    int                   `json:"max_fps"`
}

const maxSafeInteger = 9007199254740991

// clampedPositive matches Number.isInteger(v) && v > 0 and returns min(v, max).
func clampedPositive(v any, max float64) (int, bool) {
	n, ok := v.(float64)
	if !ok || n <= 0 || math.IsInf(n, 0) || math.Trunc(n) != n {
		return 0, false
	}
	return int(math.Min(n, max)), true
}

// ParseVideoComposition parses video_composition. Absent, malformed,
// unknown-version or unsupported input returns nil. Unknown bases are ignored
// and larger limits clamp to SDK v1 bounds.
func ParseVideoComposition(raw json.RawMessage) *VideoCompositionCapability {
	var o map[string]any
	if json.Unmarshal(raw, &o) != nil || o == nil || o["version"] != 1.0 || o["supported"] != true {
		return nil
	}
	items, ok := o["bases"].([]any)
	layers, okL := clampedPositive(o["max_layers"], CompositionMaxLayers)
	width, okW := clampedPositive(o["max_width"], 1920)
	height, okH := clampedPositive(o["max_height"], 1080)
	fps, okF := clampedPositive(o["max_fps"], 30)
	if !ok || !okL || !okW || !okH || !okF {
		return nil
	}
	bases := []CompositionBaseKind{}
	for _, item := range items {
		s, _ := item.(string)
		b := CompositionBaseKind(s)
		if (b == CompositionCamera || b == CompositionManaged) && !slices.Contains(bases, b) {
			bases = append(bases, b)
		}
	}
	return &VideoCompositionCapability{1, true, layers, bases, o["page_alpha"] == true, o["regions"] == true, width, height, fps}
}

var layerIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)

const regionEpsilon = 1e-9

func unit(n float64) bool { return !math.IsNaN(n) && n >= 0 && n <= 1 }

func regionOK(r CompositionRegion) bool {
	return unit(r.X) && unit(r.Y) && unit(r.Width) && unit(r.Height) && r.Width > 0 && r.Height > 0 &&
		r.X+r.Width <= 1+regionEpsilon && r.Y+r.Height <= 1+regionEpsilon
}

func inputsOK(kinds []LivingInputKind) bool {
	seen := map[LivingInputKind]bool{}
	for _, k := range kinds {
		if (k != LivingPointer && k != LivingKeyboard && k != LivingText) || seen[k] {
			return false
		}
		seen[k] = true
	}
	return true
}

// plainJSON bounds initial_state: valid JSON, depth <= 64, at most 65536 values and bytes.
func plainJSON(raw json.RawMessage) bool {
	const max = 64 * 1024
	var compact bytes.Buffer
	var v any
	if json.Compact(&compact, raw) != nil || compact.Len() > max || json.Unmarshal(raw, &v) != nil {
		return false
	}
	nodes := 0
	var walk func(any, int) bool
	walk = func(x any, depth int) bool {
		nodes++
		if depth > 64 || nodes > max {
			return false
		}
		switch t := x.(type) {
		case []any:
			for _, y := range t {
				if !walk(y, depth+1) {
					return false
				}
			}
		case map[string]any:
			for _, y := range t {
				if !walk(y, depth+1) {
					return false
				}
			}
		}
		return true
	}
	return walk(v, 0)
}

type compositionBaseBody struct {
	ID     string          `json:"id"`
	Z      int             `json:"z"`
	Source CompositionBase `json:"source"`
}

type compositionPageBody struct {
	ID           string                `json:"id"`
	Z            int                   `json:"z"`
	Page         CompositionPage       `json:"page"`
	Region       CompositionRegion     `json:"region"`
	Background   CompositionBackground `json:"background"`
	Opacity      float64               `json:"opacity"`
	Input        *[]LivingInputKind    `json:"input,omitempty"`
	InitialState json.RawMessage       `json:"initial_state,omitempty"`
}

type compositionBody struct {
	Revision *int64 `json:"revision,omitempty"`
	Layers   []any  `json:"layers"`
}

// buildCompositionBody validates locally and returns the PUT body, or false.
func buildCompositionBody(in SetCallVideoRequest) (compositionBody, bool) {
	layers := in.Layers
	if in.Page != nil && in.Layers == nil {
		layers = []VideoLayerInput{{ID: "page", Z: 1, Page: *in.Page, Input: in.Input, InitialState: in.InitialState}}
	}
	if len(layers) < 1 || len(layers) > CompositionMaxLayers || in.Revision != nil && (*in.Revision < 0 || *in.Revision > maxSafeInteger) {
		return compositionBody{}, false
	}
	out := compositionBody{Revision: in.Revision}
	ids, zs := map[string]bool{}, map[int]bool{}
	bases := 0
	var bottom *compositionPageBody
	for _, layer := range layers {
		if !layerIDPattern.MatchString(layer.ID) || ids[layer.ID] {
			return compositionBody{}, false
		}
		ids[layer.ID] = true
		if layer.Source != nil {
			bases++
			if bases > 1 || layer.Z != 0 || layer.Source.Kind != CompositionCamera && layer.Source.Kind != CompositionManaged {
				return compositionBody{}, false
			}
			out.Layers = append(out.Layers, compositionBaseBody{layer.ID, 0, CompositionBase{layer.Source.Kind}})
			continue
		}
		if layer.Z < 1 || layer.Z > 64 || zs[layer.Z] {
			return compositionBody{}, false
		}
		zs[layer.Z] = true
		region := CompositionRegion{0, 0, 1, 1}
		if layer.Region != nil {
			region = *layer.Region
		}
		background := layer.Background
		if background == "" {
			background = CompositionOpaque
		}
		opacity := 1.0
		if layer.Opacity != nil {
			opacity = *layer.Opacity
		}
		id := layer.Page.DeploymentID
		if !regionOK(region) || background != CompositionOpaque && background != CompositionTransparent || !unit(opacity) ||
			!inputsOK(layer.Input) || layer.InitialState != nil && !plainJSON(layer.InitialState) || id == "" || len(id) > 128 {
			return compositionBody{}, false
		}
		page := &compositionPageBody{ID: layer.ID, Z: layer.Z, Page: CompositionPage{id}, Region: region, Background: background, Opacity: opacity, InitialState: layer.InitialState}
		if layer.Input != nil {
			kinds := slices.Clone(layer.Input)
			page.Input = &kinds
		}
		if bottom == nil || page.Z < bottom.Z {
			bottom = page
		}
		out.Layers = append(out.Layers, page)
	}
	// Without a base, the bottom page must fill the frame without showing through.
	if bases == 0 && (bottom.Region != CompositionRegion{0, 0, 1, 1} || bottom.Background != CompositionOpaque || bottom.Opacity != 1) {
		return compositionBody{}, false
	}
	return out, true
}

func evenDimension(v any, max float64) (int, bool) {
	n, ok := jsInteger(v, max)
	return n, ok && n >= 16 && n%2 == 0
}

func unitValue(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && unit(n)
}

func regionValue(v any) (CompositionRegion, bool) {
	o, _ := v.(map[string]any)
	x, okX := unitValue(o["x"])
	y, okY := unitValue(o["y"])
	w, okW := unitValue(o["width"])
	h, okH := unitValue(o["height"])
	r := CompositionRegion{x, y, w, h}
	return r, o != nil && okX && okY && okW && okH && regionOK(r)
}

func inputsValue(v any) ([]LivingInputKind, bool) {
	items, ok := v.([]any)
	out := []LivingInputKind{}
	for _, item := range items {
		s, isString := item.(string)
		if !isString {
			return nil, false
		}
		out = append(out, LivingInputKind(s))
	}
	return out, ok && inputsOK(out)
}

func nullableString(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}

// livingSessionValue checks the effective viewport/fps like the reference SDK.
func livingSessionValue(v any) (*LivingSession, bool) {
	s, _ := v.(map[string]any)
	viewport, _ := s["viewport"].(map[string]any)
	id, _ := s["session_id"].(string)
	status, _ := s["status"].(string)
	width, okW := evenDimension(viewport["width"], 1920)
	height, okH := evenDimension(viewport["height"], 1080)
	fps, okF := jsInteger(s["fps"], 30)
	if s == nil || id == "" || !slices.Contains([]string{"starting", "ready", "live", "stopping", "stopped", "failed"}, status) || viewport == nil || !okW || !okH || !okF {
		return nil, false
	}
	callID, _ := s["call_id"].(string)
	deployment, _ := s["deployment_id"].(string)
	return &LivingSession{id, callID, deployment, status, LivingViewport{width, height}, fps,
		nullableString(s["ready_at"]), nullableString(s["last_heartbeat_at"]), nullableString(s["error_code"])}, true
}

// parseComposition returns false on any response outside the contract.
func parseComposition(raw json.RawMessage) (CallVideoComposition, bool) {
	var c CallVideoComposition
	var o map[string]any
	if json.Unmarshal(raw, &o) != nil || o == nil {
		return c, false
	}
	c.CompositionID, _ = o["composition_id"].(string)
	c.CallID, _ = o["call_id"].(string)
	revision, okRevision := o["revision"].(float64)
	status, _ := o["status"].(string)
	errorCode, hasError := o["error_code"]
	output, _ := o["output"].(map[string]any)
	var okW, okH, okF bool
	c.Output.Width, okW = evenDimension(output["width"], 1920)
	c.Output.Height, okH = evenDimension(output["height"], 1080)
	c.Output.FPS, okF = jsInteger(output["fps"], 30)
	layers, okLayers := o["layers"].([]any)
	if c.CompositionID == "" || c.CallID == "" || !okRevision || revision < 0 || revision > maxSafeInteger || math.Trunc(revision) != revision ||
		!slices.Contains([]string{"starting", "live", "stopping", "stopped", "failed"}, status) ||
		!hasError || errorCode != nil && nullableString(errorCode) == nil || output == nil || !okW || !okH || !okF ||
		!okLayers || len(layers) > CompositionMaxLayers {
		return c, false
	}
	c.Revision, c.Status, c.ErrorCode, c.Layers = int64(revision), CompositionStatus(status), nullableString(errorCode), []VideoLayer{}
	ids, zs := map[string]bool{}, map[float64]bool{}
	base := false
	for _, item := range layers {
		l, _ := item.(map[string]any)
		id, isString := l["id"].(string)
		z, isNumber := l["z"].(float64)
		if l == nil || !isString || ids[id] || isNumber && zs[z] {
			return c, false
		}
		ids[id] = true
		if isNumber {
			zs[z] = true
		}
		layer := VideoLayer{ID: id, Z: int(z)}
		if source, present := l["source"]; present {
			s, _ := source.(map[string]any)
			kind, _ := s["kind"].(string)
			if base || !isNumber || z != 0 || kind != string(CompositionCamera) && kind != string(CompositionManaged) {
				return c, false
			}
			base = true
			layer.Source = &CompositionBase{CompositionBaseKind(kind)}
			if publish, present := l["publish"]; present {
				raw, _ := json.Marshal(publish)
				grant, ok := parseGrant(raw, MediaPublish, nil, MediaContentCamera)
				if kind != string(CompositionCamera) || !ok || c.Output.FPS > grant.Limits.MaxFPS {
					return c, false
				}
				layer.Publish = &grant
			}
			c.Layers = append(c.Layers, layer)
			continue
		}
		var okZ, okRegion, okOpacity, okInput, okSession bool
		layer.Z, okZ = jsInteger(l["z"], maxSafeInteger)
		layer.Region, okRegion = regionValue(l["region"])
		background, _ := l["background"].(string)
		layer.Background = CompositionBackground(background)
		layer.Opacity, okOpacity = unitValue(l["opacity"])
		layer.Input, okInput = inputsValue(l["input"])
		layer.LivingSession, okSession = livingSessionValue(l["living_session"])
		if !okZ || !okRegion || layer.Background != CompositionOpaque && layer.Background != CompositionTransparent || !okOpacity || !okInput ||
			!okSession || layer.LivingSession.CallID != c.CallID || layer.LivingSession.FPS > c.Output.FPS {
			return c, false
		}
		c.Layers = append(c.Layers, layer)
	}
	return c, true
}

func (c *FaceTimeClient) callVideo(ctx context.Context, method, callID string, body any, key *string) (Result[CallVideoComposition], error) {
	r, err := c.Request(ctx, method, resource("calls", callID, "/video"), body, FaceTimeRequestOptions{Auth: ProjectAuth, IdempotencyKey: key})
	if err != nil {
		return Result[CallVideoComposition]{}, mediaError(err)
	}
	var envelope struct {
		Data      json.RawMessage `json:"data"`
		RequestID string          `json:"request_id"`
	}
	var composition CallVideoComposition
	ok := json.Unmarshal(r.Data, &envelope) == nil && envelope.RequestID != ""
	if ok {
		composition, ok = parseComposition(envelope.Data)
	}
	if !ok {
		// Raw data is withheld: an invalid composition may still carry a bearer token.
		return Result[CallVideoComposition]{}, &APIError{Status: r.Status, Code: "invalid_response", RequestID: r.RequestID}
	}
	return Result[CallVideoComposition]{composition, r}, nil
}

// SetCallVideo replaces the call's video composition (draft, unreleased): a
// page shortcut or up to two layers. The composition holds the call's single
// publish slot. Pages must be ready deployments. Invalid input fails locally
// with invalid_request before any request.
func (c *FaceTimeClient) SetCallVideo(ctx context.Context, callID string, input SetCallVideoRequest, key string) (Result[CallVideoComposition], error) {
	body, ok := buildCompositionBody(input)
	if !ok || !faceTimeKey(key) || resource("calls", callID, "") == "" {
		return Result[CallVideoComposition]{}, invalid()
	}
	return c.callVideo(ctx, "PUT", callID, body, &key)
}

// GetCallVideo reads the call's current video composition.
func (c *FaceTimeClient) GetCallVideo(ctx context.Context, callID string) (Result[CallVideoComposition], error) {
	if resource("calls", callID, "") == "" {
		return Result[CallVideoComposition]{}, invalid()
	}
	return c.callVideo(ctx, "GET", callID, nil, nil)
}

// ClearCallVideo stops the composition and frees the publish slot.
func (c *FaceTimeClient) ClearCallVideo(ctx context.Context, callID string) (Result[CallVideoComposition], error) {
	if resource("calls", callID, "") == "" {
		return Result[CallVideoComposition]{}, invalid()
	}
	return c.callVideo(ctx, "DELETE", callID, nil, nil)
}

// CompositionInputTarget returns the topmost page layer accepting pointer input
// under an output-frame point (x, y normalized 0..1), or nil. The backend maps
// output-frame coordinates into the page and rejects points outside the region.
func CompositionInputTarget(composition CallVideoComposition, x, y float64) *VideoLayer {
	if !unit(x) || !unit(y) {
		return nil
	}
	var pages []*VideoLayer
	for i := range composition.Layers {
		if l := &composition.Layers[i]; l.Source == nil && slices.Contains(l.Input, LivingPointer) {
			pages = append(pages, l)
		}
	}
	sort.SliceStable(pages, func(i, j int) bool { return pages[i].Z > pages[j].Z })
	for _, l := range pages {
		if r := l.Region; x >= r.X && x <= r.X+r.Width && y >= r.Y && y <= r.Y+r.Height {
			return l
		}
	}
	return nil
}
