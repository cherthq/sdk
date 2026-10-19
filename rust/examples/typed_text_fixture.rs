//! Offline integration helper: one typed request to a literal loopback fixture only.
use cherthq_imessage::ChertClient;
use reqwest::Url;
use serde_json::{json, Value};
use std::{io::Read, time::Duration};

async fn run() -> Result<Value, ()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 || args[1] != "--typed-text-fixture" {
        return Err(());
    }
    let url = Url::parse(&args[2]).map_err(|_| ())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none_or(|port| port == 0)
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
        .take(131073)
        .read_to_end(&mut raw)
        .map_err(|_| ())?;
    if raw.len() > 131072 {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&raw).map_err(|_| ())?;
    let object = value.as_object().ok_or(())?;
    if !(3..=4).contains(&object.len())
        || object
            .keys()
            .any(|key| !["api_key", "phone", "text", "idempotency_key"].contains(&key.as_str()))
    {
        return Err(());
    }
    let key = value.get("api_key").and_then(Value::as_str).ok_or(())?;
    let phone = value.get("phone").and_then(Value::as_str).ok_or(())?;
    let text = value.get("text").and_then(Value::as_str).ok_or(())?;
    if phone != "+15550000002" || !text.starts_with("CHERT-TYPED-TEXT-") {
        return Err(());
    }
    let idempotency = value
        .get("idempotency_key")
        .map(|key| key.as_str().ok_or(()))
        .transpose()?;
    let client =
        ChertClient::new(&args[2], key, None, Duration::from_secs(15), 32768).map_err(|_| ())?;
    match client.send_text(phone, text, idempotency).await {
        Ok(receipt) => Ok(
            json!({"success":receipt.success,"message_id":receipt.message_id,
            "chat_id":receipt.chat_id,"status":receipt.status}),
        ),
        Err(error) => {
            let mut output = json!({"ok":false,"status":error.status,
                "code":if error.code == "4103" {"4103"} else {"request_failed"}});
            if error.code == "4103" {
                if let Some(data) = error.data {
                    let id = data.get("message_id").and_then(Value::as_str).unwrap_or("");
                    let chat = data.get("chat_id").and_then(Value::as_str).unwrap_or("");
                    if id.len() == 32
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                        && !chat.is_empty()
                        && chat.len() <= 160
                        && chat
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b":_-".contains(&b))
                    {
                        output["message_id"] = json!(id);
                        output["chat_id"] = json!(chat);
                    }
                }
            }
            Ok(output)
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    match run().await {
        Ok(result) => println!("{result}"),
        Err(()) => std::process::exit(2),
    }
}
