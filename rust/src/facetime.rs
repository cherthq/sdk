//! FaceTime control-plane HTTP API. This does not implement a LiveKit media runtime.
//! Mutations make one attempt; an accepted action is not evidence that a call connected or ended.
use crate::{ChertClient, ChertError, FaceTimeConfig, HttpMethod};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fmt;

/// The control plane's actual envelope; request IDs are retained, not discarded.
#[derive(Clone, Deserialize, Serialize)]
pub struct ApiResponse<T> {
    pub data: T,
    pub request_id: String,
}
/// One page; callers explicitly choose whether to request another page.
#[derive(Clone, Deserialize, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub limit: u32,
    pub offset: u64,
}
/// Independent audio and video requests/capabilities.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Media {
    pub audio: bool,
    pub video: bool,
}
/// Call snapshot. Status strings remain open to future server states; never infer delivery.
#[derive(Clone, Deserialize, Serialize)]
pub struct Call {
    pub id: String,
    pub project_id: String,
    pub direction: String,
    pub mode: String,
    pub status: String,
    pub media: Media,
    pub line_id: Option<String>,
    pub assistant_id: Option<String>,
    pub terminal_reason: Option<String>,
    /// Additional server fields, including timestamps and embedded events, preserved losslessly.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
/// Public line snapshot. Availability/readiness details remain server-owned fields in `extra`.
#[derive(Clone, Deserialize, Serialize)]
pub struct Line {
    pub id: String,
    pub display_name: String,
    pub status: String,
    pub supports_audio: bool,
    pub supports_video: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
/// Versioned assistant; configuration is server-versioned JSON, not a media implementation.
#[derive(Clone, Deserialize, Serialize)]
pub struct Assistant {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub status: String,
    pub draft_revision: u64,
    pub draft_config: Value,
    pub active_version_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct PublishedAssistant {
    pub assistant: Assistant,
    pub published_version_id: String,
}
/// The server validates the versioned assistant configuration schema.
#[derive(Clone, Serialize)]
pub struct CreateAssistant {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub draft_config: Value,
}
/// Optimistic revision is mandatory. Omitted fields remain unchanged.
#[derive(Clone, Serialize)]
pub struct UpdateAssistant {
    pub expected_draft_revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `None` preserves, `Some(None)` clears, `Some(Some(value))` replaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AssistantStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_config: Option<Value>,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantStatus {
    Draft,
    Active,
    Paused,
    Archived,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InboundPolicy {
    AutoAnswer,
    CustomerDecides,
    AgentDecides,
    AutoReject,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoFraming {
    Fit,
    Fill,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectingScreenDismissal {
    Audio,
    Video,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectingScreenAppearance {
    Chert,
    Black,
}
/// Omitted fields preserve their values; nested options can explicitly clear bindings.
#[derive(Clone, Default, Serialize)]
pub struct UpdateLine {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_assistant_id: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_policy: Option<InboundPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_framing: Option<VideoFraming>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connecting_screen_dismissal: Option<ConnectingScreenDismissal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connecting_screen_appearance: Option<ConnectingScreenAppearance>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ProjectSettings {
    pub livekit_allowed_hosts: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct CallEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub at: String,
    pub sequence: Option<u64>,
    pub source: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct CallEvents {
    pub call_id: String,
    pub events: Vec<CallEvent>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct TranscriptTurn {
    pub occurred_at: String,
    pub speaker: String,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Transcript {
    pub call_id: String,
    pub schema_version: u32,
    pub turns: Vec<TranscriptTurn>,
    pub created_at: String,
}

/// Call-scoped room credentials. Formatting never reveals the participant token.
#[derive(Clone, Serialize)]
pub struct RoomCredentials {
    pub livekit_url: String,
    pub participant_token: String,
    pub remote_participant_identity: String,
}
/// The execution mode prevents combining managed assistants with BYOR secrets.
#[derive(Clone, Serialize)]
#[serde(tag = "mode")]
pub enum CallExecution {
    #[serde(rename = "managed")]
    Managed { assistant_id: String },
    #[serde(rename = "customer_managed")]
    CustomerManaged {
        #[serde(flatten)]
        room: RoomCredentials,
    },
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    Phone,
    Email,
    AppleId,
    FacetimeLink,
}
#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum Recipient {
    PhoneNumber(String),
    Email(String),
}
/// A single destination or group, never both.
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum CallTarget {
    Destination {
        destination: String,
        destination_type: DestinationType,
    },
    Group {
        recipients: Vec<Recipient>,
    },
}
/// Production outbound request. The SDK always sends `direction: outbound`.
/// Server authorization, destination policy and room-token validation remain authoritative.
#[derive(Clone, Serialize)]
pub struct CreateCall {
    /// Empty omits the field for a managed single destination, allowing server selection.
    /// BYOR, groups and FaceTime links require an explicit line.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub line_id: String,
    #[serde(flatten)]
    pub execution: CallExecution,
    #[serde(flatten)]
    pub target: CallTarget,
    pub media: Media,
}
/// Call actions are asynchronous; a 202 does not establish the resulting call state.
#[derive(Clone, Copy, Debug)]
pub enum CallAction {
    Answer,
    Reject,
    End,
}

macro_rules! redacted_debug {
    ($($ty:ty),+ $(,)?) => {$(
        impl fmt::Debug for $ty {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($ty), " { .. }"))
            }
        }
    )+};
}
redacted_debug!(
    Call,
    Line,
    Assistant,
    PublishedAssistant,
    CallEvent,
    CallEvents,
    TranscriptTurn,
    Transcript,
    RoomCredentials,
    CallExecution,
    Recipient,
    CallTarget,
    CreateCall,
    CreateAssistant,
    UpdateAssistant,
    UpdateLine,
    ProjectSettings
);
impl<T> fmt::Debug for ApiResponse<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiResponse { .. }")
    }
}
impl<T> fmt::Debug for Page<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Page { .. }")
    }
}

/// Independent project-scoped FaceTime transport using the same bounded HTTP implementation.
#[derive(Clone, Debug)]
pub struct FaceTimeClient {
    pub(super) transport: ChertClient,
}

fn identifier(id: &str) -> Result<&str, ChertError> {
    if id.is_empty()
        || id.len() > 160
        || matches!(id, "." | "..")
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(ChertError::new(None, "invalid_identifier"));
    }
    Ok(id)
}
fn key(key: &str) -> Result<(), ChertError> {
    if !(8..=200).contains(&key.len())
        || key.trim() != key
        || !key.bytes().all(|b| (0x20..=0x7e).contains(&b))
    {
        return Err(ChertError::new(None, "invalid_idempotency_key"));
    }
    Ok(())
}
fn page_path(resource: &str, limit: u32, offset: u64) -> Result<String, ChertError> {
    if !(1..=100).contains(&limit) || offset > 9_007_199_254_740_991 {
        return Err(ChertError::new(None, "invalid_pagination"));
    }
    Ok(format!("/{resource}?limit={limit}&offset={offset}"))
}
impl FaceTimeClient {
    pub fn new(config: FaceTimeConfig<'_>) -> Result<Self, ChertError> {
        identifier(config.project_id)?;
        Ok(Self {
            transport: ChertClient::with_scope(
                config.base_url,
                config.api_key,
                Some(("x-chert-project-id", config.project_id)),
                config.limits.timeout,
                config.limits.max_response_bytes,
            )?,
        })
    }

    /// Explicit escape hatch for additional control-plane routes. Preserves the JSON envelope.
    /// Optional keys are caller-owned; nothing retries, follows redirects or auto-paginates.
    pub async fn request<T: DeserializeOwned>(
        &self,
        path: &str,
        method: HttpMethod,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
    ) -> Result<ApiResponse<T>, ChertError> {
        self.perform(path, method, body, idempotency_key, None)
            .await
    }

    async fn perform<T: DeserializeOwned>(
        &self,
        path: &str,
        method: HttpMethod,
        body: Option<&Value>,
        idempotency_key: Option<&str>,
        expected_status: Option<u16>,
    ) -> Result<ApiResponse<T>, ChertError> {
        if let Some(k) = idempotency_key {
            key(k)?;
        }
        let response = self
            .transport
            .request_json_with_key(path, method, body, idempotency_key)
            .await
            .map_err(|mut error| {
                if error.request_id.is_none() {
                    error.request_id = error
                        .data
                        .as_ref()
                        .and_then(|v| v.get("request_id"))
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                }
                error
            })?;
        let request_id = response
            .value
            .get("request_id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or(response.request_id);
        if expected_status.is_some_and(|status| status != response.status) {
            return Err(ChertError {
                status: Some(502),
                code: "unconfirmed_facetime_outcome".into(),
                request_id,
                data: Some(response.value),
            });
        }
        if response.value.get("data").is_none()
            || response
                .value
                .get("request_id")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
        {
            return Err(ChertError {
                status: Some(502),
                code: "invalid_response_type".into(),
                request_id,
                data: Some(response.value),
            });
        }
        serde_json::from_value(response.value.clone()).map_err(|_| ChertError {
            status: Some(502),
            code: "invalid_response_type".into(),
            request_id,
            data: Some(response.value),
        })
    }

    pub async fn list_calls(
        &self,
        limit: u32,
        offset: u64,
    ) -> Result<ApiResponse<Page<Call>>, ChertError> {
        self.perform(
            &page_path("calls", limit, offset)?,
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn get_call(&self, id: &str) -> Result<ApiResponse<Call>, ChertError> {
        self.perform(
            &format!("/calls/{}", identifier(id)?),
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn call_events(&self, id: &str) -> Result<ApiResponse<CallEvents>, ChertError> {
        self.perform(
            &format!("/calls/{}/events", identifier(id)?),
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn transcript(&self, id: &str) -> Result<ApiResponse<Transcript>, ChertError> {
        self.perform(
            &format!("/calls/{}/transcript", identifier(id)?),
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn create_call(
        &self,
        input: &CreateCall,
        idempotency_key: &str,
    ) -> Result<ApiResponse<Call>, ChertError> {
        if !input.line_id.is_empty()
            || !matches!(&input.execution, CallExecution::Managed { .. })
            || !matches!(
                &input.target,
                CallTarget::Destination {
                    destination_type: DestinationType::Phone
                        | DestinationType::Email
                        | DestinationType::AppleId,
                    ..
                }
            )
        {
            identifier(&input.line_id)?;
        }
        match &input.execution {
            CallExecution::Managed { assistant_id } => {
                identifier(assistant_id)?;
            }
            CallExecution::CustomerManaged { room } => {
                if !input.media.audio
                    || room.livekit_url.trim().is_empty()
                    || room.participant_token.trim().is_empty()
                    || room.remote_participant_identity.trim().is_empty()
                {
                    return Err(ChertError::new(None, "invalid_call_request"));
                }
            }
        }
        match &input.target {
            CallTarget::Destination { destination, .. }
                if destination.trim().len() < 3
                    || destination.len() > 4096
                    || destination.chars().any(char::is_control) =>
            {
                return Err(ChertError::new(None, "invalid_call_request"))
            }
            CallTarget::Group { recipients } if recipients.is_empty() || recipients.len() > 31 => {
                return Err(ChertError::new(None, "invalid_call_request"))
            }
            _ => {}
        }
        let mut body = serde_json::to_value(input)
            .map_err(|_| ChertError::new(None, "invalid_call_request"))?;
        body["direction"] = json!("outbound");
        self.perform(
            "/calls",
            HttpMethod::POST,
            Some(&body),
            Some(idempotency_key),
            Some(201),
        )
        .await
    }
    pub async fn call_action(
        &self,
        id: &str,
        action: CallAction,
        reason: Option<&str>,
        idempotency_key: &str,
    ) -> Result<ApiResponse<Call>, ChertError> {
        if reason.is_some_and(|r| r.trim().chars().count() > 160) {
            return Err(ChertError::new(None, "invalid_call_request"));
        }
        let action = match action {
            CallAction::Answer => "answer",
            CallAction::Reject => "reject",
            CallAction::End => "end",
        };
        let body = reason.map_or_else(|| json!({}), |r| json!({"reason":r}));
        self.perform(
            &format!("/calls/{}/{action}", identifier(id)?),
            HttpMethod::POST,
            Some(&body),
            Some(idempotency_key),
            Some(202),
        )
        .await
    }
    pub async fn list_lines(
        &self,
        limit: u32,
        offset: u64,
    ) -> Result<ApiResponse<Page<Line>>, ChertError> {
        self.perform(
            &page_path("lines", limit, offset)?,
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn list_assistants(
        &self,
        limit: u32,
        offset: u64,
    ) -> Result<ApiResponse<Page<Assistant>>, ChertError> {
        self.perform(
            &page_path("assistants", limit, offset)?,
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }
    pub async fn get_assistant(&self, id: &str) -> Result<ApiResponse<Assistant>, ChertError> {
        self.perform(
            &format!("/assistants/{}", identifier(id)?),
            HttpMethod::GET,
            None,
            None,
            Some(200),
        )
        .await
    }

    pub async fn create_assistant(
        &self,
        input: &CreateAssistant,
    ) -> Result<ApiResponse<Assistant>, ChertError> {
        if input.name.trim().is_empty() || !input.draft_config.is_object() {
            return Err(ChertError::new(None, "invalid_assistant_request"));
        }
        let body = serde_json::to_value(input)
            .map_err(|_| ChertError::new(None, "invalid_assistant_request"))?;
        self.perform(
            "/assistants",
            HttpMethod::POST,
            Some(&body),
            None,
            Some(201),
        )
        .await
    }
    pub async fn update_assistant(
        &self,
        id: &str,
        input: &UpdateAssistant,
    ) -> Result<ApiResponse<Assistant>, ChertError> {
        if input.expected_draft_revision == 0
            || input.expected_draft_revision > 9_007_199_254_740_991
        {
            return Err(ChertError::new(None, "invalid_assistant_request"));
        }
        let body = serde_json::to_value(input)
            .map_err(|_| ChertError::new(None, "invalid_assistant_request"))?;
        self.perform(
            &format!("/assistants/{}", identifier(id)?),
            HttpMethod::PATCH,
            Some(&body),
            None,
            Some(200),
        )
        .await
    }
    pub async fn publish_assistant(
        &self,
        id: &str,
    ) -> Result<ApiResponse<PublishedAssistant>, ChertError> {
        self.perform(
            &format!("/assistants/{}/publish", identifier(id)?),
            HttpMethod::POST,
            None,
            None,
            Some(201),
        )
        .await
    }
    pub async fn update_line(
        &self,
        id: &str,
        input: &UpdateLine,
    ) -> Result<ApiResponse<Line>, ChertError> {
        let body = serde_json::to_value(input)
            .map_err(|_| ChertError::new(None, "invalid_line_request"))?;
        if body.as_object().is_none_or(|v| v.is_empty()) {
            return Err(ChertError::new(None, "invalid_line_request"));
        }
        self.perform(
            &format!("/lines/{}", identifier(id)?),
            HttpMethod::PATCH,
            Some(&body),
            None,
            Some(200),
        )
        .await
    }
    pub async fn settings(&self) -> Result<ApiResponse<ProjectSettings>, ChertError> {
        self.perform("/settings", HttpMethod::GET, None, None, Some(200))
            .await
    }
    pub async fn update_settings(
        &self,
        input: &ProjectSettings,
    ) -> Result<ApiResponse<ProjectSettings>, ChertError> {
        let body = serde_json::to_value(input)
            .map_err(|_| ChertError::new(None, "invalid_settings_request"))?;
        self.perform("/settings", HttpMethod::PUT, Some(&body), None, Some(200))
            .await
    }
}
