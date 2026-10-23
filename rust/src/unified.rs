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
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub tenant: Option<&'a str>,
    pub limits: TransportLimits,
}
/// Explicit FaceTime control-plane credentials. No messaging binding is inferred.
pub struct FaceTimeConfig<'a> {
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub project_id: &'a str,
    pub limits: TransportLimits,
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
            imessage: imessage
                .map(|c| {
                    IMessageClient::new(
                        c.base_url,
                        c.api_key,
                        c.tenant,
                        c.limits.timeout,
                        c.limits.max_response_bytes,
                    )
                })
                .transpose()?,
            facetime: facetime.map(FaceTimeClient::new).transpose()?,
        })
    }
}
