//! Offline loopback fixture only. One actual typed SDK call per process.
use cherthq_imessage::ChertClient;
use reqwest::Url;
use serde_json::{json, Value};
use std::{io::Read, time::Duration};
async fn run() -> Result<Value, ()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "--typed-reaction-fixture" {
        return Err(());
    }
    let url = Url::parse(&args[2]).map_err(|_| ())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none_or(|p| p == 0)
        || url.path() != "/"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.origin().ascii_serialization() != args[2]
    {
        return Err(());
    }
    let mut raw = Vec::new();
    std::io::stdin()
        .take(16385)
        .read_to_end(&mut raw)
        .map_err(|_| ())?;
    if raw.len() > 16384 {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&raw).map_err(|_| ())?;
    let object = value.as_object().ok_or(())?;
    if !(5..=6).contains(&object.len())
        || object.keys().any(|k| {
            ![
                "api_key",
                "chat_id",
                "message_id",
                "reaction",
                "remove",
                "idempotency_key",
            ]
            .contains(&k.as_str())
        })
    {
        return Err(());
    }
    let key = value.get("api_key").and_then(Value::as_str).ok_or(())?;
    let chat = value.get("chat_id").and_then(Value::as_str).ok_or(())?;
    let message = value.get("message_id").and_then(Value::as_str).ok_or(())?;
    let reaction = value.get("reaction").and_then(Value::as_str).ok_or(())?;
    let remove = value.get("remove").and_then(Value::as_bool).ok_or(())?;
    let idem = value
        .get("idempotency_key")
        .map(|v| v.as_str().ok_or(()))
        .transpose()?;
    let client =
        ChertClient::new(&args[2], key, None, Duration::from_secs(5), 32768).map_err(|_| ())?;
    match client
        .send_reaction(chat, message, reaction, remove, idem)
        .await
    {
        Ok(r) => Ok(
            json!({"operation_id":r.operation_id,"chat_id":r.chat_id,"message_id":r.message_id,"status":r.status}),
        ),
        Err(e) => {
            if e.code == "invalid_reaction_request" {
                return Err(());
            }
            let mut out = json!({"ok":false,"status":e.status,"code":if e.code=="4103"{"4103"}else{"request_failed"}});
            if let Some(data) = e.data {
                if let Some(id) = data.get("operation_id").and_then(Value::as_str) {
                    if id.len() == 32
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    {
                        out["operation_id"] = json!(id);
                    }
                }
            }
            Ok(out)
        }
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() {
    match run().await {
        Ok(value) => println!("{value}"),
        Err(()) => std::process::exit(2),
    }
}
