use crate::{facetime::FaceTimeClient, ChertError, IMessageClient};
use std::{fmt, time::Duration};

/// Limits apply to each single attempt, including response consumption.
#[derive(Clone, Copy, Debug)]
pub struct TransportLimits {
    pub timeout: Duration,
    pub max_response_bytes: usize,
}
impl Default for TransportLimits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(20),
            max_response_bytes: 1024 * 1024,
        }
    }
}

/// Messaging credentials are independent of FaceTime credentials and project IDs.
pub struct IMessageConfig<'a> {
    /// Explicit override; empty or invalid URLs are rejected when constructing a client.
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub tenant: Option<&'a str>,
    pub limits: TransportLimits,
}
/// Explicit FaceTime control-plane credentials. No messaging binding is inferred.
pub struct FaceTimeConfig<'a> {
    /// Explicit override; root origins use `/api/v1`, other prefixes are retained.
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub project_id: &'a str,
    pub limits: TransportLimits,
}
impl<'a> IMessageConfig<'a> {
    /// Official origin. Strict-send deployment verification remains a release prerequisite.
    pub const DEFAULT_BASE_URL: &'static str = "https://console.trychert.com";

    /// Uses the official origin and default limits. Set `base_url` to override explicitly.
    /// Configuration is validated by the client constructor; no network I/O occurs here.
    pub fn new(api_key: &'a str) -> Self {
        Self {
            base_url: Self::DEFAULT_BASE_URL,
            api_key,
            tenant: None,
            limits: TransportLimits::default(),
        }
    }
}
impl<'a> FaceTimeConfig<'a> {
    /// Official origin; the transport appends `/api/v1` exactly once.
    pub const DEFAULT_BASE_URL: &'static str = "https://facetime.trychert.com";

    /// Uses the official origin and default limits. Set `base_url` to override explicitly.
    /// Configuration is validated by the client constructor; no network I/O occurs here.
    pub fn new(api_key: &'a str, project_id: &'a str) -> Self {
        Self {
            base_url: Self::DEFAULT_BASE_URL,
            api_key,
            project_id,
            limits: TransportLimits::default(),
        }
    }
}
impl fmt::Debug for IMessageConfig<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("IMessageConfig { .. }")
    }
}
impl fmt::Debug for FaceTimeConfig<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("FaceTimeConfig { .. }")
    }
}

/// One package, two independently authenticated clients. Either channel may be omitted.
#[derive(Clone, Debug)]
pub struct ChertSdk {
    pub imessage: Option<IMessageClient>,
    pub facetime: Option<FaceTimeClient>,
}
impl ChertSdk {
    /// Validates all supplied configuration without network I/O. At least one channel is required.
    pub fn new(
        imessage: Option<IMessageConfig<'_>>,
        facetime: Option<FaceTimeConfig<'_>>,
    ) -> Result<Self, ChertError> {
        if imessage.is_none() && facetime.is_none() {
            return Err(ChertError::new(None, "missing_channel_configuration"));
        }
        Ok(Self {
            imessage: imessage.map(IMessageClient::from_config).transpose()?,
            facetime: facetime.map(FaceTimeClient::new).transpose()?,
        })
    }
}
