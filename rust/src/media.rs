//! Custom media v1 (video-only): explicit capabilities, session grants and raw frame validation.
//! There is no media engine here: pass a grant's `endpoint` and `token` to a standard WHIP
//! (RFC 9725) client to publish, or a WHEP (draft-ietf-wish-whep-05, experimental) client to subscribe.
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
/// What a capability section can carry. `Screen` on `custom_video` means an agent can stream a
/// screen (capped at 15 fps); on `inbound_caller_video` it means the caller's shared screen is
/// available as its own `CallerScreen` subscription.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaContent {
    Camera,
    Screen,
}
/// What a session carries. Publish: `Camera` (default) or `Screen` (capped at 15 fps).
/// Subscribe: omit for the caller's video, or `CallerScreen` for the caller's shared screen
/// (only while sharing). A call has one publish slot (`media_session_conflict`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaSessionContent {
    Camera,
    Screen,
    CallerScreen,
}
impl MediaSessionContent {
    fn wire(self) -> &'static str {
        match self {
            Self::Camera => "camera",
            Self::Screen => "screen",
            Self::CallerScreen => "caller_screen",
        }
    }
    /// Whether this content may be requested for `direction`.
    pub(crate) fn allowed_for(self, direction: MediaDirection) -> bool {
        match direction {
            MediaDirection::Publish => matches!(self, Self::Camera | Self::Screen),
            MediaDirection::Subscribe => self == Self::CallerScreen,
        }
    }
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
    /// What may be published; never empty (defaults to `[Camera]`).
    pub contents: Vec<MediaContent>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboundCallerVideoCapability {
    pub supported: bool,
    pub transports: Vec<InboundVideoTransport>,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: u32,
    /// What may be received; never empty (defaults to `[Camera]`).
    pub contents: Vec<MediaContent>,
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
/// Unknown entries are ignored for forward compatibility; absent or empty means camera only.
fn contents(value: Option<&Value>) -> Vec<MediaContent> {
    let mut out = Vec::new();
    for item in value.and_then(Value::as_array).into_iter().flatten() {
        let content = match item.as_str() {
            Some("camera") => MediaContent::Camera,
            Some("screen") => MediaContent::Screen,
            _ => continue,
        };
        if !out.contains(&content) {
            out.push(content);
        }
    }
    if out.is_empty() {
        out.push(MediaContent::Camera);
    }
    out
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
                contents: contents(cv.get("contents")),
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
                contents: contents(iv.get("contents")),
            });
        }
    }
    out
}

/// Request for one video-only media session. `codecs` is an ordered, non-empty, unique preference.
/// `content` must be `Camera`/`Screen` for publish or `CallerScreen` for subscribe; `None` sends nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateMediaSession {
    pub direction: MediaDirection,
    pub codecs: Option<Vec<VideoCodec>>,
    pub content: Option<MediaSessionContent>,
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
    /// Echo of the requested content; `None` on grants for the default content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<MediaSessionContent>,
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
            .field("content", &self.content)
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

/// Validated grant, or `None` when any field violates the v1 contract, the requested codecs or content.
pub(crate) fn parse_media_session_grant(
    value: &Value,
    direction: MediaDirection,
    requested: Option<&[VideoCodec]>,
    requested_content: Option<MediaSessionContent>,
) -> Option<MediaSessionGrant> {
    let wire_direction = match direction {
        MediaDirection::Publish => "publish",
        MediaDirection::Subscribe => "subscribe",
    };
    if value.get("direction")?.as_str()? != wire_direction {
        return None;
    }
    // A requested content must be echoed exactly; a default request accepts no echo or camera (either direction).
    let content = match (requested_content, value.get("content")) {
        (Some(want), Some(echo)) if echo.as_str() == Some(want.wire()) => Some(want),
        (None, None) => None,
        (None, Some(echo)) if echo == "camera" => Some(MediaSessionContent::Camera),
        _ => return None,
    };
    let fps_cap = if content == Some(MediaSessionContent::Screen) {
        15
    } else {
        30
    };
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
            max_fps: wire_int(limits.get("max_fps"), fps_cap)?,
            max_frame_bytes: wire_int(limits.get("max_frame_bytes"), MAX_FRAME_BYTES as u64)?,
        },
        content,
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

// Call video composition (draft, unreleased): the call's video as up to two layers, composed
// server-side and published through the call's single publish slot. A base layer (z 0) carries
// camera frames over a publish grant or a backend-managed source; page layers (z >= 1) are living
// sessions of ready deployments. Native SDKs do not deploy pages or drive page state/events/input.

/// SDK v1 layer bound. The capability's `max_layers` is the backend's real limit.
pub const COMPOSITION_MAX_LAYERS: usize = 2;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// `Camera`: the response carries a publish grant for WHIP frames. `Managed`: a backend-provided
/// source, only where the `video_composition` capability lists it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompositionBaseKind {
    Camera,
    Managed,
}
/// Normalized to the output frame: 0..1, width/height > 0, and x+width, y+height <= 1.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompositionRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl CompositionRegion {
    pub const FULL: Self = Self {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    };
}
/// `Transparent` renders the page with alpha (premultiplied source-over).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompositionBackground {
    #[default]
    Opaque,
    Transparent,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LivingInputKind {
    Pointer,
    Keyboard,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseLayerInput {
    pub id: String,
    pub source: CompositionBaseKind,
}
/// A page layer. `deployment_id` names a ready living-service deployment: the call-video resource
/// never loads a URL, and native SDKs cannot deploy one (deploy with the TypeScript SDK).
#[derive(Clone, Debug, PartialEq)]
pub struct PageLayerInput {
    pub id: String,
    /// Unique, 1..=64; paints in ascending order above the base.
    pub z: u32,
    pub deployment_id: String,
    /// Default: full frame.
    pub region: Option<CompositionRegion>,
    /// Default: `Opaque`.
    pub background: Option<CompositionBackground>,
    /// Layer multiplier 0..1. Default 1.
    pub opacity: Option<f64>,
    /// Agent-relayed input kinds; `None` for a non-interactive layer.
    pub input: Option<Vec<LivingInputKind>>,
    /// Plain JSON up to 64 KiB.
    pub initial_state: Option<Value>,
}
impl PageLayerInput {
    /// A full-frame, opaque, non-interactive page layer.
    pub fn new(id: impl Into<String>, z: u32, deployment_id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            z,
            deployment_id: deployment_id.into(),
            region: None,
            background: None,
            opacity: None,
            input: None,
            initial_state: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub enum VideoLayerInput {
    Base(BaseLayerInput),
    Page(PageLayerInput),
}
/// `Page` is one opaque, full-frame page layer (id `page`, z 1). `revision` makes the PUT
/// compare-and-set; it must equal the current revision.
#[derive(Clone, Debug, PartialEq)]
pub enum SetCallVideo {
    Page {
        deployment_id: String,
        input: Option<Vec<LivingInputKind>>,
        initial_state: Option<Value>,
        revision: Option<u64>,
    },
    Layers {
        layers: Vec<VideoLayerInput>,
        revision: Option<u64>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompositionStatus {
    Starting,
    Live,
    Stopping,
    Stopped,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LivingSessionStatus {
    Starting,
    Ready,
    Live,
    Stopping,
    Stopped,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LivingViewport {
    pub width: u32,
    pub height: u32,
}
/// The living session rendering a page layer; effective viewport and fps.
#[derive(Clone, Debug, PartialEq)]
pub struct LivingSession {
    pub session_id: String,
    pub call_id: String,
    pub deployment_id: String,
    pub status: LivingSessionStatus,
    pub viewport: LivingViewport,
    pub fps: u32,
    pub ready_at: Option<String>,
    pub last_heartbeat_at: Option<String>,
    pub error_code: Option<String>,
}
/// Effective output: fps = min(base fps, grant limit); page layers render at or below it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompositionOutput {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}
/// The base layer, always at z 0. `publish` is a camera publish grant when the backend issues one.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseLayer {
    pub id: String,
    pub source: CompositionBaseKind,
    pub publish: Option<MediaSessionGrant>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct PageLayer {
    pub id: String,
    pub z: u32,
    pub living_session: LivingSession,
    pub region: CompositionRegion,
    pub background: CompositionBackground,
    pub opacity: f64,
    pub input: Vec<LivingInputKind>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum VideoLayer {
    Base(BaseLayer),
    Page(PageLayer),
}
/// One validated composition. Unknown top-level fields are kept in `extra`.
#[derive(Clone, Debug, PartialEq)]
pub struct CallVideoComposition {
    pub composition_id: String,
    pub call_id: String,
    pub revision: u64,
    pub status: CompositionStatus,
    pub output: CompositionOutput,
    pub layers: Vec<VideoLayer>,
    pub error_code: Option<String>,
    pub extra: serde_json::Map<String, Value>,
}

/// Explicit, versioned `video_composition` capability. Never inferred from custom video or living services.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VideoCompositionCapability {
    pub version: u8,
    pub supported: bool,
    pub max_layers: u32,
    pub bases: Vec<CompositionBaseKind>,
    pub page_alpha: bool,
    pub regions: bool,
    pub max_width: u32,
    pub max_height: u32,
    pub max_fps: u32,
}

/// Parses `video_composition`. Absent, malformed, unknown-version or unsupported input is `None`.
/// Unknown bases are ignored and larger limits clamp to SDK v1 bounds.
pub fn parse_video_composition(value: &Value) -> Option<VideoCompositionCapability> {
    if value.get("version").and_then(Value::as_f64) != Some(1.0)
        || value.get("supported") != Some(&Value::Bool(true))
    {
        return None;
    }
    let bases = value.get("bases")?.as_array()?;
    let positive = |key: &str, cap: f64| -> Option<u32> {
        let n = value.get(key)?.as_f64()?;
        (n.fract() == 0.0 && n > 0.0).then(|| n.min(cap) as u32)
    };
    let mut kinds = Vec::new();
    for base in bases {
        let kind = match base.as_str() {
            Some("camera") => CompositionBaseKind::Camera,
            Some("managed") => CompositionBaseKind::Managed,
            _ => continue,
        };
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    Some(VideoCompositionCapability {
        version: 1,
        supported: true,
        max_layers: positive("max_layers", COMPOSITION_MAX_LAYERS as f64)?,
        bases: kinds,
        page_alpha: value.get("page_alpha") == Some(&Value::Bool(true)),
        regions: value.get("regions") == Some(&Value::Bool(true)),
        max_width: positive("max_width", 1920.0)?,
        max_height: positive("max_height", 1080.0)?,
        max_fps: positive("max_fps", 30.0)?,
    })
}

fn layer_id(id: &str) -> bool {
    let b = id.as_bytes();
    (1..=32).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-'))
}
fn unit(n: f64) -> bool {
    n.is_finite() && (0.0..=1.0).contains(&n)
}
fn region_ok(r: &CompositionRegion) -> bool {
    const EPS: f64 = 1e-9;
    unit(r.x)
        && unit(r.y)
        && unit(r.width)
        && unit(r.height)
        && r.width > 0.0
        && r.height > 0.0
        && r.x + r.width <= 1.0 + EPS
        && r.y + r.height <= 1.0 + EPS
}
fn inputs_ok(kinds: &[LivingInputKind]) -> bool {
    kinds
        .iter()
        .enumerate()
        .all(|(i, kind)| !kinds[..i].contains(kind))
}
/// Plain JSON within `max` nodes, depth 64 and `max` serialized bytes.
fn plain_json(value: &Value, max: usize) -> bool {
    fn walk(value: &Value, depth: usize, nodes: &mut usize, max: usize) -> bool {
        *nodes += 1;
        depth <= 64
            && *nodes <= max
            && match value {
                Value::Array(items) => items.iter().all(|v| walk(v, depth + 1, nodes, max)),
                Value::Object(map) => map.values().all(|v| walk(v, depth + 1, nodes, max)),
                _ => true,
            }
    }
    walk(value, 0, &mut 0, max) && serde_json::to_vec(value).is_ok_and(|b| b.len() <= max)
}
/// A ready deployment ID. URL pages are rejected: native SDKs cannot deploy them.
fn deployment_id(id: &str) -> bool {
    (1..=128).contains(&id.encode_utf16().count()) && !id.contains("://")
}
/// Integral values serialize as JSON integers, as `JSON.stringify` does.
fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER as f64 {
        Value::from(n as i64)
    } else {
        Value::from(n)
    }
}

/// Validates locally and returns the PUT body, or `None` when the input breaks the contract.
pub(crate) fn call_video_body(input: &SetCallVideo) -> Option<Value> {
    let shortcut;
    let (layers, revision): (&[VideoLayerInput], Option<u64>) = match input {
        SetCallVideo::Page {
            deployment_id,
            input,
            initial_state,
            revision,
        } => {
            shortcut = [VideoLayerInput::Page(PageLayerInput {
                input: input.clone(),
                initial_state: initial_state.clone(),
                ..PageLayerInput::new("page", 1, deployment_id.clone())
            })];
            (&shortcut, *revision)
        }
        SetCallVideo::Layers { layers, revision } => (layers, *revision),
    };
    if layers.is_empty()
        || layers.len() > COMPOSITION_MAX_LAYERS
        || revision.is_some_and(|r| r > MAX_SAFE_INTEGER)
    {
        return None;
    }
    let (mut ids, mut zs, mut bases, mut out) = (Vec::new(), Vec::new(), 0, Vec::new());
    let mut bottom: Option<(u32, CompositionRegion, CompositionBackground, f64)> = None;
    for layer in layers {
        let id = match layer {
            VideoLayerInput::Base(base) => &base.id,
            VideoLayerInput::Page(page) => &page.id,
        };
        if !layer_id(id) || ids.contains(&id) {
            return None;
        }
        ids.push(id);
        let page = match layer {
            VideoLayerInput::Base(base) => {
                bases += 1;
                if bases > 1 {
                    return None;
                }
                out.push(json!({"id": base.id, "z": 0, "source": {"kind": base.source}}));
                continue;
            }
            VideoLayerInput::Page(page) => page,
        };
        if !(1..=64).contains(&page.z) || zs.contains(&page.z) {
            return None;
        }
        zs.push(page.z);
        let region = page.region.unwrap_or(CompositionRegion::FULL);
        let background = page.background.unwrap_or_default();
        let opacity = page.opacity.unwrap_or(1.0);
        if !region_ok(&region)
            || !unit(opacity)
            || page.input.as_deref().is_some_and(|i| !inputs_ok(i))
            || page
                .initial_state
                .as_ref()
                .is_some_and(|s| !plain_json(s, 64 * 1024))
            || !deployment_id(&page.deployment_id)
        {
            return None;
        }
        let mut body = json!({
            "id": page.id, "z": page.z, "page": {"deployment_id": page.deployment_id},
            "region": {"x": number(region.x), "y": number(region.y),
                "width": number(region.width), "height": number(region.height)},
            "background": background, "opacity": number(opacity),
        });
        if let Some(kinds) = &page.input {
            body["input"] = json!(kinds);
        }
        if let Some(state) = &page.initial_state {
            body["initial_state"] = state.clone();
        }
        if bottom.is_none_or(|(z, ..)| page.z < z) {
            bottom = Some((page.z, region, background, opacity));
        }
        out.push(body);
    }
    if bases == 0 {
        // Nothing below the bottom page: it must fill the frame without showing through.
        let (_, region, background, opacity) = bottom?;
        if region != CompositionRegion::FULL
            || background != CompositionBackground::Opaque
            || opacity != 1.0
        {
            return None;
        }
    }
    let mut body = json!({ "layers": out });
    if let Some(revision) = revision {
        body["revision"] = json!(revision);
    }
    Some(body)
}

/// Non-negative safe JSON integer (integral floats included).
fn safe_int(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    if let Some(n) = value.as_u64() {
        return (n <= MAX_SAFE_INTEGER).then_some(n);
    }
    let f = value.as_f64()?;
    (f.fract() == 0.0 && f >= 0.0 && f <= MAX_SAFE_INTEGER as f64).then_some(f as u64)
}
fn bounded(value: Option<&Value>, min: u64, max: u64) -> Option<u32> {
    safe_int(value)
        .filter(|n| (min..=max).contains(n))
        .map(|n| n as u32)
}
fn even(value: Option<&Value>, max: u64) -> Option<u32> {
    bounded(value, 16, max).filter(|n| n % 2 == 0)
}
/// Absent or null is `None`; any other non-string is invalid.
fn nullable_text(value: Option<&Value>) -> Option<Option<String>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        _ => None,
    }
}
fn living_session(value: &Value) -> Option<LivingSession> {
    let session_id = value
        .get("session_id")?
        .as_str()
        .filter(|s| !s.is_empty())?;
    let status = match value.get("status")?.as_str()? {
        "starting" => LivingSessionStatus::Starting,
        "ready" => LivingSessionStatus::Ready,
        "live" => LivingSessionStatus::Live,
        "stopping" => LivingSessionStatus::Stopping,
        "stopped" => LivingSessionStatus::Stopped,
        "failed" => LivingSessionStatus::Failed,
        _ => return None,
    };
    let viewport = value.get("viewport").filter(|v| v.is_object())?;
    Some(LivingSession {
        session_id: session_id.into(),
        call_id: value.get("call_id")?.as_str()?.into(),
        deployment_id: value.get("deployment_id")?.as_str()?.into(),
        status,
        viewport: LivingViewport {
            width: even(viewport.get("width"), 1920)?,
            height: even(viewport.get("height"), 1080)?,
        },
        fps: bounded(value.get("fps"), 1, 30)?,
        ready_at: nullable_text(value.get("ready_at"))?,
        last_heartbeat_at: nullable_text(value.get("last_heartbeat_at"))?,
        error_code: nullable_text(value.get("error_code"))?,
    })
}

/// Validated composition, or `None` for any response outside the contract.
pub(crate) fn parse_call_video(value: &Value) -> Option<CallVideoComposition> {
    let map = value.as_object()?;
    let text = |key: &str| map.get(key)?.as_str().filter(|s| !s.is_empty());
    let (composition_id, call_id) = (text("composition_id")?, text("call_id")?);
    let revision = safe_int(map.get("revision"))?;
    let status = match map.get("status")?.as_str()? {
        "starting" => CompositionStatus::Starting,
        "live" => CompositionStatus::Live,
        "stopping" => CompositionStatus::Stopping,
        "stopped" => CompositionStatus::Stopped,
        "failed" => CompositionStatus::Failed,
        _ => return None,
    };
    let error_code = match map.get("error_code")? {
        Value::Null => None,
        Value::String(code) => Some(code.clone()),
        _ => return None,
    };
    let output = map.get("output").filter(|o| o.is_object())?;
    let output = CompositionOutput {
        width: even(output.get("width"), 1920)?,
        height: even(output.get("height"), 1080)?,
        fps: bounded(output.get("fps"), 1, 30)?,
    };
    let raw = map.get("layers")?.as_array()?;
    if raw.len() > COMPOSITION_MAX_LAYERS {
        return None;
    }
    let (mut ids, mut zs, mut layers) = (Vec::new(), Vec::new(), Vec::new());
    let mut has_base = false;
    for layer in raw {
        let id = layer.as_object()?.get("id")?.as_str()?;
        let z = safe_int(layer.get("z"));
        if ids.contains(&id) || z.is_some_and(|z| zs.contains(&z)) {
            return None;
        }
        ids.push(id);
        zs.extend(z);
        if let Some(source) = layer.get("source") {
            let source = match source.get("kind").and_then(Value::as_str) {
                Some("camera") => CompositionBaseKind::Camera,
                Some("managed") => CompositionBaseKind::Managed,
                _ => return None,
            };
            if has_base || z != Some(0) {
                return None;
            }
            has_base = true;
            let publish = match layer.get("publish") {
                None => None,
                Some(grant) => {
                    if source != CompositionBaseKind::Camera {
                        return None;
                    }
                    let grant = parse_media_session_grant(
                        grant,
                        MediaDirection::Publish,
                        None,
                        Some(MediaSessionContent::Camera),
                    )?;
                    if output.fps > grant.limits.max_fps {
                        return None;
                    }
                    Some(grant)
                }
            };
            layers.push(VideoLayer::Base(BaseLayer {
                id: id.into(),
                source,
                publish,
            }));
            continue;
        }
        let region = layer.get("region").filter(|r| r.is_object())?;
        let coordinate = |key: &str| region.get(key)?.as_f64().filter(|n| unit(*n));
        let region = CompositionRegion {
            x: coordinate("x")?,
            y: coordinate("y")?,
            width: coordinate("width")?,
            height: coordinate("height")?,
        };
        let background = match layer.get("background")?.as_str()? {
            "opaque" => CompositionBackground::Opaque,
            "transparent" => CompositionBackground::Transparent,
            _ => return None,
        };
        let opacity = layer.get("opacity")?.as_f64().filter(|n| unit(*n))?;
        let input = layer
            .get("input")?
            .as_array()?
            .iter()
            .map(|kind| match kind.as_str()? {
                "pointer" => Some(LivingInputKind::Pointer),
                "keyboard" => Some(LivingInputKind::Keyboard),
                "text" => Some(LivingInputKind::Text),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
        let living_session = living_session(layer.get("living_session")?)?;
        let z = z.filter(|z| (1..=u64::from(u32::MAX)).contains(z))? as u32;
        if !region_ok(&region)
            || !inputs_ok(&input)
            || living_session.call_id != call_id
            || living_session.fps > output.fps
        {
            return None;
        }
        layers.push(VideoLayer::Page(PageLayer {
            id: id.into(),
            z,
            living_session,
            region,
            background,
            opacity,
            input,
        }));
    }
    let known = [
        "composition_id",
        "call_id",
        "revision",
        "status",
        "output",
        "layers",
        "error_code",
    ];
    Some(CallVideoComposition {
        composition_id: composition_id.into(),
        call_id: call_id.into(),
        revision,
        status,
        output,
        layers,
        error_code,
        extra: map
            .iter()
            .filter(|(k, _)| !known.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    })
}

/// The topmost page layer accepting pointer input under an output-frame point (x, y normalized
/// 0..1), or `None`. The backend maps output-frame coordinates into the page.
pub fn composition_input_target(
    composition: &CallVideoComposition,
    x: f64,
    y: f64,
) -> Option<&PageLayer> {
    if !unit(x) || !unit(y) {
        return None;
    }
    composition
        .layers
        .iter()
        .filter_map(|layer| match layer {
            VideoLayer::Page(page) if page.input.contains(&LivingInputKind::Pointer) => Some(page),
            _ => None,
        })
        .filter(|p| {
            let r = p.region;
            x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
        })
        .max_by_key(|p| p.z)
}
