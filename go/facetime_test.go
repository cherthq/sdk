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
	"sync/atomic"
	"testing"
	"time"
)

func data[T any](r Result[T], err error) (any, error) { return r.Data, err }

// These synthetic wire fixtures are independent of SDK request generation.
// They exercise local HTTP contracts, not live calls or media.
func TestFaceTimeRouteContracts(t *testing.T) {
	ctx := context.Background()
	const call = `{"id":"call-1","status":"queued","media":{"audio":true,"video":false}}`
	const assistant = `{"id":"assistant-1","draft_revision":7,"draft_config":{"schema_version":1}}`
	const calls = `{"items":[` + call + `],"total":9,"limit":3,"offset":6}`
	const lines = `{"items":[{"id":"line-1","status":"available","display_name":"Line One","supports_audio":true,"supports_video":false}],"total":9,"limit":3,"offset":6}`
	const workers = `{"items":[{"id":"worker-1","status":"offline","enabled":false,"display_name":"Worker One"}],"total":9,"limit":3,"offset":6}`
	const assistants = `{"items":[` + assistant + `],"total":9,"limit":3,"offset":6}`
	tests := []struct {
		name, method, path, body, key, scope, response string
		status                                         int
		invoke                                         func(*FaceTimeClient) (any, error)
	}{
		{"calls", "GET", "/calls?limit=3&offset=6", "", "", "project", calls, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListCalls(ctx, PageOptions{3, 6})) }},
		{"call", "GET", "/calls/call-1", "", "", "project", call, 200, func(c *FaceTimeClient) (any, error) { return data(c.GetCall(ctx, "call-1")) }},
		{"events", "GET", "/calls/call-1/events", "", "", "project", `{"call_id":"call-1","events":[{"id":"event-1","type":"queued","at":"now","sequence":2,"source":"api"}]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.GetCallEvents(ctx, "call-1")) }},
		{"transcript", "GET", "/calls/call-1/transcript", "", "", "project", `{"call_id":"call-1","schema_version":1,"turns":[{"occurred_at":"now","speaker":"caller","text":"private words"}]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.GetTranscript(ctx, "call-1")) }},
		{"create", "POST", "/calls", `{"direction":"outbound","mode":"managed","assistant_id":"` + chatID + `","destination":"person@example.com","destination_type":"email","media":{"audio":true,"video":false}}`, "stable-key", "project", call, 201, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateCall(ctx, CreateCallRequest{Mode: "managed", AssistantID: chatID, Destination: "person@example.com", DestinationType: "email", Media: Media{Audio: true}}, "stable-key"))
		}},
		{"BYOR group", "POST", "/calls", `{"direction":"outbound","mode":"customer_managed","line_id":"` + chatID + `","recipients":[{"type":"email","value":"person@example.com"},{"type":"phone_number","value":"+15550000002"}],"media":{"audio":true,"video":true},"livekit_url":"wss://room.example.com","participant_token":"private-room-token","remote_participant_identity":"customer"}`, "stable-key", "project", call, 201, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateCall(ctx, CreateCallRequest{Mode: "customer_managed", LineID: chatID, Recipients: []Recipient{{"email", "person@example.com"}, {"phone_number", "+15550000002"}}, Media: Media{true, true}, LiveKitURL: "wss://room.example.com", ParticipantToken: "private-room-token", RemoteParticipantIdentity: "customer"}, "stable-key"))
		}},
		{"answer", "POST", "/calls/call-1/answer", `{}`, "stable-key", "project", call, 202, func(c *FaceTimeClient) (any, error) {
			return data(c.CallAction(ctx, "call-1", Answer, "", "stable-key"))
		}},
		{"reject", "POST", "/calls/call-1/reject", `{"reason":"busy"}`, "stable-key", "project", call, 202, func(c *FaceTimeClient) (any, error) {
			return data(c.CallAction(ctx, "call-1", Reject, "busy", "stable-key"))
		}},
		{"end", "POST", "/calls/call-1/end", `{}`, "stable-key", "project", call, 202, func(c *FaceTimeClient) (any, error) { return data(c.CallAction(ctx, "call-1", End, "", "stable-key")) }},
		{"lines", "GET", "/lines?limit=3&offset=6", "", "", "project", lines, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListLines(ctx, PageOptions{3, 6})) }},
		{"workers", "GET", "/workers?limit=3&offset=6", "", "", "project", workers, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListWorkers(ctx, PageOptions{3, 6})) }},
		{"line patch", "PATCH", "/lines/line-1", `{"integration_id":null}`, "", "project", `{"id":"line-1","status":"available","supports_audio":true,"supports_video":false}`, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.UpdateLine(ctx, "line-1", UpdateLineRequest{IntegrationID: json.RawMessage(`null`)}))
		}},
		{"assistants", "GET", "/assistants?limit=3&offset=6", "", "", "project", assistants, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListAssistants(ctx, PageOptions{3, 6})) }},
		{"assistant", "GET", "/assistants/assistant-1", "", "", "project", assistant, 200, func(c *FaceTimeClient) (any, error) { return data(c.GetAssistant(ctx, "assistant-1")) }},
		{"assistant create", "POST", "/assistants", `{"name":"example","draft_config":{"schema_version":1}}`, "", "project", assistant, 201, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateAssistant(ctx, CreateAssistantRequest{Name: "example", DraftConfig: json.RawMessage(`{"schema_version":1}`)}))
		}},
		{"assistant patch", "PATCH", "/assistants/assistant-1", `{"expected_draft_revision":6,"description":null}`, "", "project", assistant, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.UpdateAssistant(ctx, "assistant-1", UpdateAssistantRequest{ExpectedDraftRevision: 6, Description: json.RawMessage(`null`)}))
		}},
		{"publish", "POST", "/assistants/assistant-1/publish", "", "", "project", `{"assistant":` + assistant + `,"published_version_id":"version-2"}`, 201, func(c *FaceTimeClient) (any, error) { return data(c.PublishAssistant(ctx, "assistant-1")) }},
		{"settings", "GET", "/settings", "", "", "project", `{"livekit_allowed_hosts":["room.example.com"]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.GetSettings(ctx)) }},
		{"settings replace", "PUT", "/settings", `{"livekit_allowed_hosts":[]}`, "", "project", `{"livekit_allowed_hosts":[]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.UpdateSettings(ctx, ProjectSettings{[]string{}})) }},
		{"login start", "POST", "/cli/logins", `{"device_name":"test device"}`, "", "public", `{"device_code":"secret-code","user_code":"ABCD-EFGH","verification_url":"https://example.com/cli","verification_url_complete":"https://example.com/cli?code=ABCD-EFGH","expires_in":600,"interval":5}`, 201, func(c *FaceTimeClient) (any, error) { return data(c.BeginLogin(ctx, "test device")) }},
		{"login pending", "POST", "/cli/logins/token", `{"device_code":"secret-code"}`, "", "public", `{"status":"pending"}`, 202, func(c *FaceTimeClient) (any, error) { return data(c.PollLogin(ctx, "secret-code")) }},
		{"login approved", "POST", "/cli/logins/token", `{"device_code":"secret-code"}`, "", "public", `{"status":"approved","access_token":"secret-token","email":null,"project":{"id":"project-1","name":null},"device_name":"test device","expires_in":600}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.PollLogin(ctx, "secret-code")) }},
		{"login inspect final second", "POST", "/cli/logins/inspect", `{"user_code":"ABCD-EFGH"}`, "", "user", `{"device_name":"test device","created_at":"now","expires_in":0}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.InspectLogin(ctx, "ABCD-EFGH")) }},
		{"login approve", "POST", "/cli/logins/approve", `{"user_code":"ABCD-EFGH","project_id":"project-2"}`, "", "user", `{"device_name":"test device","project_id":"project-2"}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.ApproveLogin(ctx, "ABCD-EFGH", "project-2")) }},
		{"identity", "GET", "/cli/whoami", "", "", "project", `{"email":null,"project":{"id":"project-1","name":null},"role":"owner"}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.WhoAmI(ctx)) }},
		{"logout", "POST", "/cli/logout", "", "", "user", `{"revoked":true}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.Logout(ctx)) }},
		{"credentials", "GET", "/cli/credentials", "", "", "project", `{"credentials":[]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListCredentials(ctx)) }},
		{"credential revoke", "DELETE", "/cli/credentials/credential-1", "", "", "project", `{"revoked":true}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.RevokeCredential(ctx, "credential-1")) }},
		{"connectors", "GET", "/connectors", "", "", "project", `{"bindings":[]}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.ListConnectors(ctx)) }},
		{"enroll", "POST", "/connectors", `{"action":"enroll","line_id":"line-1","name":"example","environment":"development","session_mode":"byor"}`, "", "project", `{"credentials":{"connection":"secret-connection","recovery":"secret-recovery"},"binding":{"id":"binding-1"}}`, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.EnrollConnector(ctx, ConnectorEnrollment{"line-1", "example", "development", "byor"}))
		}},
		{"activate", "POST", "/connectors", `{"action":"activate","binding_id":"binding-1","expected_binding_id":null,"assignment_generation":7}`, "", "project", `{"active":true}`, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.ActivateConnector(ctx, ConnectorActivation{BindingID: "binding-1", AssignmentGeneration: 7}))
		}},
		{"drain", "POST", "/connectors", `{"action":"drain","binding_id":"binding-1"}`, "", "project", `{"draining":true}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.DrainConnector(ctx, "binding-1")) }},
		{"revoke", "POST", "/connectors", `{"action":"revoke","binding_id":"binding-1"}`, "", "project", `{"revoked":true}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.RevokeConnector(ctx, "binding-1")) }},
		{"billing status", "GET", "/billing", "", "", "project", `{"entitlement":null,"needs_reconciliation":false,"sales_enabled":true,"shared_available":true,"dedicated_available":false}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.BillingStatus(ctx)) }},
		{"checkout", "POST", "/billing", `{"action":"checkout","plan":"shared"}`, "stable-key", "project", `{"url":"https://checkout.example/s"}`, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateCheckout(ctx, CheckoutInput{Plan: "shared"}, "stable-key"))
		}},
		{"checkout coupon", "POST", "/billing", `{"action":"checkout","coupon_code":"WELCOME","plan":"dedicated"}`, "stable-key", "project", `{"url":"https://checkout.example/s"}`, 200, func(c *FaceTimeClient) (any, error) {
			code := "WELCOME"
			return data(c.CreateCheckout(ctx, CheckoutInput{Plan: "dedicated", CouponCode: &code}, " stable-key "))
		}},
		{"cancel", "POST", "/billing", `{"action":"cancel"}`, "stable-key", "project", `{"status":"cancellation_requested","message":"Ends at period end."}`, 200, func(c *FaceTimeClient) (any, error) { return data(c.CancelSubscription(ctx, "stable-key")) }},
		{"coupon", "POST", "/billing", `{"action":"validate_coupon","coupon_code":"WELCOME"}`, "stable-key", "project", `{"code":"WELCOME","percent_off":20,"mode":"test","currency":"usd"}`, 200, func(c *FaceTimeClient) (any, error) {
			return data(c.ValidateCoupon(ctx, "WELCOME", "stable-key"))
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != tc.method || r.URL.RequestURI() != "/custom"+tc.path {
					t.Errorf("wire route %s %s", r.Method, r.URL.RequestURI())
				}
				if r.Header.Get("X-Chert-Tenant") != "" {
					t.Error("tenant leaked")
				}
				wantAuth, wantProject := "Bearer ft-secret", "project-1"
				if tc.scope == "public" {
					wantAuth = ""
				}
				if tc.scope != "project" {
					wantProject = ""
				}
				if r.Header.Get("Authorization") != wantAuth || r.Header.Get("X-Chert-Project-ID") != wantProject || r.Header.Get("Idempotency-Key") != tc.key {
					t.Error("wrong scope or key")
				}
				body, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				if tc.body == "" {
					if len(body) != 0 {
						t.Error("unexpected body")
					}
				} else {
					var got, want any
					if json.Unmarshal(body, &got) != nil || json.Unmarshal([]byte(tc.body), &want) != nil || !reflect.DeepEqual(got, want) {
						t.Errorf("body mismatch: %s", body)
					}
				}
				w.WriteHeader(tc.status)
				writeFixture(t, w, fmt.Sprintf(`{"data":%s,"request_id":"trace-1","future":true}`, tc.response))
			}))
			defer s.Close()
			c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL + "/custom", Token: "ft-secret", ProjectID: "project-1"})
			if err != nil {
				t.Fatal(err)
			}
			out, err := tc.invoke(c)
			if err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 1 {
				t.Fatal("retry")
			}
			// Assert every declared response field that the typed model represents, including nested values.
			encoded, err := json.Marshal(out)
			if err != nil {
				t.Fatal(err)
			}
			var got, want any
			if json.Unmarshal(encoded, &got) != nil || json.Unmarshal([]byte(tc.response), &want) != nil {
				t.Fatal("bad fixture")
			}
			if tc.name == "enroll" {
				delete(want.(map[string]any), "binding")
			} // Deliberately raw-only metadata.
			assertRepresented(t, got, want)
		})
	}
}

func assertRepresented(t *testing.T, got, want any) {
	t.Helper()
	if w, ok := want.(map[string]any); ok {
		g, ok := got.(map[string]any)
		if !ok {
			t.Fatalf("wrong object: %v", got)
		}
		for k, v := range w {
			if actual, exists := g[k]; exists {
				assertRepresented(t, actual, v)
			} else {
				t.Errorf("missing modeled field %s", k)
			}
		}
		return
	}
	if w, ok := want.([]any); ok {
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			t.Fatalf("wrong list: %v", got)
		}
		for i := range w {
			assertRepresented(t, g[i], w[i])
		}
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("decoded value %v, want %v", got, want)
	}
}

func TestUnifiedCredentialIsolationAndDefaults(t *testing.T) {
	sdk, err := New(SDKConfig{IMessage: &Config{APIKey: "im-secret", Tenant: "tenant-1"}, FaceTime: &FaceTimeConfig{Token: "ft-secret", ProjectID: "project-2"}})
	if err != nil {
		t.Fatal(err)
	}
	if sdk.IMessage.base != DefaultIMessageEndpoint || sdk.FaceTime.transport.base != "https://facetime.trychert.com/api/v1" || sdk.IMessage.project != "" || sdk.FaceTime.transport.tenant != "" || sdk.IMessage.key == sdk.FaceTime.transport.key {
		t.Fatal("cross-channel configuration")
	}
	for _, cfg := range []SDKConfig{{IMessage: &Config{APIKey: "key"}}, {FaceTime: &FaceTimeConfig{}}} {
		if _, err := New(cfg); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := New(SDKConfig{}); err == nil {
		t.Fatal("empty SDK")
	}
	for _, cfg := range []FaceTimeConfig{{EndpointOverride: "http://remote.example"}, {EndpointOverride: "https://user:secret@host.example"}, {EndpointOverride: "https://host.example?x=y"}, {Token: "key\r\ninjection"}, {ProjectID: "x\ny"}} {
		if _, err := NewFaceTimeClient(cfg); err == nil {
			t.Fatal("invalid configuration")
		}
	}
	for _, v := range []any{sdk, sdk.FaceTime, FaceTimeConfig{Token: "secret-value"}, LoginResult{AccessToken: "secret-value"}, DeviceLoginStart{DeviceCode: "secret-value"}, CreateCallRequest{ParticipantToken: "secret-value"}, ConnectorCredentials{Connection: "secret-value"}, Result[Call]{Response: Response{Data: json.RawMessage(`"secret-value"`)}}} {
		if strings.Contains(fmt.Sprintf("%v %+v %#v", v, v, v), "secret-value") {
			t.Fatal("formatted secret")
		}
	}
}

func TestFaceTimeFailuresAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		name, body, code string
		status           int
	}{
		{"missing data", `{"request_id":"trace"}`, "invalid_response", 200},
		{"missing id", `{"data":{"id":"one","status":"queued","media":{} }}`, "invalid_response", 200},
		{"empty snapshot", `{"data":{},"request_id":"trace"}`, "invalid_response", 200},
		{"null snapshot", `{"data":null,"request_id":"trace"}`, "invalid_response", 200},
		{"wrong field", `{"data":{"id":7,"status":"queued","media":{}},"request_id":"trace"}`, "invalid_response", 200},
		{"duplicate", `{"data":{},"data":{},"request_id":"trace"}`, "invalid_response", 200},
		{"denied", `{"error":{"code":"forbidden","message":"private-secret"},"request_id":"trace"}`, "forbidden", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var count atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count.Add(1)
				w.WriteHeader(tc.status)
				writeFixture(t, w, tc.body)
			}))
			defer s.Close()
			c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "key", ProjectID: "project"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = c.GetCall(context.Background(), "call")
			var api *APIError
			if !errors.As(err, &api) || api.Code != tc.code || count.Load() != 1 {
				t.Fatalf("failure %v", err)
			}
			if strings.Contains(fmt.Sprintf("%v %+v %#v", err, err, err), "private-secret") {
				t.Fatal("error leaked")
			}
			if tc.status == 403 && api.RequestID != "trace" {
				t.Fatal("lost request ID")
			}
		})
	}
	t.Run("body deadline", func(t *testing.T) {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, err := io.Copy(io.Discard, r.Body); err != nil {
				t.Error(err)
			}
			w.WriteHeader(201)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}))
		defer s.Close()
		c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Timeout: 30 * time.Millisecond})
		if err != nil {
			t.Fatal(err)
		}
		_, err = c.BeginLogin(context.Background(), "device")
		var api *APIError
		if !errors.Is(err, context.DeadlineExceeded) || !errors.As(err, &api) || api.Code != "unconfirmed_facetime_outcome" || api.Status != 201 {
			t.Fatalf("deadline %v", err)
		}
	})
}

func TestFaceTimeRejectedInputsHaveNoEffects(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); writeFixture(t, w, `{}`) }))
	defer s.Close()
	c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "key", ProjectID: "project"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	checks := []func() error{
		func() error { _, e := c.GetCall(ctx, "../escape"); return e },
		func() error { _, e := c.ListCalls(ctx, PageOptions{Limit: 101}); return e },
		func() error { _, e := c.ListCalls(ctx, PageOptions{Offset: -1}); return e },
		func() error { _, e := c.CallAction(ctx, "id", End, "", "short"); return e },
		func() error { _, e := c.CallAction(ctx, "id", CallAction("delete"), "", "stable-key"); return e },
		func() error {
			_, e := c.CreateCall(ctx, CreateCallRequest{Mode: "customer_managed", LineID: chatID, Destination: "test@example.com"}, "stable-key")
			return e
		},
		func() error { _, e := c.UpdateAssistant(ctx, "id", UpdateAssistantRequest{}); return e },
		func() error {
			_, e := c.Request(ctx, "GET", "https://foreign.test/", nil, FaceTimeRequestOptions{})
			return e
		},
	}
	for _, check := range checks {
		if check() == nil {
			t.Error("invalid request accepted")
		}
	}
	public, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = public.ListLines(ctx, PageOptions{}); err == nil {
		t.Fatal("missing auth accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("invalid input had effects")
	}
}

func TestFaceTimeNestedMalformedResults(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name, body string
		status     int
		mutation   bool
		invoke     func(*FaceTimeClient) (any, error)
	}{
		{"empty credentials", `{"credentials":{}}`, 200, true, func(c *FaceTimeClient) (any, error) {
			return data(c.EnrollConnector(ctx, ConnectorEnrollment{LineID: chatID, Name: "device", Environment: "development"}))
		}},
		{"null credential", `{"credentials":{"connection":null,"recovery":"secret"}}`, 200, true, func(c *FaceTimeClient) (any, error) {
			return data(c.EnrollConnector(ctx, ConnectorEnrollment{LineID: chatID, Name: "device", Environment: "development"}))
		}},
		{"empty call identity", `{"id":"","status":"","media":{"audio":null,"video":null}}`, 201, true, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateCall(ctx, CreateCallRequest{Mode: "managed", AssistantID: chatID, Destination: "person@example.com", Media: Media{Audio: true}}, "stable-key"))
		}},
		{"null media", `{"id":"call-1","status":"queued","media":{"audio":null,"video":false}}`, 200, false, func(c *FaceTimeClient) (any, error) { return data(c.GetCall(ctx, "call-1")) }},
		{"null page element", `{"items":[null],"total":1,"limit":1,"offset":0}`, 200, false, func(c *FaceTimeClient) (any, error) { return data(c.ListCalls(ctx, PageOptions{})) }},
		{"missing project identity", `{"project":{},"role":""}`, 200, false, func(c *FaceTimeClient) (any, error) { return data(c.WhoAmI(ctx)) }},
		{"negative total", `{"items":[],"total":-1,"limit":1,"offset":0}`, 200, false, func(c *FaceTimeClient) (any, error) { return data(c.ListLines(ctx, PageOptions{})) }},
		{"negative login expiry", `{"device_name":"device","created_at":"now","expires_in":-1}`, 200, true, func(c *FaceTimeClient) (any, error) { return data(c.InspectLogin(ctx, "code")) }},
		{"billing status missing availability", `{"entitlement":null,"needs_reconciliation":false}`, 200, false, func(c *FaceTimeClient) (any, error) { return data(c.BillingStatus(ctx)) }},
		{"empty checkout url", `{"url":""}`, 200, true, func(c *FaceTimeClient) (any, error) {
			return data(c.CreateCheckout(ctx, CheckoutInput{Plan: "shared"}, "stable-key"))
		}},
		{"cancellation not requested", `{"status":"cancelled","message":"x"}`, 200, true, func(c *FaceTimeClient) (any, error) { return data(c.CancelSubscription(ctx, "stable-key")) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				writeFixture(t, w, fmt.Sprintf(`{"data":%s,"request_id":"trace"}`, tc.body))
			}))
			defer s.Close()
			c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "key", ProjectID: "project"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = tc.invoke(c)
			var api *APIError
			code := "invalid_response"
			if tc.mutation {
				code = "unconfirmed_facetime_outcome"
			}
			if !errors.As(err, &api) || api.Code != code || api.Status != tc.status || api.RequestID != "trace" {
				t.Fatalf("accepted or misclassified malformed result: %v", err)
			}
		})
	}
	for _, raw := range []string{`not-json`, `{"data":{},"data":{},"request_id":"trace"}`, strings.Repeat("x", 1025)} {
		t.Run("mutation JSON", func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(201); writeFixture(t, w, raw) }))
			defer s.Close()
			c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, MaxResponseBytes: 1024})
			if err != nil {
				t.Fatal(err)
			}
			_, err = c.BeginLogin(ctx, "device")
			var api *APIError
			if !errors.As(err, &api) || api.Code != "unconfirmed_facetime_outcome" || api.Status != 201 {
				t.Fatalf("wrong mutation failure: %v", err)
			}
		})
	}
}

func TestBillingLocalValidationSendsNothing(t *testing.T) {
	var calls atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer s.Close()
	c, err := NewFaceTimeClient(FaceTimeConfig{EndpointOverride: s.URL, Token: "key", ProjectID: "project"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	empty, long := "", strings.Repeat("x", 65)
	for name, call := range map[string]func() error{
		"plan": func() error {
			_, err := c.CreateCheckout(ctx, CheckoutInput{Plan: "enterprise"}, "stable-key")
			return err
		},
		"short key":   func() error { _, err := c.CreateCheckout(ctx, CheckoutInput{Plan: "shared"}, "short"); return err },
		"newline key": func() error { _, err := c.CancelSubscription(ctx, "stable\r\nkey"); return err },
		"empty coupon": func() error {
			_, err := c.CreateCheckout(ctx, CheckoutInput{Plan: "shared", CouponCode: &empty}, "stable-key")
			return err
		},
		"long coupon": func() error { _, err := c.ValidateCoupon(ctx, long, "stable-key"); return err },
	} {
		if err := call(); err == nil {
			t.Errorf("%s: expected a local validation error", name)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("local validation sent %d requests", calls.Load())
	}
}

func TestCouponLengthCountsTrimmedCharacters(t *testing.T) {
	if !couponCode("  " + strings.Repeat("é", 64) + "  ") {
		t.Fatal("64 non-ASCII characters with padding should be accepted, as the server trims and counts characters")
	}
	if couponCode(strings.Repeat("é", 65)) || couponCode("   ") {
		t.Fatal("over-long or blank coupons must be rejected")
	}
}
