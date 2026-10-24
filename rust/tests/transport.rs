use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    thread,
    time::Duration,
};
use trychert_sdk::{ChertClient, HttpMethod};
fn serve(
    status: &str,
    body: &str,
    extra: &str,
    delay: Duration,
) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let wire = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
        body.len()
    );
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
            if let Some(i) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..i]).to_ascii_lowercase();
                let len = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .and_then(|s| s.parse::<usize>().ok())
                    .unwrap_or(0);
                if bytes.len() >= i + 4 + len {
                    break;
                }
            }
        }
        let _ = tx.send(String::from_utf8(bytes).unwrap());
        thread::sleep(delay);
        let _ = stream.write_all(wire.as_bytes());
    });
    (url, rx, handle)
}
fn client(url: &str) -> ChertClient {
    ChertClient::new(
        url,
        "key-exact",
        Some("tenant-a"),
        Duration::from_millis(200),
        1024,
    )
    .unwrap()
}
#[tokio::test]
async fn auth_prefix_body_and_null_are_exact() {
    for body in [
        None,
        Some(Value::Null),
        Some(json!({"phone":"+15550000001"})),
    ] {
        let (url, rx, h) = serve("200 OK", "{\"id\":\"durable\"}", "", Duration::ZERO);
        let c = client(&(url + "/deployment"));
        let result: Value = c
            .request("/send", HttpMethod::POST, body.as_ref())
            .await
            .unwrap();
        assert_eq!(result["id"], "durable");
        let request = rx.recv().unwrap();
        let lower = request.to_ascii_lowercase();
        assert!(request.starts_with("POST /deployment/send HTTP/1.1"));
        assert!(lower.contains("authorization: bearer key-exact\r\n"));
        assert!(lower.contains("x-chert-tenant: tenant-a\r\n"));
        let data = request.split_once("\r\n\r\n").unwrap().1;
        match body {
            Some(v) => {
                assert_eq!(serde_json::from_str::<Value>(data).unwrap(), v);
                assert!(lower.contains("content-type: application/json"));
            }
            None => assert!(data.is_empty()),
        }
        assert!(!format!("{c:?}").contains("key-exact"));
        h.join().unwrap();
    }
}
#[tokio::test]
async fn redirects_never_repost_to_sink() {
    let sink = TcpListener::bind("127.0.0.1:0").unwrap();
    sink.set_nonblocking(true).unwrap();
    let extra = format!("Location: http://{}/sink\r\n", sink.local_addr().unwrap());
    let (url, rx, h) = serve("307 Temporary Redirect", "{}", &extra, Duration::ZERO);
    let error = client(&url)
        .request::<Value>("/send", HttpMethod::POST, Some(&json!({})))
        .await
        .unwrap_err();
    assert_eq!(error.status, Some(307));
    rx.recv().unwrap();
    h.join().unwrap();
    assert!(sink.accept().is_err());
}
#[tokio::test]
async fn errors_are_structured_but_all_formatting_and_source_are_sanitized() {
    let raw = json!({"success":false,"error":{"code":4103,"message":"private-secret"}}).to_string();
    let (url, _, h) = serve(
        "502 Bad Gateway",
        &raw,
        "x-trace-id: private-trace\r\n",
        Duration::ZERO,
    );
    let e = client(&url)
        .request::<Value>("/send", HttpMethod::GET, None)
        .await
        .unwrap_err();
    assert_eq!(e.code, "4103");
    assert_eq!(e.request_id.as_deref(), Some("private-trace"));
    assert!(e.data.is_some());
    for text in [format!("{e}"), format!("{e:?}")] {
        assert!(!text.contains("private"));
        assert!(!text.contains("key-exact"));
    }
    assert!(std::error::Error::source(&e).is_none());
    h.join().unwrap();
}
#[tokio::test]
async fn invalid_json_no_content_bounds_and_timeout() {
    for (status, body, code) in [
        ("200 OK", "no-json", "invalid_response"),
        ("200 OK", &"x".repeat(1025), "response_too_large"),
        ("200 OK", "{}", "invalid_response_type"),
    ] {
        let (url, _, h) = serve(status, body, "", Duration::ZERO);
        assert_eq!(
            client(&url)
                .request::<u32>("/messages", HttpMethod::GET, None)
                .await
                .unwrap_err()
                .code,
            code
        );
        h.join().unwrap();
    }
    let (url, _, h) = serve("204 No Content", "", "", Duration::ZERO);
    client(&url)
        .request::<()>("/messages", HttpMethod::GET, None)
        .await
        .unwrap();
    h.join().unwrap();
    let (url, rx, h) = serve("200 OK", "{}", "", Duration::from_millis(300));
    assert_eq!(
        client(&url)
            .request::<Value>("/send", HttpMethod::POST, None)
            .await
            .unwrap_err()
            .code,
        "outcome_unknown"
    );
    rx.recv().unwrap();
    h.join().unwrap();
}
#[tokio::test]
async fn rejects_namespace_escapes_before_network() {
    let c = client("http://127.0.0.1:1/prefix");
    for path in [
        "send",
        "//other/send",
        "/../send",
        "/%2e%2e/send",
        "/a%2fb",
        "/a%5Cb",
        "/a%252fb",
        "/a\\b",
        "/a?x=1\r\n",
        "/a#x",
        "/a\n",
        "/a/./b",
    ] {
        assert_eq!(
            c.request::<Value>(path, HttpMethod::GET, None)
                .await
                .unwrap_err()
                .code,
            "invalid_path",
            "{path:?}"
        );
    }
    for base in [
        "http://public.invalid",
        "https://user:pass@example.test",
        "https://example.test?x",
        "https://example.test/#x",
        "https://example.test/../api",
        "https://example.test/%2fapi",
        "https://example.test/\na",
    ] {
        assert!(
            ChertClient::new(base, "key", None, Duration::from_secs(1), 1).is_err(),
            "{base:?}"
        );
    }
    assert!(ChertClient::new(
        "https://example.test",
        "key\n",
        None,
        Duration::from_secs(1),
        1
    )
    .is_err());
    assert!(ChertClient::new("https://example.test", "key", None, Duration::ZERO, 1).is_err());
}

#[tokio::test]
async fn dropping_wait_does_not_replay_or_expose_transport_sources() {
    let (url, rx, h) = serve("200 OK", "{}", "", Duration::from_millis(100));
    let c = client(&url);
    let result = tokio::time::timeout(
        Duration::from_millis(30),
        c.request::<Value>("/send", HttpMethod::POST, Some(&Value::Null)),
    )
    .await;
    assert!(result.is_err()); // Dropped inner future; already accepted request cannot be retracted.
    let wire = rx.recv().unwrap();
    assert_eq!(wire.matches("POST /api/v1/send HTTP/1.1").count(), 1);
    h.join().unwrap();
}

#[test]
fn ambient_proxies_cannot_redirect_credentials() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "auth_prefix_body_and_null_are_exact"])
        .env("HTTP_PROXY", "http://127.0.0.1:1")
        .env("HTTPS_PROXY", "http://127.0.0.1:1")
        .env("ALL_PROXY", "http://127.0.0.1:1")
        .env("http_proxy", "http://127.0.0.1:1")
        .env("https_proxy", "http://127.0.0.1:1")
        .env("all_proxy", "http://127.0.0.1:1")
        .env("NO_PROXY", "")
        .env("no_proxy", "")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[tokio::test]
async fn list_queries_are_preserved_and_unsafe_queries_fail_before_network() {
    let (url, rx, h) = serve("200 OK", "[]", "", Duration::ZERO);
    client(&url)
        .request::<Value>("/messages?limit=10&cursor=a%2Fb", HttpMethod::GET, None)
        .await
        .unwrap();
    assert!(rx
        .recv()
        .unwrap()
        .starts_with("GET /api/v1/messages?limit=10&cursor=a%2Fb HTTP/1.1"));
    h.join().unwrap();
    let c = client("http://127.0.0.1:1/prefix");
    for path in [
        "/messages?x=\r\n",
        "/messages?x=%0d%0a",
        "/messages?x=abc#fragment",
        "/messages?x=\\escape",
    ] {
        assert_eq!(
            c.request::<Value>(path, HttpMethod::GET, None)
                .await
                .unwrap_err()
                .code,
            "invalid_path"
        );
    }
    assert_eq!(
        c.request::<Value>(
            &format!("/messages?x={}", "a".repeat(8192)),
            HttpMethod::GET,
            None
        )
        .await
        .unwrap_err()
        .code,
        "invalid_path"
    );
}

#[tokio::test]
async fn response_shape_failures_normalize_only_successful_http_statuses() {
    for (status, body, expected) in [
        ("200 OK", "not-json", 502),
        ("400 Bad Request", "not-json", 400),
        ("200 OK", "{}", 502),
        ("204 No Content", "", 502),
    ] {
        let (url, _, h) = serve(status, body, "", Duration::ZERO);
        assert_eq!(
            client(&url)
                .request::<u32>("/messages", HttpMethod::GET, None)
                .await
                .unwrap_err()
                .status,
            Some(expected)
        );
        h.join().unwrap();
    }
}

#[tokio::test]
async fn strict_text_preserves_tuple_and_requires_exact_queue_receipt() {
    let id = "a".repeat(32);
    let reply = json!({"success":true,"message_id":id,"chat_id":"chat-a","status":"queued"});
    for key in [None, Some(" exact-key ")] {
        let (url, rx, h) = serve("202 Accepted", &reply.to_string(), "", Duration::ZERO);
        let result = client(&url)
            .send_text("+15550000002", "  exact / text 😀  ", key)
            .await
            .unwrap();
        assert!(result.success);
        assert_eq!(result.message_id, id);
        assert_eq!(result.chat_id, "chat-a");
        assert_eq!(result.status, "queued");
        assert!(!format!("{result:?}").contains(&id));
        let wire = rx.recv().unwrap();
        assert!(wire.starts_with("POST /api/v1/text-operations/v1 HTTP/1.1"));
        let body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        let mut expected = json!({"phone":"+15550000002","body":"  exact / text 😀  "});
        if let Some(key) = key {
            expected["idempotency_key"] = json!(key);
        }
        assert_eq!(body, expected);
        assert!(wire
            .to_ascii_lowercase()
            .contains("authorization: bearer key-exact\r\n"));
        h.join().unwrap();
    }
}

#[tokio::test]
async fn strict_text_wrong_status_or_receipt_remains_unknown_after_one_request() {
    let valid =
        json!({"success":true,"message_id":"a".repeat(32),"chat_id":"chat-a","status":"queued"});
    let mut cases = vec![
        ("200 OK", valid.clone()),
        ("201 Created", valid.clone()),
        ("204 No Content", Value::Null),
    ];
    for (key, value) in [
        ("success", json!(false)),
        ("status", json!("sent")),
        ("message_id", json!("550e8400-e29b-41d4-a716-446655440000")),
        ("chat_id", json!("foreign/path")),
        ("extra", json!(true)),
    ] {
        let mut row = valid.clone();
        row[key] = value;
        cases.push(("202 Accepted", row));
    }
    for (status, body) in cases {
        let (url, rx, h) = serve(
            status,
            &body.to_string(),
            "X-Request-ID: private-request\r\n",
            Duration::ZERO,
        );
        let error = client(&url)
            .send_text("+15550000002", "hello", None)
            .await
            .unwrap_err();
        assert_eq!(error.status, Some(502));
        assert!(matches!(
            error.code.as_str(),
            "unconfirmed_text_outcome" | "request_failed"
        ));
        assert_eq!(error.request_id.as_deref(), Some("private-request"));
        assert!(!format!("{error:?} {error}").contains("private-request"));
        assert!(rx
            .recv()
            .unwrap()
            .starts_with("POST /api/v1/text-operations/v1 "));
        h.join().unwrap();
    }
    let data = json!({"error":{"code":4103,"retryable":false},"message_id":"a".repeat(32),"chat_id":"chat-a"});
    let (url, rx, h) = serve("502 Bad Gateway", &data.to_string(), "", Duration::ZERO);
    let error = client(&url)
        .send_text("+15550000002", "hello", None)
        .await
        .unwrap_err();
    assert_eq!(error.code, "4103");
    assert_eq!(error.data, Some(data));
    rx.recv().unwrap();
    h.join().unwrap();
}

#[tokio::test]
async fn strict_text_invalid_input_never_connects_and_cancellation_never_resends() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let c = client(&format!("http://{}", listener.local_addr().unwrap()));
    for phone in ["+1", "15550000002", "+05550000002", "+15550000002\n"] {
        assert_eq!(
            c.send_text(phone, "hello", None).await.unwrap_err().code,
            "invalid_text_request"
        );
    }
    for text in [
        "".to_owned(),
        " ".to_owned(),
        "bad\0text".to_owned(),
        "😀".repeat(4097),
    ] {
        assert_eq!(
            c.send_text("+15550000002", &text, None)
                .await
                .unwrap_err()
                .code,
            "invalid_text_request"
        );
    }
    for key in ["".to_owned(), "bad\0key".to_owned(), "é".repeat(101)] {
        assert_eq!(
            c.send_text("+15550000002", "hello", Some(&key))
                .await
                .unwrap_err()
                .code,
            "invalid_text_request"
        );
    }
    assert!(listener.accept().is_err());
    let (url, rx, h) = serve("202 Accepted", "{}", "", Duration::from_millis(100));
    let c = client(&url);
    let task = tokio::spawn(async move { c.send_text("+15550000002", "hello", None).await });
    // Cancel after receipt, rather than assuming dispatch completes within 10ms.
    let wire = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(wire) = rx.try_recv() {
                break wire;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(wire.starts_with("POST /api/v1/text-operations/v1 "));
    h.join().unwrap();
}

#[tokio::test]
async fn strict_text_matches_cloud_whitespace_without_normalizing_valid_text() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let c = client(&format!("http://{}", listener.local_addr().unwrap()));
    for text in [
        "\u{feff}",
        "\u{2000}\u{200a}\u{202f}\u{205f}\u{3000}",
        "\t\n\u{a0}\u{2028}\u{2029}",
    ] {
        assert_eq!(
            c.send_text("+15550000002", text, None)
                .await
                .unwrap_err()
                .code,
            "invalid_text_request"
        );
    }
    assert!(listener.accept().is_err());
    let reply =
        json!({"success":true,"message_id":"a".repeat(32),"chat_id":"chat-a","status":"queued"});
    for text in ["\u{0085}", "\u{001c}", "\u{200b}"] {
        let (url, rx, h) = serve("202 Accepted", &reply.to_string(), "", Duration::ZERO);
        client(&url)
            .send_text("+15550000002", text, None)
            .await
            .unwrap();
        let wire = rx.recv().unwrap();
        let body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["body"], text);
        h.join().unwrap();
    }
}
