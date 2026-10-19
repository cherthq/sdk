use cherthq_imessage::ChertClient;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
    time::Duration,
};
const CHAT: &str = "11000000-0000-4000-8000-000000000001";
const MESSAGE: &str = "record:explicit_1";
fn server(
    status: u16,
    body: Value,
    delay: Duration,
) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buf = [0; 4096];
        loop {
            let n = stream.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buf[..n]);
            if let Some(i) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..i]).to_ascii_lowercase();
                let length = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= i + 4 + length {
                    break;
                }
            }
        }
        tx.send(String::from_utf8(bytes).unwrap()).ok();
        thread::sleep(delay);
        let body = body.to_string();
        let response=format!("HTTP/1.1 {status} Reply\r\nContent-Length: {}\r\nConnection: close\r\nx-trace-id: trace-reaction\r\n\r\n{body}",body.len());
        stream.write_all(response.as_bytes()).ok();
    });
    (url, rx, handle)
}
fn client(url: &str) -> ChertClient {
    ChertClient::new(
        url,
        "private-key",
        Some("fixture"),
        Duration::from_millis(200),
        4096,
    )
    .unwrap()
}
fn ack(message: &str) -> Value {
    json!({"operation_id":"a".repeat(32),"chat_id":CHAT,"message_id":message,"status":"acknowledged"})
}
#[tokio::test]
async fn reaction_dispatch_receipt_matches_exact_request() {
    let (url, rx, handle) = server(202, ack(MESSAGE), Duration::ZERO);
    let result = client(&url)
        .send_reaction(CHAT, MESSAGE, "love", true, Some("inside  spaces"))
        .await
        .unwrap();
    assert_eq!(result.status, "acknowledged");
    assert_eq!(result.message_id, MESSAGE);
    let request = rx.recv().unwrap();
    assert!(request.starts_with(&format!(
        "POST /api/v1/chats/{CHAT}/messages/record%3Aexplicit_1/reactions HTTP/1.1"
    )));
    let lower = request.to_ascii_lowercase();
    assert!(lower.contains("authorization: bearer private-key\r\n"));
    assert!(lower.contains("x-chert-tenant: fixture\r\n"));
    assert!(lower.contains("idempotency-key: inside  spaces\r\n"));
    assert_eq!(
        serde_json::from_str::<Value>(request.split_once("\r\n\r\n").unwrap().1).unwrap(),
        json!({"reaction":"love","remove":true,"part_index":0})
    );
    handle.join().unwrap();
}
#[tokio::test]
async fn reaction_rejects_malformed_receipts_and_wrong_http_status() {
    let mut bad = ack(MESSAGE);
    bad["operation_id"] = json!("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    let mut foreign = ack(MESSAGE);
    foreign["chat_id"] = json!("foreign");
    let mut wrong_case = ack(MESSAGE);
    wrong_case["message_id"] = json!(MESSAGE.to_ascii_uppercase());
    let mut extra = ack(MESSAGE);
    extra["native_guid"] = json!("private-native-id");
    for (status, body) in [
        (200, ack(MESSAGE)),
        (202, bad),
        (202, foreign),
        (202, wrong_case),
        (202, extra),
        (202, json!({"status":"applied"})),
    ] {
        let (url, rx, handle) = server(status, body, Duration::ZERO);
        let error = client(&url)
            .send_reaction(CHAT, MESSAGE, "like", false, None)
            .await
            .unwrap_err();
        assert_eq!(error.status, Some(502));
        assert_eq!(error.code, "unconfirmed_reaction_outcome");
        assert_eq!(error.request_id.as_deref(), Some("trace-reaction"));
        assert!(!format!("{error:?} {error}").contains("private-native-id"));
        assert!(rx.recv().unwrap().starts_with("POST "));
        handle.join().unwrap();
        assert!(rx.try_recv().is_err());
    }
}
#[tokio::test]
async fn reaction_keys_ids_and_names_are_validated_before_any_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let c = client(&format!("http://{}", listener.local_addr().unwrap()));
    for chat in [
        "chat-a",
        "11000000000040008000000000000001",
        "11000000-0000-4000-8000-00000000000z",
    ] {
        assert_eq!(
            c.send_reaction(chat, MESSAGE, "love", false, None)
                .await
                .unwrap_err()
                .code,
            "invalid_reaction_request"
        );
    }
    for id in [
        "", ".", "..", "a/b", "a%2Fb", "a?x", "a#x", "a\\b", "é", "a\n",
    ] {
        assert!(c
            .send_reaction(CHAT, id, "love", false, None)
            .await
            .is_err());
    }
    assert!(c
        .send_reaction(CHAT, &"a".repeat(161), "love", false, None)
        .await
        .is_err());
    for reaction in ["custom", "LOVE", "sticker", ""] {
        assert!(c
            .send_reaction(CHAT, MESSAGE, reaction, false, None)
            .await
            .is_err());
    }
    for key in [
        "",
        " leading",
        "trailing ",
        "line\nbreak",
        "tab\tkey",
        "é",
        "del\u{7f}",
    ] {
        assert!(c
            .send_reaction(CHAT, MESSAGE, "love", false, Some(key))
            .await
            .is_err());
    }
    assert!(c
        .send_reaction(CHAT, MESSAGE, "love", false, Some(&"a".repeat(201)))
        .await
        .is_err());
    assert!(listener.accept().is_err());
}
#[tokio::test]
async fn reaction_canonicalizes_only_chat_uuid_and_never_invents_a_key() {
    let chat = "A1000000-0000-4000-8000-000000000001";
    let message = "Case.Exact-ID";
    let mut body = ack(message);
    body["chat_id"] = json!(chat.to_ascii_lowercase());
    let (url, rx, handle) = server(202, body, Duration::ZERO);
    let result = client(&url)
        .send_reaction(chat, message, "question", false, None)
        .await
        .unwrap();
    assert_eq!(result.chat_id, chat.to_ascii_lowercase());
    assert_eq!(result.message_id, message);
    let request = rx.recv().unwrap();
    assert!(request.starts_with(&format!(
        "POST /api/v1/chats/{}/messages/{message}/reactions ",
        chat.to_ascii_lowercase()
    )));
    assert!(!request.to_ascii_lowercase().contains("idempotency-key:"));
    handle.join().unwrap();
}
#[tokio::test]
async fn reaction_preserves_structured_unknown_error_without_resending() {
    let body = json!({"success":false,"operation_id":"b".repeat(32),"error":{"code":4103,"message":"private receiver error","retryable":false}});
    let (url, rx, handle) = server(502, body.clone(), Duration::ZERO);
    let error = client(&url)
        .send_reaction(CHAT, MESSAGE, "emphasize", false, None)
        .await
        .unwrap_err();
    assert_eq!(error.code, "4103");
    assert_eq!(error.data, Some(body));
    assert!(!format!("{error:?} {error}").contains("private receiver error"));
    rx.recv().unwrap();
    handle.join().unwrap();
    assert!(rx.try_recv().is_err());
}
#[tokio::test]
async fn dropping_reaction_future_does_not_retry_or_undo_received_request() {
    let (url, rx, handle) = server(202, ack(MESSAGE), Duration::from_millis(100));
    let c = client(&url);
    assert!(tokio::time::timeout(
        Duration::from_millis(20),
        c.send_reaction(CHAT, MESSAGE, "laugh", false, None)
    )
    .await
    .is_err());
    assert!(rx.recv().unwrap().starts_with("POST "));
    handle.join().unwrap();
    assert!(rx.try_recv().is_err());
}
