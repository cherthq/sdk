package chert

import (
	"encoding/json"
	"math"
)

// Validate the fields that make a typed result usable, without closing the
// server schema to additive fields or new status values. Validate wire values
// before Go's decoder can turn null/missing scalars into false, zero, or "".
func validResponse(value any, model any) bool {
	o, _ := value.(map[string]any)
	switch model.(type) {
	case Call:
		return nonempty(o, "id", "status") && booleanFields(object(o["media"]), "audio", "video")
	case Line:
		return nonempty(o, "id", "status") && booleanFields(o, "supports_audio", "supports_video")
	case Worker:
		return nonempty(o, "id", "status") && booleanFields(o, "enabled")
	case Assistant:
		return nonempty(o, "id") && integer(o["draft_revision"], 1) && object(o["draft_config"]) != nil
	case PublishedAssistant:
		return nonempty(o, "published_version_id") && validResponse(o["assistant"], Assistant{})
	case Page[Call]:
		return validPage(o, Call{})
	case Page[Line]:
		return validPage(o, Line{})
	case Page[Worker]:
		return validPage(o, Worker{})
	case Page[Assistant]:
		return validPage(o, Assistant{})
	case CallEvents:
		return nonempty(o, "call_id") && validElements(o["events"], CallEvent{})
	case CallEvent:
		return nonempty(o, "id", "type", "at", "source")
	case Transcript:
		return nonempty(o, "call_id") && integer(o["schema_version"], 1) && validElements(o["turns"], TranscriptTurn{})
	case TranscriptTurn:
		_, text := o["text"].(string)
		return nonempty(o, "occurred_at", "speaker") && text
	case ProjectSettings:
		a, ok := o["livekit_allowed_hosts"].([]any)
		if !ok {
			return false
		}
		for _, v := range a {
			if s, ok := v.(string); !ok || s == "" {
				return false
			}
		}
		return true
	case DeviceLoginStart:
		return nonempty(o, "device_code", "user_code", "verification_url", "verification_url_complete") && integer(o["expires_in"], 1) && integer(o["interval"], 1)
	case LoginResult:
		if o["status"] == "pending" {
			return true
		}
		return o["status"] == "approved" && nonempty(o, "access_token", "device_name") && nonempty(object(o["project"]), "id") && integer(o["expires_in"], 1)
	case LoginInspection:
		return nonempty(o, "device_name", "created_at") && integer(o["expires_in"], 0)
	case LoginApproval:
		return nonempty(o, "device_name", "project_id")
	case Identity:
		return nonempty(o, "role") && nonempty(object(o["project"]), "id")
	case Revoked:
		return booleanFields(o, "revoked")
	case Credentials:
		return validElements(o["credentials"], Credential{})
	case Credential:
		return nonempty(o, "id", "device_name", "token_prefix", "user_id", "created_at", "expires_at")
	case ConnectorReceipt:
		return nonempty(object(o["credentials"]), "connection", "recovery")
	case BillingStatus:
		_, sales := o["sales_enabled"].(bool)
		e, hasEntitlement := o["entitlement"]
		_, entitlementObject := e.(map[string]any)
		return booleanFields(o, "needs_reconciliation", "shared_available", "dedicated_available") &&
			(o["sales_enabled"] == nil || sales) && hasEntitlement && (e == nil || entitlementObject)
	case Checkout:
		return nonempty(o, "url")
	case BillingCancellation:
		return o["status"] == "cancellation_requested" && nonempty(o, "message")
	case CouponValidation:
		_, pct := o["percent_off"].(float64)
		return nonempty(o, "code", "currency") && pct && (o["mode"] == "live" || o["mode"] == "test")
	case json.RawMessage:
		return true
	default:
		return false
	}
}

func object(v any) map[string]any { o, _ := v.(map[string]any); return o }
func nonempty(o map[string]any, fields ...string) bool {
	for _, field := range fields {
		if s, ok := o[field].(string); !ok || s == "" {
			return false
		}
	}
	return true
}
func booleanFields(o map[string]any, fields ...string) bool {
	for _, field := range fields {
		if _, ok := o[field].(bool); !ok {
			return false
		}
	}
	return true
}
func integer(v any, minimum float64) bool {
	n, ok := v.(float64)
	return ok && n >= minimum && n <= 9007199254740991 && math.Trunc(n) == n
}
func validElements(v any, model any) bool {
	a, ok := v.([]any)
	if !ok {
		return false
	}
	for _, item := range a {
		if !validResponse(item, model) {
			return false
		}
	}
	return true
}
func validPage(o map[string]any, model any) bool {
	return integer(o["total"], 0) && integer(o["limit"], 1) && o["limit"].(float64) <= 100 && integer(o["offset"], 0) && validElements(o["items"], model)
}
