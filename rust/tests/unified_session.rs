use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    ops::ControlFlow,
    sync::mpsc,
    thread,
};
use trychert_sdk::{ChertSdk, HttpMethod, UnifiedSessionOptions};

const PROJECT: &str = "00000000-0000-4000-8000-000000000001";
fn token() -> String {
    format!("chu_{}", "a".repeat(43))
}
fn listen() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    (listener, url)
}
fn descriptor(im: &str, ft: &str) -> Value {
    json!({"data":{"contract":"chert-unified","contract_version":1,
        "auth":{"scheme":"Bearer","token_prefix":"chu_","audience":"chert.unified-api:v1",
            "login_url":format!("{ft}/api/v1/cli/logins")},
        "services":{"imessage":{"base_url":format!("{im}/api/v1")},"facetime":{"base_url":format!("{ft}/api/v1")}},
        "scopes":["imessage:events:read","imessage:webhooks:manage","imessage:messages:send",
            "facetime:calls:read","facetime:calls:create","facetime:calls:control"]}})
}
fn reply(status: &str, headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
        body.len()
    )
}
fn serve(
    listener: TcpListener,
    replies: Vec<String>,
) -> (mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let (tx, rx) = mpsc::channel();
    let h = thread::spawn(move || {
        for reply in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0; 1024];
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            tx.send(String::from_utf8(bytes).unwrap()).unwrap();
            let _ = stream.write_all(reply.as_bytes());
        }
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err());
    });
    (rx, h)
}
fn options<'a>(token: &'a str, im: &'a str, ft: &'a str) -> UnifiedSessionOptions<'a> {
    UnifiedSessionOptions {
        imessage_base_url: im,
        facetime_base_url: ft,
        ..UnifiedSessionOptions::new(token, PROJECT)
    }
}
fn discovery(wire: String) {
    assert!(wire.starts_with("GET /api/v1/sdk/capabilities HTTP/1.1"));
    let lower = wire.to_lowercase();
    for forbidden in [
        "authorization:",
        "x-chert-tenant:",
        "x-chert-project-id:",
        "x-chert-contract:",
        "chu_",
    ] {
        assert!(!lower.contains(forbidden), "{forbidden}");
    }
}
fn authenticated(wire: String, token: &str, project: bool) {
    let lower = wire.to_lowercase();
    assert!(lower.contains(&format!("authorization: bearer {token}\r\n")));
    assert!(lower.contains("x-chert-contract: chert-unified-v1\r\n"));
    assert!(!lower.contains("x-chert-tenant:"));
    assert_eq!(
        lower.contains(&format!("x-chert-project-id: {PROJECT}\r\n")),
        project
    );
}

#[tokio::test]
async fn unauthenticated_discovery_then_same_session_on_both_channels_and_sse() {
    let (im_listener, im) = listen();
    let (ft_listener, ft) = listen();
    let headers = "X-Chert-Contract: chert-unified-v1\r\n";
    let (im_rx, im_h) = serve(
        im_listener,
        vec![
            reply("200 OK", "", &descriptor(&im, &ft).to_string()),
            reply(
                "200 OK",
                headers,
                "{\"events\":[],\"count\":0,\"next_cursor\":null}",
            ),
            reply(
                "200 OK",
                &format!("{headers}Content-Type: text/event-stream\r\n"),
                "data: {}\n\n",
            ),
        ],
    );
    let (ft_rx, ft_h) = serve(
        ft_listener,
        vec![reply(
            "200 OK",
            headers,
            "{\"data\":{},\"request_id\":\"r\"}",
        )],
    );
    let token = token();
    let sdk = ChertSdk::connect(options(&token, &im, &ft)).await.unwrap();
    let messaging = sdk.imessage.unwrap();
    messaging.list_events(&Default::default()).await.unwrap();
    sdk.facetime
        .unwrap()
        .request::<Value>("/calls", HttpMethod::GET, None, None)
        .await
        .unwrap();
    let mut count = 0;
    messaging
        .stream_events(None, |_| {
            count += 1;
            ControlFlow::Continue(())
        })
        .await
        .unwrap();
    assert_eq!(count, 1);
    discovery(im_rx.recv().unwrap());
    authenticated(im_rx.recv().unwrap(), &token, false);
    authenticated(im_rx.recv().unwrap(), &token, false);
    authenticated(ft_rx.recv().unwrap(), &token, true);
    im_h.join().unwrap();
    ft_h.join().unwrap();
}

#[tokio::test]
async fn old_malformed_oversize_or_untrusted_descriptors_never_receive_credentials() {
    for case in 0..13 {
        let (listener, im) = listen();
        let (sink, ft) = listen();
        sink.set_nonblocking(true).unwrap();
        let mut data = descriptor(&im, &ft);
        match case {
            0 => {} // old backend 404
            1 => data["data"]["contract"] = json!("other"),
            2 => data["data"]["contract_version"] = json!(2),
            3 => data["data"]["auth"]["scheme"] = json!("Basic"),
            4 => data["data"]["auth"]["token_prefix"] = json!("old_"),
            5 => data["data"]["auth"]["audience"] = json!("other"),
            6 => {
                data["data"]["auth"]["login_url"] =
                    json!("https://foreign.invalid/api/v1/cli/logins")
            }
            7 => {
                data["data"]["services"]["imessage"]["base_url"] =
                    json!("https://foreign.invalid/api/v1")
            }
            8 => {
                data["data"]["services"]["facetime"]["base_url"] =
                    json!("https://foreign.invalid/api/v1")
            }
            9 => data["data"]["scopes"] = json!([]),
            10 => data = json!({}),
            _ => {}
        }
        let body = match case {
            11 => "not json".into(),
            12 => "x".repeat(65_537),
            _ => data.to_string(),
        };
        let (rx, h) = serve(
            listener,
            vec![reply(
                if case == 0 { "404 Not Found" } else { "200 OK" },
                "",
                &body,
            )],
        );
        let error = ChertSdk::connect(options(&token(), &im, &ft))
            .await
            .unwrap_err();
        assert_eq!(error.code, "unsupported_unified_backend", "case={case}");
        discovery(rx.recv().unwrap());
        h.join().unwrap();
        assert!(sink.accept().is_err());
    }
}

#[tokio::test]
async fn every_json_and_sse_response_requires_exact_echo_before_consumption() {
    for echo in [
        "",
        "X-Chert-Contract: wrong\r\n",
        "X-Chert-Contract: chert-unified-v1\r\nX-Chert-Contract: wrong\r\n",
    ] {
        let (listener, origin) = listen();
        let (rx, h) = serve(
            listener,
            vec![
                reply("200 OK", "", &descriptor(&origin, &origin).to_string()),
                reply("200 OK", echo, "not-json"),
                reply("404 Not Found", echo, "not-json"),
                reply(
                    "200 OK",
                    &format!("{echo}Content-Type: text/event-stream\r\n"),
                    "data: {}\n\n",
                ),
            ],
        );
        let token = token();
        let sdk = ChertSdk::connect(options(&token, &origin, &origin))
            .await
            .unwrap();
        let im = sdk.imessage.unwrap();
        assert_eq!(
            im.request::<Value>("/events", HttpMethod::GET, None)
                .await
                .unwrap_err()
                .code,
            "unsupported_unified_backend"
        );
        assert_eq!(
            sdk.facetime
                .unwrap()
                .request::<Value>("/calls", HttpMethod::GET, None, None)
                .await
                .unwrap_err()
                .code,
            "unsupported_unified_backend"
        );
        let mut callbacks = 0;
        assert_eq!(
            im.stream_events(None, |_| {
                callbacks += 1;
                ControlFlow::Continue(())
            })
            .await
            .unwrap_err()
            .code,
            "unsupported_unified_backend"
        );
        assert_eq!(callbacks, 0);
        discovery(rx.recv().unwrap());
        authenticated(rx.recv().unwrap(), &token, false);
        authenticated(rx.recv().unwrap(), &token, true);
        authenticated(rx.recv().unwrap(), &token, false);
        h.join().unwrap();
    }
}

#[tokio::test]
async fn discovery_redirects_and_each_missing_scope_fail_closed() {
    for missing in 0..7 {
        let (listener, im) = listen();
        let (sink, ft) = listen();
        sink.set_nonblocking(true).unwrap();
        let mut data = descriptor(&im, &ft);
        if missing < 6 {
            data["data"]["scopes"]
                .as_array_mut()
                .unwrap()
                .remove(missing);
        }
        let (rx, h) = serve(
            listener,
            vec![reply(
                if missing == 6 {
                    "307 Temporary Redirect"
                } else {
                    "200 OK"
                },
                &format!("Location: {ft}/sink\r\n"),
                &data.to_string(),
            )],
        );
        assert_eq!(
            ChertSdk::connect(options(&token(), &im, &ft))
                .await
                .unwrap_err()
                .code,
            "unsupported_unified_backend"
        );
        discovery(rx.recv().unwrap());
        h.join().unwrap();
        assert!(sink.accept().is_err());
    }
}

#[tokio::test]
async fn unified_send_keeps_strict_route_body_receipt_and_allows_extra_scope() {
    for (status, valid) in [("202 Accepted", true), ("200 OK", false)] {
        let (listener, origin) = listen();
        let mut capabilities = descriptor(&origin, &origin);
        capabilities["data"]["scopes"]
            .as_array_mut()
            .unwrap()
            .push(json!("future:read"));
        let receipt = json!({"success":true,"message_id":"a".repeat(32),"chat_id":"chat-a","status":"queued"});
        let (rx, h) = serve(
            listener,
            vec![
                reply("200 OK", "", &capabilities.to_string()),
                reply(
                    status,
                    "X-Chert-Contract: chert-unified-v1\r\n",
                    &receipt.to_string(),
                ),
            ],
        );
        let token = token();
        let sdk = ChertSdk::connect(options(&token, &origin, &origin))
            .await
            .unwrap();
        let result = sdk
            .imessage
            .unwrap()
            .send_text("+15550000001", "hello", Some("caller-key"))
            .await;
        if valid {
            let result = result.unwrap();
            assert_eq!(result.status, "queued");
            assert_eq!(result.message_id, "a".repeat(32));
        } else {
            assert_eq!(result.unwrap_err().code, "unconfirmed_text_outcome");
        }
        discovery(rx.recv().unwrap());
        let wire = rx.recv().unwrap();
        assert!(wire.starts_with("POST /api/v1/text-operations/v1 HTTP/1.1"));
        let body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(
            body,
            json!({"phone":"+15550000001","body":"hello","idempotency_key":"caller-key"})
        );
        authenticated(wire, &token, false);
        h.join().unwrap();
    }
}

#[tokio::test]
async fn discovery_rejects_non_string_and_duplicate_scopes() {
    for extra in [
        json!(42),
        Value::Null,
        json!({}),
        json!(true),
        json!("imessage:messages:send"),
    ] {
        let (listener, origin) = listen();
        let mut capabilities = descriptor(&origin, &origin);
        capabilities["data"]["scopes"]
            .as_array_mut()
            .unwrap()
            .push(extra);
        let (rx, h) = serve(
            listener,
            vec![reply("200 OK", "", &capabilities.to_string())],
        );
        assert_eq!(
            ChertSdk::connect(options(&token(), &origin, &origin))
                .await
                .unwrap_err()
                .code,
            "unsupported_unified_backend"
        );
        discovery(rx.recv().unwrap());
        h.join().unwrap();
    }
}

#[tokio::test]
async fn unified_non_root_overrides_reject_before_any_request() {
    let (listener, origin) = listen();
    listener.set_nonblocking(true).unwrap();
    let token = token();
    for suffix in ["/deployment", "/api/v1", "/deployment/"] {
        let invalid = format!("{origin}{suffix}");
        for (im, ft) in [(&invalid, &origin), (&origin, &invalid)] {
            assert_eq!(
                ChertSdk::connect(options(&token, im, ft))
                    .await
                    .unwrap_err()
                    .code,
                "invalid_configuration"
            );
        }
        // The root-only policy is scoped to connect, not legacy transports.
        assert!(trychert_sdk::ChertClient::new(
            &invalid,
            "legacy-key",
            None,
            std::time::Duration::from_secs(1),
            1024
        )
        .is_ok());
    }
    assert!(listener.accept().is_err());
}

#[tokio::test]
async fn discovery_honors_shorter_caller_timeout_for_headers_and_body() {
    for delay_body in [false, true] {
        let (listener, origin) = listen();
        let body = descriptor(&origin, &origin).to_string();
        let (tx, rx) = mpsc::channel();
        let h = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            while !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                let mut buffer = [0; 1024];
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            tx.send(String::from_utf8(bytes).unwrap()).unwrap();
            if delay_body {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
            }
            thread::sleep(std::time::Duration::from_millis(500));
            let wire = if delay_body {
                body
            } else {
                reply("200 OK", "", &body)
            };
            let _ = stream.write_all(wire.as_bytes());
        });
        let token = token();
        let mut input = options(&token, &origin, &origin);
        input.limits.timeout = std::time::Duration::from_millis(50);
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(400),
            ChertSdk::connect(input),
        )
        .await;
        assert_eq!(
            result
                .expect("caller deadline must beat delayed response")
                .unwrap_err()
                .code,
            "unsupported_unified_backend"
        );
        discovery(rx.recv().unwrap());
        h.join().unwrap();
    }
}

#[tokio::test]
async fn invalid_sessions_fail_before_discovery() {
    let (listener, origin) = listen();
    listener.set_nonblocking(true).unwrap();
    for token in [
        "old-token".to_owned(),
        format!("chu_{}", "a".repeat(42)),
        format!("chu_{}!", "a".repeat(42)),
    ] {
        assert_eq!(
            ChertSdk::connect(options(&token, &origin, &origin))
                .await
                .unwrap_err()
                .code,
            "invalid_unified_session"
        );
    }
    let token = token();
    let mut input = options(&token, &origin, &origin);
    input.project_id = "not-uuid";
    assert_eq!(
        ChertSdk::connect(input).await.unwrap_err().code,
        "invalid_unified_session"
    );
    assert!(listener.accept().is_err());
}
