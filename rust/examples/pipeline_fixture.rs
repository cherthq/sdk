//! Guarded test-only pipeline CLI. This does not authorize a physical send.
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    process::ExitCode,
    time::Duration,
};
use trychert_sdk::{ChertClient, HttpMethod};

fn valid_origin(origin: &str) -> bool {
    let Some(port) = origin.strip_prefix("http://127.0.0.1:") else {
        return false;
    };
    !port.is_empty()
        && port.bytes().all(|b| b.is_ascii_digit())
        && port
            .parse::<u16>()
            .is_ok_and(|p| p != 0 && p.to_string() == port)
}
fn valid_body(body: &Value) -> bool {
    let Some(object) = body.as_object() else {
        return false;
    };
    if object.len() != 2 {
        return false;
    }
    let (Some(phone), Some(marker)) = (
        object.get("phone").and_then(Value::as_str),
        object.get("body").and_then(Value::as_str),
    ) else {
        return false;
    };
    let Some(digits) = phone.strip_prefix('+') else {
        return false;
    };
    if !(7..=15).contains(&digits.len())
        || digits.starts_with('0')
        || !digits.bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let Some(uuid) = marker
        .strip_prefix("CHERT-M4D-PIPELINE-")
        .and_then(|s| s.strip_suffix("-rust"))
    else {
        return false;
    };
    uuid.len() == 36
        && uuid.as_bytes()[14] == b'4'
        && matches!(uuid.as_bytes()[19], b'8' | b'9' | b'a' | b'b')
        && uuid.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "--one-reviewed-pipeline-send" || !valid_origin(&args[2]) {
        return invalid();
    }
    let mut bytes = Vec::new();
    if io::stdin().take(16385).read_to_end(&mut bytes).is_err() || bytes.len() > 16384 {
        return invalid();
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes) else {
        return invalid();
    };
    if !valid_body(&body) {
        return invalid();
    }
    let Ok(client) = ChertClient::new(
        &args[2],
        "fixture-local-key",
        None,
        Duration::from_secs(45),
        1024 * 1024,
    ) else {
        return invalid();
    };
    let output = match client
        .request::<Value>("/send", HttpMethod::POST, Some(&body))
        .await
    {
        Ok(data) => json!({"ok":true,"data":data}),
        Err(error) => {
            json!({"ok":false,"status":error.status,"code":error.code,"display":error.to_string()})
        }
    };
    println!("{output}");
    ExitCode::SUCCESS
}
fn invalid() -> ExitCode {
    eprintln!("invalid guarded pipeline fixture input");
    ExitCode::FAILURE
}

#[cfg(test)]
mod tests {
    use super::*;
    fn body() -> Value {
        json!({"phone":"+15550000001","body":"CHERT-M4D-PIPELINE-12345678-1234-4234-8234-123456789abc-rust"})
    }
    #[test]
    fn origin_is_literal_loopback_with_canonical_port_only() {
        assert!(valid_origin("http://127.0.0.1:1234"));
        for origin in [
            "http://localhost:1234",
            "https://127.0.0.1:1234",
            "http://127.0.0.1:0",
            "http://127.0.0.1:0123",
            "http://127.0.0.1:1234/",
            "http://127.0.0.1:1234?x",
            "http://127.0.0.1:1234@foreign",
        ] {
            assert!(!valid_origin(origin));
        }
    }
    #[test]
    fn schema_and_provider_marker_are_exact() {
        assert!(valid_body(&body()));
        for invalid in [
            json!({"phone":"+15550000001","body":"CHERT-M4D-PIPELINE-12345678-1234-4234-8234-123456789abc-linq"}),
            json!({"phone":"15550000001","body":body()["body"]}),
            json!({"phone":"+15550000001","body":body()["body"],"from":"+15550000002"}),
            json!({"phone":"+15550000001","body":"CHERT-M4D-PIPELINE-12345678-1234-1234-8234-123456789abc-rust"}),
            Value::Null,
        ] {
            assert!(!valid_body(&invalid));
        }
    }
}
