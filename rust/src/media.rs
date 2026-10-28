//! Custom media v1 (video-only): explicit capabilities, session grants and raw frame validation.
//! There is no media engine here: pass a grant's `endpoint` and `token` to a standard WHIP
//! (RFC 9725) client to publish, or a WHEP (draft-ietf-wish-whep-05, experimental) client to subscribe.
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

/// Upper bound for one raw frame's required plane bytes and for grant `max_frame_bytes`.
pub const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    Vp8,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaDirection {
    Publish,
    Subscribe,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CustomVideoTransport {
    Whip,
    Livekit,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InboundVideoTransport {
    Whep,
    Livekit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomVideoCapability {
    pub supported: bool,
    pub transports: Vec<CustomVideoTransport>,
    pub codecs: Vec<VideoCodec>,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboundCallerVideoCapability {
    pub supported: bool,
    pub transports: Vec<InboundVideoTransport>,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: u32,
}
/// `None` sections are unsupported. Never infer support from generic video flags.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaCapabilities {
    pub version: u8,
    pub custom_video: Option<CustomVideoCapability>,
    pub inbound_caller_video: Option<InboundCallerVideoCapability>,
}
impl Default for MediaCapabilities {
    fn default() -> Self {
        Self {
            version: 1,
            custom_video: None,
            inbound_caller_video: None,
        }
    }
}

/// JSON integer (integral floats included) in `1..=max`.
fn wire_int(value: Option<&Value>, max: u64) -> Option<u32> {
    let value = value?;
    let n = match value.as_u64() {
        Some(n) => n,
        None => {
            let f = value.as_f64()?;
            if f.fract() != 0.0 || f <= 0.0 || f > max as f64 {
                return None;
            }
            f as u64
        }
    };
    (1..=max).contains(&n).then_some(n as u32)
}
fn wire_list<T: PartialEq>(value: Option<&Value>, map: fn(&str) -> Option<T>) -> Option<Vec<T>> {
    let mut out = Vec::new();
    for item in value?.as_array()? {
        let item = map(item.as_str()?)?;
        if !out.contains(&item) {
            out.push(item);
        }
    }
    Some(out)
}
fn codec(value: &str) -> Option<VideoCodec> {
    match value {
        "h264" => Some(VideoCodec::H264),
        "vp8" => Some(VideoCodec::Vp8),
        _ => None,
    }
}
fn supported(section: Option<&Value>) -> Option<&Value> {
    section.filter(|s| s.is_object() && s.get("supported") == Some(&Value::Bool(true)))
}

/// Parses a `media_capabilities` value. Absent, malformed or unknown-version input is unsupported;
/// a malformed section disables only that section. Bounds are capped at SDK v1 limits.
pub fn parse_media_capabilities(value: &Value) -> MediaCapabilities {
    let mut out = MediaCapabilities::default();
    if !value.is_object() || value.get("version").and_then(Value::as_f64) != Some(1.0) {
        return out;
    }
    if let Some(cv) = supported(value.get("custom_video")) {
        let transports = wire_list(cv.get("transports"), |t| match t {
            "whip" => Some(CustomVideoTransport::Whip),
            "livekit" => Some(CustomVideoTransport::Livekit),
            _ => None,
        });
        let codecs = wire_list(cv.get("codecs"), codec);
        if let (Some(transports), Some(codecs), Some(max_width), Some(max_height), Some(max_fps)) = (
            transports.filter(|t| !t.is_empty()),
            codecs.filter(|c| !c.is_empty()),
            wire_int(cv.get("max_width"), 1920),
            wire_int(cv.get("max_height"), 1080),
            wire_int(cv.get("max_fps"), 30),
        ) {
            out.custom_video = Some(CustomVideoCapability {
                supported: true,
                transports,
                codecs,
                max_width,
                max_height,
                max_fps,
            });
        }
    }
    if let Some(iv) = supported(value.get("inbound_caller_video")) {
        let transports = wire_list(iv.get("transports"), |t| match t {
            "whep" => Some(InboundVideoTransport::Whep),
            "livekit" => Some(InboundVideoTransport::Livekit),
            _ => None,
        });
        if let (Some(transports), Some(max_width), Some(max_height), Some(max_fps)) = (
            transports.filter(|t| !t.is_empty()),
            wire_int(iv.get("max_width"), 1280),
            wire_int(iv.get("max_height"), 720),
            wire_int(iv.get("max_fps"), 30),
        ) {
            out.inbound_caller_video = Some(InboundCallerVideoCapability {
                supported: true,
                transports,
                max_width,
                max_height,
                max_fps,
            });
        }
    }
    out
}

/// Request for one video-only media session. `codecs` is an ordered, non-empty, unique preference.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateMediaSession {
    pub direction: MediaDirection,
    pub codecs: Option<Vec<VideoCodec>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IceUrls {
    One(String),
    Many(Vec<String>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IceCredentialType {
    Password,
}
/// `Debug` omits the credential.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IceServer {
    pub urls: IceUrls,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
    #[serde(
        rename = "credentialType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub credential_type: Option<IceCredentialType>,
}
impl fmt::Debug for IceServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IceServer")
            .field("urls", &self.urls)
            .field("username", &self.username)
            .field("credential_type", &self.credential_type)
            .finish_non_exhaustive()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaSessionLimits {
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: u32,
    pub max_frame_bytes: u32,
}
/// One validated session. `endpoint` is opaque; `token` is a session-bound bearer omitted from `Debug`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaSessionGrant {
    pub session_id: String,
    pub direction: MediaDirection,
    pub endpoint: String,
    pub token: String,
    pub connect_by: String,
    pub expires_at: String,
    pub ice_servers: Vec<IceServer>,
    pub codecs: Vec<VideoCodec>,
    pub limits: MediaSessionLimits,
}
impl fmt::Debug for MediaSessionGrant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MediaSessionGrant")
            .field("session_id", &self.session_id)
            .field("direction", &self.direction)
            .field("endpoint", &self.endpoint)
            .field("token", &"<redacted>")
            .field("connect_by", &self.connect_by)
            .field("expires_at", &self.expires_at)
            .field("ice_servers", &self.ice_servers)
            .field("codecs", &self.codecs)
            .field("limits", &self.limits)
            .finish()
    }
}

/// Epoch milliseconds (fraction truncated, like `Date.parse`) for a strict RFC 3339 timestamp.
fn rfc3339_ms(value: &str) -> Option<i64> {
    let b = value.as_bytes();
    let num = |range: std::ops::Range<usize>| -> Option<i64> {
        let part = b.get(range)?;
        if !part.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(part).ok()?.parse().ok()
    };
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || !matches!(b[10], b'T' | b't')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=days_in_month).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let mut rest = &value[19..];
    let mut millis = 0;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        millis = format!("{:0<3}", &fraction[..digits.min(3)]).parse().ok()?;
        rest = &fraction[digits..];
    }
    let offset = match rest.as_bytes() {
        [b'Z' | b'z'] => 0,
        [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2]
            if [h1, h2, m1, m2].iter().all(|d| d.is_ascii_digit()) =>
        {
            let hours = i64::from((*h1 - b'0') * 10 + (*h2 - b'0'));
            let minutes = i64::from((*m1 - b'0') * 10 + (*m2 - b'0'));
            if hours > 23 || minutes > 59 {
                return None;
            }
            (hours * 60 + minutes) * if *sign == b'+' { 1 } else { -1 }
        }
        _ => return None,
    };
    // Days from 1970-01-01 in the proleptic Gregorian calendar.
    let y = if month <= 2 { year - 1 } else { year };
    let (era, yoe) = (y.div_euclid(400), y.rem_euclid(400));
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some(((days * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + millis)
}
fn endpoint(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let local = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    (url.scheme() == "https" || local)
        && url.username().is_empty()
        && url.password().is_none_or(str::is_empty)
        && url.fragment().is_none_or(str::is_empty)
}
fn ice_server(value: &Value) -> Option<IceServer> {
    let urls = match value.as_object()?.get("urls")? {
        Value::String(url) => IceUrls::One(url.clone()),
        Value::Array(urls) if !urls.is_empty() => IceUrls::Many(
            urls.iter()
                .map(|u| u.as_str().map(str::to_owned))
                .collect::<Option<_>>()?,
        ),
        _ => return None,
    };
    // Optional fields may be absent but never null or another type.
    let text = |key: &str| -> Option<Option<String>> {
        match value.get(key) {
            None => Some(None),
            Some(Value::String(s)) => Some(Some(s.clone())),
            _ => None,
        }
    };
    let credential_type = match value.get("credentialType") {
        None => None,
        Some(v) if v == "password" => Some(IceCredentialType::Password),
        _ => return None,
    };
    Some(IceServer {
        urls,
        username: text("username")?,
        credential: text("credential")?,
        credential_type,
    })
}

/// Validated grant, or `None` when any field violates the v1 contract or the requested codecs.
pub(crate) fn parse_media_session_grant(
    value: &Value,
    direction: MediaDirection,
    requested: Option<&[VideoCodec]>,
) -> Option<MediaSessionGrant> {
    let wire_direction = match direction {
        MediaDirection::Publish => "publish",
        MediaDirection::Subscribe => "subscribe",
    };
    if value.get("direction")?.as_str()? != wire_direction {
        return None;
    }
    let session_id = value.get("session_id")?.as_str()?;
    let endpoint_url = value.get("endpoint")?.as_str()?;
    let token = value.get("token")?.as_str()?;
    let connect_by = value.get("connect_by")?.as_str()?;
    let expires_at = value.get("expires_at")?.as_str()?;
    if session_id.len() != 36
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
        || !endpoint(endpoint_url)
        || token.is_empty()
        || token.contains(['\r', '\n'])
        || rfc3339_ms(connect_by)? > rfc3339_ms(expires_at)?
    {
        return None;
    }
    let ice_servers = value
        .get("ice_servers")?
        .as_array()?
        .iter()
        .map(ice_server)
        .collect::<Option<Vec<_>>>()?;
    let codecs = value
        .get("codecs")?
        .as_array()?
        .iter()
        .map(|c| codec(c.as_str()?))
        .collect::<Option<Vec<_>>>()?;
    let limits = value.get("limits").filter(|l| l.is_object())?;
    let (width_cap, height_cap) = match direction {
        MediaDirection::Publish => (1920, 1080),
        MediaDirection::Subscribe => (1280, 720),
    };
    if codecs.is_empty()
        || codecs
            .iter()
            .enumerate()
            .any(|(i, c)| codecs[..i].contains(c) || requested.is_some_and(|r| !r.contains(c)))
    {
        return None;
    }
    Some(MediaSessionGrant {
        session_id: session_id.into(),
        direction,
        endpoint: endpoint_url.into(),
        token: token.into(),
        connect_by: connect_by.into(),
        expires_at: expires_at.into(),
        ice_servers,
        codecs,
        limits: MediaSessionLimits {
            max_width: wire_int(limits.get("max_width"), width_cap)?,
            max_height: wire_int(limits.get("max_height"), height_cap)?,
            max_fps: wire_int(limits.get("max_fps"), 30)?,
            max_frame_bytes: wire_int(limits.get("max_frame_bytes"), MAX_FRAME_BYTES as u64)?,
        },
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PixelFormat {
    I420,
    Nv12,
    Rgba,
    Bgra,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Rotation {
    #[default]
    Deg0,
    Deg90,
    Deg180,
    Deg270,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ColorSpace {
    Bt709Limited,
    Bt601Limited,
    SrgbFull,
}
/// Borrowed caller plane; only `stride * (rows - 1) + row_bytes` bytes are copied.
#[derive(Clone, Copy)]
pub struct PlaneRef<'a> {
    pub data: &'a [u8],
    pub stride: usize,
}
/// Raw frame input. `timestamp_us` is monotonic presentation time in microseconds.
#[derive(Clone, Copy)]
pub struct VideoFrameInit<'a> {
    pub format: PixelFormat,
    pub width: u32,
    pub height: u32,
    pub planes: &'a [PlaneRef<'a>],
    pub timestamp_us: u64,
    pub duration_us: Option<u64>,
    pub rotation: Option<Rotation>,
    pub color_space: Option<ColorSpace>,
}
/// Owned copy of the required plane bytes (stride preserved).
#[derive(Clone, PartialEq, Eq)]
pub struct VideoPlane {
    data: Vec<u8>,
    stride: usize,
}
impl VideoPlane {
    pub fn data(&self) -> &[u8] {
        &self.data
    }
    pub fn stride(&self) -> usize {
        self.stride
    }
}
impl fmt::Debug for VideoPlane {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VideoPlane")
            .field("len", &self.data.len())
            .field("stride", &self.stride)
            .finish()
    }
}
/// Validated raw frame; construct with [`VideoFrame::copy_from`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoFrame {
    format: PixelFormat,
    width: u32,
    height: u32,
    planes: Vec<VideoPlane>,
    timestamp_us: u64,
    duration_us: Option<u64>,
    rotation: Rotation,
    color_space: ColorSpace,
}
/// Frame validation failure; `code()` is `invalid_frame` or `frame_too_large`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MediaFrameError {
    InvalidFrame(String),
    FrameTooLarge,
}
impl MediaFrameError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidFrame(_) => "invalid_frame",
            Self::FrameTooLarge => "frame_too_large",
        }
    }
}
impl fmt::Display for MediaFrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFrame(message) => f.write_str(message),
            Self::FrameTooLarge => f.write_str("Frame exceeds 8 MiB."),
        }
    }
}
impl std::error::Error for MediaFrameError {}

impl VideoFrame {
    /// Validates and copies only the required bytes so callers may reuse their buffers.
    pub fn copy_from(input: &VideoFrameInit<'_>) -> Result<Self, MediaFrameError> {
        let invalid = |message: String| Err(MediaFrameError::InvalidFrame(message));
        let (width, height) = (input.width, input.height);
        if width % 2 != 0
            || height % 2 != 0
            || !(16..=1920).contains(&width)
            || !(16..=1080).contains(&height)
        {
            return invalid("Dimensions must be even integers between 16 and 1920x1080.".into());
        }
        if input.duration_us == Some(0) {
            return invalid("duration_us must be a positive integer.".into());
        }
        let (w, h) = (width as usize, height as usize);
        let layout: &[(usize, usize)] = match input.format {
            PixelFormat::Rgba | PixelFormat::Bgra => &[(w * 4, h)],
            PixelFormat::I420 => &[(w, h), (w / 2, h / 2), (w / 2, h / 2)],
            PixelFormat::Nv12 => &[(w, h), (w, h / 2)],
        };
        if input.planes.len() != layout.len() {
            return invalid(format!(
                "{} requires {} plane(s).",
                format!("{:?}", input.format).to_ascii_lowercase(),
                layout.len()
            ));
        }
        let mut total = 0;
        let mut planes = Vec::with_capacity(layout.len());
        for (i, (plane, &(row_bytes, rows))) in input.planes.iter().zip(layout).enumerate() {
            if plane.stride < row_bytes || plane.stride > row_bytes + 256 {
                return invalid(format!(
                    "Plane {i} stride must be between {row_bytes} and {} bytes.",
                    row_bytes + 256
                ));
            }
            let needed = plane.stride * (rows - 1) + row_bytes;
            if plane.data.len() < needed {
                return invalid(format!("Plane {i} needs at least {needed} bytes."));
            }
            total += needed;
            if total > MAX_FRAME_BYTES {
                return Err(MediaFrameError::FrameTooLarge);
            }
            planes.push(VideoPlane {
                data: plane.data[..needed].to_vec(),
                stride: plane.stride,
            });
        }
        let yuv = matches!(input.format, PixelFormat::I420 | PixelFormat::Nv12);
        Ok(Self {
            format: input.format,
            width,
            height,
            planes,
            timestamp_us: input.timestamp_us,
            duration_us: input.duration_us,
            rotation: input.rotation.unwrap_or_default(),
            color_space: input.color_space.unwrap_or(if yuv {
                ColorSpace::Bt709Limited
            } else {
                ColorSpace::SrgbFull
            }),
        })
    }
    pub fn format(&self) -> PixelFormat {
        self.format
    }
    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn planes(&self) -> &[VideoPlane] {
        &self.planes
    }
    pub fn timestamp_us(&self) -> u64 {
        self.timestamp_us
    }
    pub fn duration_us(&self) -> Option<u64> {
        self.duration_us
    }
    pub fn rotation(&self) -> Rotation {
        self.rotation
    }
    pub fn color_space(&self) -> ColorSpace {
        self.color_space
    }
}
