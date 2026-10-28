#![doc = include_str!("../README.md")]
pub mod events;
pub mod facetime;
mod unified;
pub mod webhook;
pub use unified::{
    ChertSdk, FaceTimeConfig, IMessageConfig, TransportLimits, UnifiedSessionOptions,
};
/// Explicit name for the messaging client; `ChertClient` remains its compatibility name.
pub type IMessageClient = ChertClient;

use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION},
    Method, Url,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{fmt, time::Duration};

/// Raw response metadata is explicit opt-in data; formatting never exposes it.
pub struct ChertError {
    pub status: Option<u16>,
    pub code: String,
    pub request_id: Option<String>,
    pub data: Option<Value>,
}
impl ChertError {
    fn new(status: Option<u16>, code: &str) -> Self {
        Self {
            status,
            code: code.into(),
            request_id: None,
            data: None,
        }
    }
}
impl fmt::Display for ChertError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Chert request failed; reconcile uncertain operations before retrying"
        )
    }
}
impl fmt::Debug for ChertError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChertError")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}
impl std::error::Error for ChertError {}

#[derive(Clone)]
pub struct ChertClient {
    base: Url,
    http: reqwest::Client,
    max_response_bytes: usize,
    unified_contract: bool,
}

/// Verified queue acceptance only; this is not sent or delivery evidence.
pub struct QueuedTextReceipt {
    pub success: bool,
    pub message_id: String,
    pub chat_id: String,
    pub status: String,
}
impl fmt::Debug for QueuedTextReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("QueuedTextReceipt { .. }")
    }
}
/// Native dispatch acknowledgement only; never applied or recipient-state evidence.
pub struct ReactionReceipt {
    pub operation_id: String,
    pub chat_id: String,
    pub message_id: String,
    pub status: String,
}
impl fmt::Debug for ReactionReceipt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ReactionReceipt { .. }")
    }
}
struct JsonResponse {
    status: u16,
    request_id: Option<String>,
    value: Value,
}
impl fmt::Debug for ChertClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ChertClient { .. }")
    }
}

fn clean(value: &str) -> bool {
    !value.chars().any(|c| c.is_control() || c.is_whitespace())
}
fn blank_text(text: &str) -> bool {
    // Match the cloud's String.trim; Rust Unicode whitespace differs at BOM/NEL.
    text.chars().all(|c| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}
fn safe_path(path: &str) -> bool {
    if !path.starts_with('/')
        || path.starts_with("//")
        || !clean(path)
        || path.contains(['\\', '?', '#'])
    {
        return false;
    }
    let bytes = path.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%' {
            let Some(pair) = bytes.get(i + 1..i + 3) else {
                return false;
            };
            let Ok(hex) = std::str::from_utf8(pair) else {
                return false;
            };
            let Ok(decoded) = u8::from_str_radix(hex, 16) else {
                return false;
            };
            if decoded <= 32 || decoded == 127 || b"/\\.%?#".contains(&decoded) {
                return false;
            }
        }
    }
    // Dot segments must be rejected before URL joining normalizes them away.
    if path.split('/').any(|part| part == "." || part == "..") {
        return false;
    }
    true
}
fn safe_request(path: &str) -> bool {
    if path.len() > 8192 || !clean(path) || path.contains(['\\', '#']) {
        return false;
    }
    let (pathname, query) = path.split_once('?').unwrap_or((path, ""));
    if !safe_path(pathname) {
        return false;
    }
    let bytes = query.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%' {
            let Some(pair) = bytes.get(i + 1..i + 3) else {
                return false;
            };
            let Ok(hex) = std::str::from_utf8(pair) else {
                return false;
            };
            let Ok(decoded) = u8::from_str_radix(hex, 16) else {
                return false;
            };
            if decoded < 32 || decoded == 127 {
                return false;
            }
        }
    }
    true
}
impl ChertClient {
    /// Builds a messaging client from configuration, including its official default origin.
    /// Explicit invalid overrides fail rather than falling back to production.
    pub fn from_config(config: IMessageConfig<'_>) -> Result<Self, ChertError> {
        Self::new(
            config.base_url,
            config.api_key,
            config.tenant,
            config.limits.timeout,
            config.limits.max_response_bytes,
        )
    }

    /// Explicit HTTPS base (HTTP only for parsed loopback/localhost), credentials and limits.
    /// Root bases default to `/api/v1`; other deployment prefixes are retained.
    pub fn new(
        base: &str,
        api_key: &str,
        tenant: Option<&str>,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Result<Self, ChertError> {
        Self::with_scope(
            base,
            api_key,
            tenant.map(|v| ("x-chert-tenant", v)),
            timeout,
            max_response_bytes,
        )
    }

    fn with_scope(
        base: &str,
        api_key: &str,
        scope: Option<(&'static str, &str)>,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Result<Self, ChertError> {
        let invalid = || ChertError::new(None, "invalid_configuration");
        if !clean(base)
            || base.contains('\\')
            || timeout.is_zero()
            || std::time::Instant::now().checked_add(timeout).is_none()
            || max_response_bytes == 0
            || api_key.trim().is_empty()
            || api_key.chars().any(char::is_control)
            || scope.is_some_and(|(_, s)| s.trim().is_empty() || s.chars().any(char::is_control))
        {
            return Err(invalid());
        }
        // Inspect raw path before URL normalization can remove dot segments.
        let (_, authority_path) = base.split_once("://").ok_or_else(invalid)?;
        let raw_path = authority_path
            .find('/')
            .map(|i| &authority_path[i..])
            .unwrap_or("/");
        if !safe_path(raw_path) {
            return Err(invalid());
        }
        let mut url = Url::parse(base).map_err(|_| invalid())?;
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(url.scheme() == "https" || url.scheme() == "http" && loopback)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
        {
            return Err(invalid());
        }
        if url.path() == "/" {
            url.set_path("/api/v1");
        }
        url.set_path(&format!("{}/", url.path().trim_end_matches('/')));
        let mut headers = HeaderMap::new();
        let mut auth =
            HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|_| invalid())?;
        auth.set_sensitive(true);
        headers.insert(AUTHORIZATION, auth);
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        if let Some((name, value)) = scope {
            headers.insert(name, HeaderValue::from_str(value).map_err(|_| invalid())?);
        }
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .no_proxy()
            .build()
            .map_err(|_| invalid())?;
        Ok(Self {
            base: url,
            http,
            max_response_bytes,
            unified_contract: false,
        })
    }
    fn guard_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.unified_contract {
            request.header("x-chert-contract", unified::CONTRACT)
        } else {
            request
        }
    }
    fn check_contract(&self, response: &reqwest::Response) -> Result<(), ChertError> {
        let mut echoes = response.headers().get_all("x-chert-contract").iter();
        if self.unified_contract
            && (echoes.next().and_then(|v| v.to_str().ok()) != Some(unified::CONTRACT)
                || echoes.next().is_some())
        {
            return Err(ChertError::new(None, "unsupported_unified_backend"));
        }
        Ok(())
    }
    /// `None` omits the body; `Some(Value::Null)` sends JSON null.
    /// Drop this future to cancel waiting. Cancellation/timeout cannot retract a server effect.
    /// HTTP 204 decodes JSON null (use `()` or `Option<T>`).
    pub async fn request<T: DeserializeOwned>(
        &self,
        path: &str,
        method: Method,
        body: Option<&Value>,
    ) -> Result<T, ChertError> {
        let response = self.request_json(path, method, body).await?;
        serde_json::from_value(response.value).map_err(|_| ChertError {
            status: Some(502),
            code: "invalid_response_type".into(),
            request_id: response.request_id,
            data: None,
        })
    }

    /// One strict text request. Preserve an explicit key when reconciling; never retry an unknown outcome.
    pub async fn send_text(
        &self,
        phone: &str,
        text: &str,
        idempotency_key: Option<&str>,
    ) -> Result<QueuedTextReceipt, ChertError> {
        let digits = phone.strip_prefix('+').unwrap_or("");
        if !(2..=15).contains(&digits.len())
            || !matches!(digits.as_bytes().first(), Some(b'1'..=b'9'))
            || !digits.bytes().all(|b| b.is_ascii_digit())
            || blank_text(text)
            || text.len() > 16384
            || text.contains('\0')
            || idempotency_key
                .is_some_and(|key| key.is_empty() || key.len() > 200 || key.contains('\0'))
        {
            return Err(ChertError::new(None, "invalid_text_request"));
        }
        let mut body = serde_json::json!({"phone": phone, "body": text});
        if let Some(key) = idempotency_key {
            body["idempotency_key"] = Value::String(key.into());
        }
        let response = self
            .request_json("/text-operations/v1", Method::POST, Some(&body))
            .await?;
        let value = &response.value;
        let message_id = value
            .get("message_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let chat_id = value.get("chat_id").and_then(Value::as_str).unwrap_or("");
        if response.status != 202
            || value.as_object().is_none_or(|row| row.len() != 4)
            || value.get("success") != Some(&Value::Bool(true))
            || value.get("status").and_then(Value::as_str) != Some("queued")
            || message_id.len() != 32
            || !message_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || chat_id.is_empty()
            || chat_id.len() > 160
            || !chat_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b":_-".contains(&b))
        {
            return Err(ChertError {
                status: Some(502),
                code: "unconfirmed_text_outcome".into(),
                request_id: response.request_id,
                data: Some(response.value),
            });
        }
        Ok(QueuedTextReceipt {
            success: true,
            message_id: message_id.into(),
            chat_id: chat_id.into(),
            status: "queued".into(),
        })
    }

    /// One part-zero standard reaction. Drop the future to cancel local waiting;
    /// cancellation cannot undo dispatch and this method never retries.
    pub async fn send_reaction(
        &self,
        chat_id: &str,
        message_id: &str,
        reaction: &str,
        remove: bool,
        idempotency_key: Option<&str>,
    ) -> Result<ReactionReceipt, ChertError> {
        let uuid = chat_id.len() == 36
            && chat_id.bytes().enumerate().all(|(i, b)| {
                if matches!(i, 8 | 13 | 18 | 23) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            });
        if !uuid
            || message_id.is_empty()
            || message_id.len() > 160
            || matches!(message_id, "." | "..")
            || !message_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b":_.-".contains(&b))
            || !matches!(
                reaction,
                "love" | "like" | "dislike" | "laugh" | "emphasize" | "question"
            )
            || idempotency_key.is_some_and(|key| {
                key.is_empty()
                    || key.len() > 200
                    || key.starts_with(' ')
                    || key.ends_with(' ')
                    || !key.bytes().all(|b| (0x20..=0x7e).contains(&b))
            })
        {
            return Err(ChertError::new(None, "invalid_reaction_request"));
        }
        let chat_id = chat_id.to_ascii_lowercase();
        // The validated alphabet has only one reserved character: colon.
        // Encode it before passing the fixed relative path to the shared transport.
        let message_segment = message_id.replace(':', "%3A");
        let path = format!("/chats/{chat_id}/messages/{message_segment}/reactions");
        let body = serde_json::json!({"reaction":reaction,"remove":remove,"part_index":0});
        let response = self
            .request_json_with_key(&path, Method::POST, Some(&body), idempotency_key)
            .await?;
        let value = &response.value;
        let operation_id = value
            .get("operation_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        if response.status != 202
            || value.as_object().is_none_or(|row| row.len() != 4)
            || value.get("chat_id").and_then(Value::as_str) != Some(chat_id.as_str())
            || value.get("message_id").and_then(Value::as_str) != Some(message_id)
            || value.get("status").and_then(Value::as_str) != Some("acknowledged")
            || operation_id.len() != 32
            || !operation_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(ChertError {
                status: Some(502),
                code: "unconfirmed_reaction_outcome".into(),
                request_id: response.request_id,
                data: Some(response.value),
            });
        }
        Ok(ReactionReceipt {
            operation_id: operation_id.into(),
            chat_id,
            message_id: message_id.into(),
            status: "acknowledged".into(),
        })
    }

    async fn request_json(
        &self,
        path: &str,
        method: Method,
        body: Option<&Value>,
    ) -> Result<JsonResponse, ChertError> {
        self.request_json_with_key(path, method, body, None).await
    }

    async fn request_json_with_key(
        &self,
        path: &str,
        method: Method,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> Result<JsonResponse, ChertError> {
        if !safe_request(path) {
            return Err(ChertError::new(None, "invalid_path"));
        }
        let url = self
            .base
            .join(&path[1..])
            .map_err(|_| ChertError::new(None, "invalid_path"))?;
        if url.origin() != self.base.origin() || !url.path().starts_with(self.base.path()) {
            return Err(ChertError::new(None, "invalid_path"));
        }
        let mut request = self.guard_request(self.http.request(method, url));
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(key) = idempotency_key {
            let mut header = HeaderValue::from_str(key)
                .map_err(|_| ChertError::new(None, "invalid_reaction_request"))?;
            header.set_sensitive(true);
            request = request.header("idempotency-key", header);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| ChertError::new(None, "outcome_unknown"))?;
        self.check_contract(&response)?;
        let status = response.status();
        let request_id = response
            .headers()
            .get("x-trace-id")
            .or_else(|| response.headers().get("x-request-id"))
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let failure = |code: &str, data: Option<Value>| ChertError {
            status: Some(
                if status.is_success()
                    && matches!(
                        code,
                        "invalid_response" | "invalid_response_type" | "response_too_large"
                    )
                {
                    502
                } else {
                    status.as_u16()
                },
            ),
            code: code.into(),
            request_id: request_id.clone(),
            data,
        };
        if status.as_u16() == 204 {
            return Ok(JsonResponse {
                status: 204,
                request_id,
                value: Value::Null,
            });
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| failure("outcome_unknown", None))?
        {
            if chunk.len() > self.max_response_bytes.saturating_sub(bytes.len()) {
                return Err(failure("response_too_large", None));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| failure("invalid_response", None))?;
        if !status.is_success() || value.get("success") == Some(&Value::Bool(false)) {
            let error = value
                .get("error")
                .filter(|v| v.is_object())
                .unwrap_or(&value);
            let code = match error.get("code") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                _ => "request_failed".into(),
            };
            return Err(ChertError {
                status: Some(if status.is_success() {
                    502
                } else {
                    status.as_u16()
                }),
                code,
                request_id,
                data: Some(value),
            });
        }
        Ok(JsonResponse {
            status: status.as_u16(),
            request_id,
            value,
        })
    }
}
pub use reqwest::Method as HttpMethod;
