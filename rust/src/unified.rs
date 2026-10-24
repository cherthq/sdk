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

pub(crate) const CONTRACT: &str = "chert-unified-v1";
const SCOPES: [&str; 6] = [
    "imessage:events:read",
    "imessage:webhooks:manage",
    "imessage:messages:send",
    "facetime:calls:read",
    "facetime:calls:create",
    "facetime:calls:control",
];

/// Opt-in proposed unified session. Overrides are explicitly trusted origins, not descriptor hints.
pub struct UnifiedSessionOptions<'a> {
    pub access_token: &'a str,
    pub project_id: &'a str,
    pub imessage_base_url: &'a str,
    pub facetime_base_url: &'a str,
    pub limits: TransportLimits,
}
impl<'a> UnifiedSessionOptions<'a> {
    pub fn new(access_token: &'a str, project_id: &'a str) -> Self {
        Self {
            access_token,
            project_id,
            imessage_base_url: IMessageConfig::DEFAULT_BASE_URL,
            facetime_base_url: FaceTimeConfig::DEFAULT_BASE_URL,
            limits: TransportLimits::default(),
        }
    }
}
impl fmt::Debug for UnifiedSessionOptions<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("UnifiedSessionOptions { .. }")
    }
}

/// One package, two independently authenticated clients. Either channel may be omitted.
#[derive(Clone, Debug)]
pub struct ChertSdk {
    pub imessage: Option<IMessageClient>,
    pub facetime: Option<FaceTimeClient>,
}
impl ChertSdk {
    /// Discover the proposed v1 contract without credentials, then bind both channels to one session.
    /// No device flow, refresh, fallback or retries. Legacy `new` remains independent.
    pub async fn connect(options: UnifiedSessionOptions<'_>) -> Result<Self, ChertError> {
        let token = options.access_token.strip_prefix("chu_").unwrap_or("");
        if token.len() != 43
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || options.project_id.len() != 36
            || !options.project_id.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
        {
            return Err(ChertError::new(None, "invalid_unified_session"));
        }
        // Reuse strict URL and limit validation, without sending the temporary clients' headers.
        let origin = |base| -> Result<String, ChertError> {
            let client = IMessageClient::new(
                base,
                "validation-only",
                None,
                options.limits.timeout,
                options.limits.max_response_bytes,
            )?;
            let url = reqwest::Url::parse(base)
                .map_err(|_| ChertError::new(None, "invalid_configuration"))?;
            if url.path() != "/" {
                return Err(ChertError::new(None, "invalid_configuration"));
            }
            Ok(client.base.origin().ascii_serialization())
        };
        let imessage = origin(options.imessage_base_url)?;
        let facetime = origin(options.facetime_base_url)?;
        let unsupported = || ChertError::new(None, "unsupported_unified_backend");
        let discovery = reqwest::Client::builder()
            .timeout(options.limits.timeout.min(Duration::from_secs(15)))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(|_| unsupported())?;
        let mut response = discovery
            .get(format!("{imessage}/api/v1/sdk/capabilities"))
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|_| unsupported())?;
        if !response.status().is_success() {
            return Err(unsupported());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unsupported())? {
            if chunk.len() > 65_536usize.saturating_sub(bytes.len()) {
                return Err(unsupported());
            }
            bytes.extend_from_slice(&chunk);
        }
        let envelope: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| unsupported())?;
        let data = &envelope["data"];
        if data["contract"] != "chert-unified"
            || data["contract_version"] != 1
            || data["auth"]["scheme"] != "Bearer"
            || data["auth"]["token_prefix"] != "chu_"
            || data["auth"]["audience"] != "chert.unified-api:v1"
            || data["auth"]["login_url"] != format!("{facetime}/api/v1/cli/logins")
            || data["services"]["imessage"]["base_url"] != format!("{imessage}/api/v1")
            || data["services"]["facetime"]["base_url"] != format!("{facetime}/api/v1")
            || !data["scopes"].as_array().is_some_and(|scopes| {
                let mut unique = std::collections::HashSet::new();
                scopes
                    .iter()
                    .all(|scope| scope.as_str().is_some_and(|s| unique.insert(s)))
                    && SCOPES.iter().all(|scope| unique.contains(scope))
            })
        {
            return Err(unsupported());
        }
        let mut messaging = IMessageClient::new(
            &imessage,
            options.access_token,
            None,
            options.limits.timeout,
            options.limits.max_response_bytes,
        )?;
        messaging.unified_contract = true;
        let mut calling = FaceTimeClient::new(FaceTimeConfig {
            base_url: &facetime,
            api_key: options.access_token,
            project_id: options.project_id,
            limits: options.limits,
        })?;
        calling.transport.unified_contract = true;
        Ok(Self {
            imessage: Some(messaging),
            facetime: Some(calling),
        })
    }

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
