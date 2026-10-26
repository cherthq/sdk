package chert

import (
	"context"
	"encoding/json"
	"strings"
)

// DeviceLoginStart contains a secret device code; display only the user code and
// verified approval URL. The SDK neither opens URLs nor approves a login itself.
type DeviceLoginStart struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURL         string `json:"verification_url"`
	VerificationURLComplete string `json:"verification_url_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

func (v DeviceLoginStart) String() string   { return "DeviceLoginStart{redacted}" }
func (v DeviceLoginStart) GoString() string { return v.String() }

// ProjectIdentity is the project authorized by a user or CLI credential.
type ProjectIdentity struct {
	ID   string  `json:"id"`
	Name *string `json:"name"`
}

// LoginResult is pending or approved. An approved token is returned once only.
type LoginResult struct {
	Status      string           `json:"status"`
	AccessToken string           `json:"access_token,omitempty"`
	Email       *string          `json:"email"`
	Project     *ProjectIdentity `json:"project,omitempty"`
	DeviceName  string           `json:"device_name,omitempty"`
	ExpiresIn   int              `json:"expires_in,omitempty"`
}

func (v LoginResult) String() string   { return "LoginResult{redacted}" }
func (v LoginResult) GoString() string { return v.String() }

// LoginInspection describes the device awaiting human approval.
type LoginInspection struct {
	DeviceName string `json:"device_name"`
	CreatedAt  string `json:"created_at"`
	ExpiresIn  int    `json:"expires_in"`
}

// LoginApproval acknowledges authorization of a device for one project.
type LoginApproval struct {
	DeviceName string `json:"device_name"`
	ProjectID  string `json:"project_id"`
}

// Identity describes the caller without disclosing a token.
type Identity struct {
	Email      *string         `json:"email"`
	Project    ProjectIdentity `json:"project"`
	Role       string          `json:"role"`
	DeviceName string          `json:"device_name,omitempty"`
	ExpiresAt  string          `json:"expires_at,omitempty"`
}

// Revoked reports revocation, not deletion of historical activity.
type Revoked struct {
	Revoked bool `json:"revoked"`
}

// Credential is credential metadata, never the original plaintext token.
type Credential struct {
	ID          string  `json:"id"`
	DeviceName  string  `json:"device_name"`
	TokenPrefix string  `json:"token_prefix"`
	UserID      string  `json:"user_id"`
	Email       *string `json:"email"`
	CreatedAt   string  `json:"created_at"`
	LastUsedAt  *string `json:"last_used_at"`
	ExpiresAt   string  `json:"expires_at"`
}

// Credentials contains the visible credential metadata.
type Credentials struct {
	Credentials []Credential `json:"credentials"`
}

// BeginLogin starts public device authorization once, without sending configured credentials.
func (c *FaceTimeClient) BeginLogin(ctx context.Context, deviceName string) (Result[DeviceLoginStart], error) {
	return perform[DeviceLoginStart](ctx, c, "POST", "/cli/logins", map[string]string{"device_name": deviceName}, PublicAuth, nil, 201, "device_code", "user_code", "verification_url", "verification_url_complete", "expires_in", "interval")
}

// PollLogin performs one poll. The caller must respect Interval and expiry; no loop or retry is hidden.
func (c *FaceTimeClient) PollLogin(ctx context.Context, deviceCode string) (Result[LoginResult], error) {
	r, err := perform[LoginResult](ctx, c, "POST", "/cli/logins/token", map[string]string{"device_code": deviceCode}, PublicAuth, nil, 0, "status")
	if err != nil {
		return r, err
	}
	valid := r.Data.Status == "pending" && r.Response.Status == 202 && r.Data.AccessToken == ""
	valid = valid || r.Data.Status == "approved" && r.Response.Status == 200 && r.Data.AccessToken != "" && r.Data.Project != nil && r.Data.Project.ID != "" && r.Data.ExpiresIn > 0
	if !valid {
		return Result[LoginResult]{Response: r.Response}, &APIError{Status: r.Response.Status, Code: "invalid_response", RequestID: r.Response.RequestID}
	}
	return r, nil
}

// InspectLogin requires a signed-in user token, not a project API key.
func (c *FaceTimeClient) InspectLogin(ctx context.Context, code string) (Result[LoginInspection], error) {
	return perform[LoginInspection](ctx, c, "POST", "/cli/logins/inspect", map[string]string{"user_code": code}, UserAuth, nil, 200, "device_name", "created_at", "expires_in")
}

// ApproveLogin requires explicit human authorization and owner/admin membership.
func (c *FaceTimeClient) ApproveLogin(ctx context.Context, code, projectID string) (Result[LoginApproval], error) {
	return perform[LoginApproval](ctx, c, "POST", "/cli/logins/approve", map[string]string{"user_code": code, "project_id": projectID}, UserAuth, nil, 200, "device_name", "project_id")
}

// WhoAmI inspects the configured project authorization.
func (c *FaceTimeClient) WhoAmI(ctx context.Context) (Result[Identity], error) {
	return perform[Identity](ctx, c, "GET", "/cli/whoami", nil, ProjectAuth, nil, 200, "project", "role")
}

// Logout revokes the configured CLI token only; it requires an ftu_ credential.
func (c *FaceTimeClient) Logout(ctx context.Context) (Result[Revoked], error) {
	return perform[Revoked](ctx, c, "POST", "/cli/logout", nil, UserAuth, nil, 200, "revoked")
}

// ListCredentials requires an owner/admin browser user session, not a CLI/project token.
func (c *FaceTimeClient) ListCredentials(ctx context.Context) (Result[Credentials], error) {
	return perform[Credentials](ctx, c, "GET", "/cli/credentials", nil, ProjectAuth, nil, 200, "credentials")
}

// RevokeCredential has the same browser-user requirement as ListCredentials.
func (c *FaceTimeClient) RevokeCredential(ctx context.Context, id string) (Result[Revoked], error) {
	return perform[Revoked](ctx, c, "DELETE", resource("cli/credentials", id, ""), nil, ProjectAuth, nil, 200, "revoked")
}

// ConnectorEnrollment registers a connector without activating routing.
type ConnectorEnrollment struct {
	LineID      string `json:"line_id"`
	Name        string `json:"name"`
	Environment string `json:"environment"`
	SessionMode string `json:"session_mode,omitempty"`
}

// ConnectorCredentials are one-time connection and recovery secrets.
type ConnectorCredentials struct {
	Connection string `json:"connection"`
	Recovery   string `json:"recovery"`
}

func (v ConnectorCredentials) String() string   { return "ConnectorCredentials{redacted}" }
func (v ConnectorCredentials) GoString() string { return v.String() }

// ConnectorReceipt keeps evolving binding metadata in Result.Response.
type ConnectorReceipt struct {
	Credentials ConnectorCredentials `json:"credentials"`
}

// ConnectorActivation is a compare-and-swap operation; nil ExpectedBindingID means JSON null.
type ConnectorActivation struct {
	BindingID            string  `json:"binding_id"`
	ExpectedBindingID    *string `json:"expected_binding_id"`
	AssignmentGeneration int64   `json:"assignment_generation"`
}

// ListConnectors preserves the versioned connector inventory as JSON.
func (c *FaceTimeClient) ListConnectors(ctx context.Context) (Result[json.RawMessage], error) {
	return perform[json.RawMessage](ctx, c, "GET", "/connectors", nil, ProjectAuth, nil, 200)
}

// EnrollConnector requires an owner/admin user principal. It is not a runtime connection.
func (c *FaceTimeClient) EnrollConnector(ctx context.Context, input ConnectorEnrollment) (Result[ConnectorReceipt], error) {
	return perform[ConnectorReceipt](ctx, c, "POST", "/connectors", struct {
		Action string `json:"action"`
		ConnectorEnrollment
	}{"enroll", input}, ProjectAuth, nil, 200, "credentials")
}

// ActivateConnector changes routing only if the expected binding/generation still matches.
func (c *FaceTimeClient) ActivateConnector(ctx context.Context, input ConnectorActivation) (Result[json.RawMessage], error) {
	return perform[json.RawMessage](ctx, c, "POST", "/connectors", struct {
		Action string `json:"action"`
		ConnectorActivation
	}{"activate", input}, ProjectAuth, nil, 200)
}

// DrainConnector requests a drain; acceptance does not confirm completion.
func (c *FaceTimeClient) DrainConnector(ctx context.Context, id string) (Result[json.RawMessage], error) {
	return c.connectorAction(ctx, "drain", id)
}

// RevokeConnector revokes a binding's authority.
func (c *FaceTimeClient) RevokeConnector(ctx context.Context, id string) (Result[json.RawMessage], error) {
	return c.connectorAction(ctx, "revoke", id)
}
func (c *FaceTimeClient) connectorAction(ctx context.Context, action, id string) (Result[json.RawMessage], error) {
	if !identifier(id) {
		return Result[json.RawMessage]{}, invalid()
	}
	return perform[json.RawMessage](ctx, c, "POST", "/connectors", map[string]string{"action": action, "binding_id": id}, ProjectAuth, nil, 200)
}

// BillingStatus reports entitlement and availability. Entitlement is preserved as server JSON.
type BillingStatus struct {
	Entitlement         json.RawMessage `json:"entitlement"`
	NeedsReconciliation bool            `json:"needs_reconciliation"`
	SalesEnabled        *bool           `json:"sales_enabled"`
	SharedAvailable     bool            `json:"shared_available"`
	DedicatedAvailable  bool            `json:"dedicated_available"`
}

// CheckoutInput selects a plan ("shared" or "dedicated") and an optional coupon.
type CheckoutInput struct {
	Plan       string  `json:"plan"`
	CouponCode *string `json:"coupon_code,omitempty"`
}

// Checkout is a hosted checkout URL. Opening it is the caller's decision; it grants no SDK authority.
type Checkout struct {
	URL string `json:"url"`
}

// BillingCancellation acknowledges a period-end cancellation request, not completed cancellation.
type BillingCancellation struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// CouponValidation is the server's coupon assessment; eligibility is never promised by the SDK.
type CouponValidation struct {
	Code         string   `json:"code"`
	PercentOff   float64  `json:"percent_off"`
	Mode         string   `json:"mode"`
	Currency     string   `json:"currency"`
	MonthlyTotal *float64 `json:"monthly_total,omitempty"`
}

func billingKey(key string) bool {
	k := strings.TrimSpace(key)
	return len(k) >= 8 && len(k) <= 200 && !strings.ContainsAny(key, "\r\n")
}

func couponCode(code string) bool {
	return len(strings.TrimSpace(code)) >= 1 && len(code) <= 64
}

// BillingStatus reads entitlement and availability with a signed-in user token and selected project.
func (c *FaceTimeClient) BillingStatus(ctx context.Context) (Result[BillingStatus], error) {
	return perform[BillingStatus](ctx, c, "GET", "/billing", nil, ProjectAuth, nil, 200, "needs_reconciliation", "shared_available", "dedicated_available")
}

// CreateCheckout makes one explicitly authorized billing request; never retries or opens the URL.
func (c *FaceTimeClient) CreateCheckout(ctx context.Context, input CheckoutInput, key string) (Result[Checkout], error) {
	if (input.Plan != "shared" && input.Plan != "dedicated") || !billingKey(key) || (input.CouponCode != nil && !couponCode(*input.CouponCode)) {
		return Result[Checkout]{}, invalid()
	}
	body := map[string]any{"action": "checkout", "plan": input.Plan}
	if input.CouponCode != nil {
		body["coupon_code"] = *input.CouponCode
	}
	k := strings.TrimSpace(key)
	return perform[Checkout](ctx, c, "POST", "/billing", body, ProjectAuth, &k, 200, "url")
}

// CancelSubscription requests period-end cancellation; refresh BillingStatus to confirm.
func (c *FaceTimeClient) CancelSubscription(ctx context.Context, key string) (Result[BillingCancellation], error) {
	if !billingKey(key) {
		return Result[BillingCancellation]{}, invalid()
	}
	k := strings.TrimSpace(key)
	return perform[BillingCancellation](ctx, c, "POST", "/billing", map[string]string{"action": "cancel"}, ProjectAuth, &k, 200, "status", "message")
}

// ValidateCoupon asks the server to assess a coupon code.
func (c *FaceTimeClient) ValidateCoupon(ctx context.Context, code, key string) (Result[CouponValidation], error) {
	if !couponCode(code) || !billingKey(key) {
		return Result[CouponValidation]{}, invalid()
	}
	k := strings.TrimSpace(key)
	return perform[CouponValidation](ctx, c, "POST", "/billing", map[string]string{"action": "validate_coupon", "coupon_code": code}, ProjectAuth, &k, 200, "code", "percent_off", "mode", "currency")
}
