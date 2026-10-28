use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::fmt;
use subtle::ConstantTimeEq;

pub const TOLERANCE_SECS: i64 = 300;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebhookSignatureError {
    Malformed,
    Mismatch,
    Stale,
}
impl fmt::Display for WebhookSignatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Malformed => "malformed webhook signature",
            Self::Mismatch => "webhook signature mismatch",
            Self::Stale => "webhook timestamp outside tolerance",
        })
    }
}
impl std::error::Error for WebhookSignatureError {}

fn digest(signature: &str) -> Option<[u8; 32]> {
    let bytes = signature.as_bytes();
    if bytes.len() != 64 || !bytes.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let mut out = [0; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(signature.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

fn matches(secret: &str, parts: &[&[u8]], expected: &[u8; 32]) -> bool {
    if secret.is_empty() {
        return false;
    }
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    for part in parts {
        mac.update(part);
    }
    bool::from(mac.finalize().into_bytes().as_slice().ct_eq(expected))
}

pub fn verify_messaging_signature(
    signature: &str,
    raw_body: &[u8],
    secret: &str,
    now_unix_secs: i64,
) -> Result<(), WebhookSignatureError> {
    let signature = signature.trim();
    let parsed = signature
        .split_once(',')
        .and_then(|(t, v)| Some((t.strip_prefix("t=")?, v.strip_prefix("v1=")?)))
        .or_else(|| {
            let mut parts = signature.splitn(3, ',');
            (parts.next()? == "v1").then_some(())?;
            Some((parts.next()?, parts.next()?))
        });
    let Some((timestamp, hex)) = parsed else {
        return Err(WebhookSignatureError::Malformed);
    };
    if !(1..=16).contains(&timestamp.len()) || !timestamp.bytes().all(|b| b.is_ascii_digit()) {
        return Err(WebhookSignatureError::Malformed);
    }
    let (Ok(sent_at), Some(expected)) = (timestamp.parse::<i64>(), digest(hex)) else {
        return Err(WebhookSignatureError::Malformed);
    };
    if !matches(secret, &[timestamp.as_bytes(), b".", raw_body], &expected) {
        return Err(WebhookSignatureError::Mismatch);
    }
    if now_unix_secs.abs_diff(sent_at) > TOLERANCE_SECS as u64 {
        return Err(WebhookSignatureError::Stale);
    }
    Ok(())
}

pub fn verify_facetime_signature(
    signature: &str,
    raw_body: &[u8],
    secret: &str,
) -> Result<(), WebhookSignatureError> {
    let Some(expected) = signature
        .strip_prefix("sha256=")
        .filter(|hex| hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
        .and_then(digest)
    else {
        return Err(WebhookSignatureError::Malformed);
    };
    if !matches(secret, &[raw_body], &expected) {
        return Err(WebhookSignatureError::Mismatch);
    }
    Ok(())
}
