//! Preview recorded messaging events and webhook subscriptions. No replay or reconnection.
use crate::{safe_request, ChertClient, ChertError, HttpMethod};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fmt, ops::ControlFlow};

#[derive(Clone, Deserialize)]
pub struct MessagingEvent {
    pub id: String,
    pub r#type: String,
    pub event_id: String,
    pub lead_id: Option<String>,
    pub convo_id: Option<String>,
    pub payload: serde_json::Map<String, Value>,
    pub created_at: String,
}
#[derive(Clone, Deserialize)]
pub struct DeliveryAttempt {
    pub at: String,
    pub status: Option<u16>,
    pub duration_ms: f64,
    pub error: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct EventDelivery {
    pub status: String,
    pub url: Option<String>,
    pub attempts: Vec<DeliveryAttempt>,
    pub delivered_at: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct RecordedMessagingEvent {
    #[serde(flatten)]
    pub event: MessagingEvent,
    pub delivery: EventDelivery,
    pub updated_at: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct MessagingEventPage {
    pub events: Vec<RecordedMessagingEvent>,
    pub next_cursor: Option<String>,
    pub count: u64,
}
#[derive(Default)]
pub struct EventListOptions<'a> {
    pub r#type: Option<&'a str>,
    pub status: Option<&'a str>,
    pub lead_id: Option<&'a str>,
    pub since: Option<&'a str>,
    pub cursor: Option<&'a str>,
    pub limit: Option<u16>,
}
#[derive(Clone, Deserialize)]
pub struct WebhookSubscription {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
    pub version: String,
    pub is_active: bool,
    pub created_at: String,
    pub consecutive_failures: Option<u64>,
    pub last_success_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub updated_at: Option<String>,
}
#[derive(Deserialize)]
pub struct WebhookSubscriptions {
    pub subscriptions: Vec<WebhookSubscription>,
}
#[derive(Deserialize)]
pub struct WebhookSubscriptionResponse {
    pub subscription: WebhookSubscription,
}
#[derive(Deserialize)]
pub struct CreatedWebhookSubscription {
    #[serde(flatten)]
    pub subscription: WebhookSubscription,
    pub secret: String,
}
#[derive(Deserialize)]
pub struct CreatedWebhookSubscriptionResponse {
    pub subscription: CreatedWebhookSubscription,
}
#[derive(Deserialize)]
pub struct DeletedWebhookSubscription {
    pub deleted: bool,
    pub id: String,
}
#[derive(Serialize)]
pub struct CreateWebhookSubscription {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
#[derive(Default, Serialize)]
pub struct UpdateWebhookSubscription {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_active: Option<bool>,
}
pub struct MessagingStreamFrame {
    pub event: String,
    pub data: Value,
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
    MessagingEvent,
    DeliveryAttempt,
    EventDelivery,
    RecordedMessagingEvent,
    MessagingEventPage,
    EventListOptions<'_>,
    WebhookSubscription,
    WebhookSubscriptions,
    WebhookSubscriptionResponse,
    CreatedWebhookSubscription,
    CreatedWebhookSubscriptionResponse,
    DeletedWebhookSubscription,
    CreateWebhookSubscription,
    UpdateWebhookSubscription,
    MessagingStreamFrame
);

fn resource_path(collection: &str, id: &str) -> Result<String, ChertError> {
    if id.is_empty()
        || id.len() > 160
        || matches!(id, "." | "..")
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err(ChertError::new(None, "invalid_identifier"));
    }
    Ok(format!("/{collection}/{id}"))
}

impl ChertClient {
    pub async fn list_events(
        &self,
        options: &EventListOptions<'_>,
    ) -> Result<MessagingEventPage, ChertError> {
        if options
            .limit
            .is_some_and(|limit| !(1..=200).contains(&limit))
        {
            return Err(ChertError::new(None, "invalid_pagination"));
        }
        let mut url = self
            .base
            .join("events")
            .map_err(|_| ChertError::new(None, "invalid_path"))?;
        {
            let mut query = url.query_pairs_mut();
            for (key, value) in [
                ("type", options.r#type),
                ("status", options.status),
                ("lead_id", options.lead_id),
                ("since", options.since),
                ("cursor", options.cursor),
            ] {
                if let Some(value) = value {
                    query.append_pair(key, value);
                }
            }
            if let Some(limit) = options.limit {
                query.append_pair("limit", &limit.to_string());
            }
        }
        self.request(
            &format!("/events?{}", url.query().unwrap_or("")),
            HttpMethod::GET,
            None,
        )
        .await
    }
    pub async fn get_event(&self, row_id: &str) -> Result<RecordedMessagingEvent, ChertError> {
        self.request(&resource_path("events", row_id)?, HttpMethod::GET, None)
            .await
    }
    pub async fn list_webhook_subscriptions(&self) -> Result<WebhookSubscriptions, ChertError> {
        self.request("/webhook-subscriptions", HttpMethod::GET, None)
            .await
    }
    pub async fn get_webhook_subscription(
        &self,
        id: &str,
    ) -> Result<WebhookSubscriptionResponse, ChertError> {
        self.request(
            &resource_path("webhook-subscriptions", id)?,
            HttpMethod::GET,
            None,
        )
        .await
    }
    pub async fn create_webhook_subscription(
        &self,
        input: &CreateWebhookSubscription,
    ) -> Result<CreatedWebhookSubscriptionResponse, ChertError> {
        let body =
            serde_json::to_value(input).map_err(|_| ChertError::new(None, "invalid_request"))?;
        self.request("/webhook-subscriptions", HttpMethod::POST, Some(&body))
            .await
    }
    pub async fn update_webhook_subscription(
        &self,
        id: &str,
        input: &UpdateWebhookSubscription,
    ) -> Result<WebhookSubscriptionResponse, ChertError> {
        let body =
            serde_json::to_value(input).map_err(|_| ChertError::new(None, "invalid_request"))?;
        self.request(
            &resource_path("webhook-subscriptions", id)?,
            HttpMethod::PATCH,
            Some(&body),
        )
        .await
    }
    pub async fn delete_webhook_subscription(
        &self,
        id: &str,
    ) -> Result<DeletedWebhookSubscription, ChertError> {
        self.request(
            &resource_path("webhook-subscriptions", id)?,
            HttpMethod::DELETE,
            None,
        )
        .await
    }

    /// Consume one authenticated SSE connection. `since` is opaque; no Last-Event-ID or retries.
    /// Drop this future or return `ControlFlow::Break(())` to release the response.
    /// The configured transport timeout applies to the entire connection. Callbacks must not block.
    pub async fn stream_events<F>(
        &self,
        since: Option<&str>,
        mut callback: F,
    ) -> Result<(), ChertError>
    where
        F: FnMut(MessagingStreamFrame) -> ControlFlow<()>,
    {
        let mut url = self
            .base
            .join("events/stream")
            .map_err(|_| ChertError::new(None, "invalid_path"))?;
        if let Some(since) = since {
            url.query_pairs_mut().append_pair("since", since);
        }
        let path = format!(
            "/events/stream{}",
            url.query().map(|q| format!("?{q}")).unwrap_or_default()
        );
        if !safe_request(&path) {
            return Err(ChertError::new(None, "invalid_path"));
        }
        let mut headers = http::HeaderMap::new();
        self.guard_request(&mut headers);
        headers.insert(
            http::header::ACCEPT,
            http::HeaderValue::from_static("text/event-stream"),
        );
        let mut response = self
            .http
            .send(HttpMethod::GET, url, headers, None)
            .await
            .map_err(|_| ChertError::new(None, "stream_unavailable"))?;
        self.check_contract(&response)?;
        let status = response.status();
        let success = (200..300).contains(&status);
        let request_id = response.request_id();
        let failure = |code: &str| ChertError {
            status: Some(if success { 502 } else { status }),
            code: code.into(),
            request_id: request_id.clone(),
            data: None,
        };
        if !success
            || !response.header("content-type").is_some_and(|v| {
                v.split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case("text/event-stream")
            })
        {
            return Err(failure("stream_unavailable"));
        }
        let mut decoder = Decoder::default();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| failure("invalid_event_stream"))?
        {
            for &byte in chunk.iter() {
                if let Some(frame) = decoder
                    .push(byte)
                    .map_err(|_| failure("invalid_event_stream"))?
                {
                    let close = frame.event == "close";
                    if callback(frame).is_break() || close {
                        return Ok(());
                    }
                }
            }
        }
        if let Some(frame) = decoder
            .finish()
            .map_err(|_| failure("invalid_event_stream"))?
        {
            let _ = callback(frame);
        }
        Ok(())
    }
}

#[derive(Default)]
struct Decoder {
    line: Vec<u8>,
    data: Vec<String>,
    event: String,
    size: usize,
    after_cr: bool,
}
impl Decoder {
    fn push(&mut self, byte: u8) -> Result<Option<MessagingStreamFrame>, ()> {
        let mut frame = None;
        if self.after_cr {
            self.after_cr = false;
            if byte == b'\n' {
                // Count the complete CRLF before dispatching or resetting the frame.
                self.count_byte()?;
                return self.consume_line();
            }
            frame = self.consume_line()?;
        }
        self.count_byte()?;
        match byte {
            b'\r' => self.after_cr = true,
            b'\n' => return self.consume_line(),
            _ => self.line.push(byte),
        }
        Ok(frame)
    }

    fn count_byte(&mut self) -> Result<(), ()> {
        self.size += 1;
        if self.size > 1024 * 1024 {
            return Err(());
        }
        Ok(())
    }

    fn finish(&mut self) -> Result<Option<MessagingStreamFrame>, ()> {
        if self.after_cr {
            self.after_cr = false;
            return self.consume_line();
        }
        // Unterminated frames are not dispatched; invalid UTF-8 still fails closed.
        std::str::from_utf8(&self.line).map_err(|_| ())?;
        Ok(None)
    }

    fn consume_line(&mut self) -> Result<Option<MessagingStreamFrame>, ()> {
        let line = std::str::from_utf8(&self.line).map_err(|_| ())?;
        if line.is_empty() {
            let frame = if self.data.is_empty() {
                None
            } else {
                Some(MessagingStreamFrame {
                    event: if self.event.is_empty() {
                        "message".into()
                    } else {
                        self.event.clone()
                    },
                    data: serde_json::from_str(&self.data.join("\n")).map_err(|_| ())?,
                })
            };
            self.data.clear();
            self.event.clear();
            self.size = 0;
            return Ok(frame);
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "data" => self.data.push(value.into()),
            "event" => self.event = value.into(),
            _ => {}
        }
        self.line.clear();
        Ok(None)
    }
}
