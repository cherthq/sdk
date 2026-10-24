use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};
use trychert_sdk::{
    facetime::*, ChertSdk, FaceTimeConfig, HttpMethod, IMessageConfig, TransportLimits,
};

// Synthetic API responses are independent of SDK serializers.
fn call() -> Value {
    json!({"id":"call-1","project_id":"project-ft","direction":"outbound",
        "mode":"managed","status":"queued","media":{"audio":true,"video":false},
        "line_id":"line-2","assistant_id":"assistant-3","terminal_reason":null,
        "started_at":null,"duration_seconds":null,"facetime_call_events":[]})
}
fn assistant() -> Value {
    json!({"id":"assistant-3","project_id":"project-ft","name":"Synthetic assistant",
        "status":"draft","draft_revision":7,"draft_config":{"schema_version":1},"active_version_id":null})
}
fn line() -> Value {
    json!({"id":"line-2","display_name":"Synthetic line","status":"active",
        "supports_audio":true,"supports_video":false,"default_assistant_id":null})
}
fn envelope(data: Value) -> Value {
    json!({"data":data,"request_id":"request-body-4"})
}
fn server(
    status: u16,
    body: String,
    headers: &str,
    delay: Duration,
) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len());
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(2))
                }
                Err(e) => panic!("fixture accept failed: {e}"),
            }
        };
        // Darwin inherits O_NONBLOCK from the listening socket.
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0u8; 4096];
            let n = stream.read(&mut chunk).unwrap();
            assert!(n > 0, "request ended before its declared body");
            bytes.extend_from_slice(&chunk[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                let size: usize = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .unwrap_or("0")
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + size {
                    break;
                }
            }
        }
        thread::sleep(delay);
        let _ = stream.write_all(response.as_bytes());
        drop(stream);
        thread::sleep(Duration::from_millis(20));
        assert!(
            listener.accept().is_err(),
            "SDK retried a single-attempt request"
        );
        String::from_utf8(bytes).unwrap()
    });
    (url, handle)
}
fn ok(status: u16, data: Value) -> (String, thread::JoinHandle<String>) {
    server(status, envelope(data).to_string(), "", Duration::ZERO)
}
fn config(url: &str) -> FaceTimeConfig<'_> {
    FaceTimeConfig {
        base_url: url,
        api_key: "ftk_synthetic-only",
        project_id: "project-ft",
        limits: TransportLimits::default(),
    }
}
fn client(url: &str) -> FaceTimeClient {
    FaceTimeClient::new(config(url)).unwrap()
}
fn body(wire: &str) -> Value {
    serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap()
}
fn assert_wire(wire: &str, method: &str, path: &str) {
    assert!(
        wire.starts_with(&format!("{method} {path} HTTP/1.1\r\n")),
        "{wire}"
    );
    let headers = wire.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase();
    assert!(headers.contains("authorization: bearer ftk_synthetic-only\r\n"));
    assert!(headers.contains("x-chert-project-id: project-ft"));
    assert!(!headers.contains("x-chert-tenant"));
}
fn create() -> CreateCall {
    CreateCall {
        line_id: "line-2".into(),
        execution: CallExecution::Managed {
            assistant_id: "assistant-3".into(),
        },
        target: CallTarget::Destination {
            destination: "+15550000001".into(),
            destination_type: DestinationType::Phone,
        },
        media: Media {
            audio: true,
            video: false,
        },
    }
}

#[test]
fn official_defaults_require_no_url_and_invalid_overrides_never_fall_back() {
    let im = IMessageConfig::new("im-secret");
    let ft = FaceTimeConfig::new("ft-secret", "project-ft");
    assert_eq!(im.base_url, "https://console.trychert.com");
    assert_eq!(ft.base_url, "https://facetime.trychert.com");
    assert!(ChertSdk::new(Some(im), Some(ft)).is_ok());
    for base_url in [
        "",
        " ",
        "not-a-url",
        "http://remote.test",
        "https://user@host.test",
        "https://host.test?query=1",
    ] {
        let im = IMessageConfig {
            base_url,
            ..IMessageConfig::new("im-secret")
        };
        let ft = FaceTimeConfig {
            base_url,
            ..FaceTimeConfig::new("ft-secret", "project-ft")
        };
        assert_eq!(
            ChertSdk::new(Some(im), None).unwrap_err().code,
            "invalid_configuration"
        );
        assert_eq!(
            ChertSdk::new(None, Some(ft)).unwrap_err().code,
            "invalid_configuration"
        );
    }
}

#[tokio::test]
async fn explicit_overrides_preserve_prefixes_and_channel_credentials() {
    for (suffix, prefix) in [
        ("", "/api/v1"),
        ("/", "/api/v1"),
        ("/api/v1", "/api/v1"),
        ("/api/v1/", "/api/v1"),
        ("/custom/v2/", "/custom/v2"),
    ] {
        let (im, im_wire) = server(200, "{}".into(), "", Duration::ZERO);
        let (ft, ft_wire) = ok(200, call());
        let im_base = format!("{im}{suffix}");
        let ft_base = format!("{ft}{suffix}");
        let sdk = ChertSdk::new(
            Some(IMessageConfig {
                base_url: &im_base,
                tenant: Some("tenant-im"),
                ..IMessageConfig::new("im-secret")
            }),
            Some(FaceTimeConfig {
                base_url: &ft_base,
                ..FaceTimeConfig::new("ft-secret", "project-ft")
            }),
        )
        .unwrap();
        let _: Value = sdk
            .imessage
            .unwrap()
            .request("/whoami", HttpMethod::GET, None)
            .await
            .unwrap();
        sdk.facetime.unwrap().get_call("call-1").await.unwrap();
        let im_wire = im_wire.join().unwrap().to_ascii_lowercase();
        let ft_wire = ft_wire.join().unwrap().to_ascii_lowercase();
        assert!(im_wire.starts_with(&format!("get {prefix}/whoami http/1.1\r\n")));
        assert!(ft_wire.starts_with(&format!("get {prefix}/calls/call-1 http/1.1\r\n")));
        assert!(im_wire.contains("authorization: bearer im-secret\r\n"));
        assert!(im_wire.contains("x-chert-tenant: tenant-im\r\n"));
        assert!(!im_wire.contains("ft-secret") && !im_wire.contains("x-chert-project-id"));
        assert!(ft_wire.contains("authorization: bearer ft-secret\r\n"));
        assert!(ft_wire.contains("x-chert-project-id: project-ft\r\n"));
        assert!(!ft_wire.contains("im-secret") && !ft_wire.contains("x-chert-tenant"));
    }
}

#[tokio::test]
async fn independent_channels_send_only_their_own_credentials_and_scope() {
    let (im, im_wire) = server(202, json!({"success":true,"message_id":"0123456789abcdef0123456789abcdef","chat_id":"chat-1","status":"queued"}).to_string(), "", Duration::ZERO);
    let (ft, ft_wire) = ok(200, call());
    let sdk = ChertSdk::new(
        Some(IMessageConfig {
            base_url: &im,
            api_key: "im-secret",
            tenant: Some("im-tenant"),
            limits: TransportLimits::default(),
        }),
        Some(config(&ft)),
    )
    .unwrap();
    sdk.imessage
        .as_ref()
        .unwrap()
        .send_text("+15550000001", "hello", None)
        .await
        .unwrap();
    let response = sdk
        .facetime
        .as_ref()
        .unwrap()
        .get_call("call-1")
        .await
        .unwrap();
    assert_eq!(response.request_id, "request-body-4");
    assert_eq!(response.data.extra["started_at"], Value::Null);
    let im_wire = im_wire.join().unwrap();
    assert!(im_wire.contains("Bearer im-secret"));
    assert!(im_wire.contains("x-chert-tenant: im-tenant"));
    assert!(
        !im_wire.contains("project-ft")
            && !im_wire.contains("ftk_")
            && !im_wire.contains("x-chert-project")
    );
    let ft_wire = ft_wire.join().unwrap();
    assert_wire(&ft_wire, "GET", "/api/v1/calls/call-1");
    assert!(!ft_wire.contains("im-secret") && !ft_wire.contains("im-tenant"));
    assert!(!format!("{sdk:?}").contains("secret"));
}

#[tokio::test]
async fn creates_managed_byor_and_group_calls_with_exact_keys_and_bodies() {
    for variant in 0..3 {
        let (url, wire) = ok(201, call());
        let mut input = create();
        let mut expected = json!({"direction":"outbound","mode":"managed","line_id":"line-2",
            "assistant_id":"assistant-3","destination":"+15550000001","destination_type":"phone",
            "media":{"audio":true,"video":false}});
        if variant > 0 {
            input.execution = CallExecution::CustomerManaged {
                room: RoomCredentials {
                    livekit_url: "wss://room.example.test".into(),
                    participant_token: "synthetic-private-token".into(),
                    remote_participant_identity: "remote-7".into(),
                },
            };
            input.media.video = true;
            expected.as_object_mut().unwrap().remove("assistant_id");
            expected["mode"] = json!("customer_managed");
            expected["livekit_url"] = json!("wss://room.example.test");
            expected["participant_token"] = json!("synthetic-private-token");
            expected["remote_participant_identity"] = json!("remote-7");
            expected["media"]["video"] = json!(true);
        }
        if variant == 2 {
            input.target = CallTarget::Group {
                recipients: vec![
                    Recipient::Email("a@example.test".into()),
                    Recipient::PhoneNumber("+15550000002".into()),
                ],
            };
            expected.as_object_mut().unwrap().remove("destination");
            expected.as_object_mut().unwrap().remove("destination_type");
            expected["recipients"] = json!([{"type":"email","value":"a@example.test"},{"type":"phone_number","value":"+15550000002"}]);
        }
        let response = client(&url)
            .create_call(&input, "stable key-9")
            .await
            .unwrap();
        assert_eq!(response.data.status, "queued");
        let wire = wire.join().unwrap();
        assert_wire(&wire, "POST", "/api/v1/calls");
        assert!(wire.contains("idempotency-key: stable key-9\r\n"));
        assert_eq!(body(&wire), expected);
        assert!(!format!("{input:?}").contains("private-token"));
    }
}

#[tokio::test]
async fn all_actions_require_202_and_keep_caller_key() {
    for (action, name) in [
        (CallAction::Answer, "answer"),
        (CallAction::Reject, "reject"),
        (CallAction::End, "end"),
    ] {
        let (url, wire) = ok(202, call());
        client(&url)
            .call_action("call-1", action, Some("caller reason"), "action-key")
            .await
            .unwrap();
        let wire = wire.join().unwrap();
        assert_wire(&wire, "POST", &format!("/api/v1/calls/call-1/{name}"));
        assert_eq!(body(&wire), json!({"reason":"caller reason"}));
        assert!(wire.contains("idempotency-key: action-key\r\n"));
    }
    for status in [200, 201, 204, 206] {
        let (url, wire) = ok(status, call());
        let error = client(&url)
            .call_action("call-1", CallAction::End, None, "action-key")
            .await
            .unwrap_err();
        assert_eq!(error.code, "unconfirmed_facetime_outcome");
        wire.join().unwrap();
    }
}

#[tokio::test]
async fn reads_match_server_envelopes_pagination_and_normalized_event_shape() {
    for resource in ["calls", "lines", "assistants"] {
        let item = match resource {
            "calls" => call(),
            "lines" => line(),
            _ => assistant(),
        };
        let (url, wire) = ok(200, json!({"items":[item],"total":29,"limit":3,"offset":7}));
        let c = client(&(url + "/deployment/v2"));
        match resource {
            "calls" => {
                let r = c.list_calls(3, 7).await.unwrap();
                assert_eq!(
                    (r.data.total, r.data.offset, r.data.items[0].id.as_str()),
                    (29, 7, "call-1")
                );
            }
            "lines" => {
                let r = c.list_lines(3, 7).await.unwrap();
                assert!(r.data.items[0].supports_audio);
                assert!(!r.data.items[0].supports_video);
            }
            _ => {
                let r = c.list_assistants(3, 7).await.unwrap();
                assert_eq!(r.data.items[0].draft_revision, 7);
            }
        }
        assert_wire(
            &wire.join().unwrap(),
            "GET",
            &format!("/deployment/v2/{resource}?limit=3&offset=7"),
        );
    }
    let (url, wire) = ok(
        200,
        json!({"call_id":"call-1","events":[{"id":"event-9","type":"unknown","at":"2026-10-23T00:00:00Z","sequence":null,"source":"worker"}]}),
    );
    let r = client(&url).call_events("call-1").await.unwrap();
    assert_eq!(r.data.events[0].event_type, "unknown");
    assert_eq!(r.data.events[0].sequence, None);
    assert_wire(&wire.join().unwrap(), "GET", "/api/v1/calls/call-1/events");
    let (url, wire) = ok(
        200,
        json!({"call_id":"call-1","schema_version":1,"created_at":"2026-10-23T00:00:00Z","turns":[{"occurred_at":"2026-10-22T23:59:59Z","speaker":"caller","text":"private transcript"}]}),
    );
    let r = client(&url).transcript("call-1").await.unwrap();
    assert_eq!(r.data.turns[0].text, "private transcript");
    assert!(!format!("{r:?}").contains("private transcript"));
    assert_wire(
        &wire.join().unwrap(),
        "GET",
        "/api/v1/calls/call-1/transcript",
    );
}

#[tokio::test]
async fn assistant_and_line_updates_distinguish_omission_from_null() {
    let (url, wire) = ok(200, assistant());
    client(&url)
        .update_assistant(
            "assistant-3",
            &UpdateAssistant {
                expected_draft_revision: 7,
                name: None,
                description: Some(None),
                status: Some(AssistantStatus::Paused),
                draft_config: None,
            },
        )
        .await
        .unwrap();
    let wire = wire.join().unwrap();
    assert_wire(&wire, "PATCH", "/api/v1/assistants/assistant-3");
    assert_eq!(
        body(&wire),
        json!({"expected_draft_revision":7,"description":null,"status":"paused"})
    );
    let (url, wire) = ok(200, line());
    client(&url)
        .update_line(
            "line-2",
            &UpdateLine {
                default_assistant_id: Some(None),
                inbound_policy: Some(InboundPolicy::CustomerDecides),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let wire = wire.join().unwrap();
    assert_wire(&wire, "PATCH", "/api/v1/lines/line-2");
    assert_eq!(
        body(&wire),
        json!({"default_assistant_id":null,"inbound_policy":"customer_decides"})
    );
}

#[tokio::test]
async fn assistant_creation_read_publish_and_settings_follow_route_contracts() {
    let (url, wire) = ok(201, assistant());
    client(&url)
        .create_assistant(&CreateAssistant {
            name: "Example".into(),
            description: None,
            draft_config: json!({"schema_version":1}),
        })
        .await
        .unwrap();
    let wire = wire.join().unwrap();
    assert_wire(&wire, "POST", "/api/v1/assistants");
    assert_eq!(
        body(&wire),
        json!({"name":"Example","draft_config":{"schema_version":1}})
    );
    assert!(!wire.contains("idempotency-key"));
    let (url, wire) = ok(200, assistant());
    assert_eq!(
        client(&url)
            .get_assistant("assistant-3")
            .await
            .unwrap()
            .data
            .id,
        "assistant-3"
    );
    assert_wire(
        &wire.join().unwrap(),
        "GET",
        "/api/v1/assistants/assistant-3",
    );
    let (url, wire) = ok(
        201,
        json!({"assistant":assistant(),"published_version_id":"version-6"}),
    );
    assert_eq!(
        client(&url)
            .publish_assistant("assistant-3")
            .await
            .unwrap()
            .data
            .published_version_id,
        "version-6"
    );
    let wire = wire.join().unwrap();
    assert_wire(&wire, "POST", "/api/v1/assistants/assistant-3/publish");
    assert_eq!(wire.split_once("\r\n\r\n").unwrap().1, "");
    for method in ["GET", "PUT"] {
        let (url, wire) = ok(200, json!({"livekit_allowed_hosts":["room.example.test"]}));
        let c = client(&url);
        let r = if method == "GET" {
            c.settings().await
        } else {
            c.update_settings(&ProjectSettings {
                livekit_allowed_hosts: vec!["room.example.test".into()],
            })
            .await
        }
        .unwrap();
        assert_eq!(r.data.livekit_allowed_hosts, vec!["room.example.test"]);
        let wire = wire.join().unwrap();
        assert_wire(&wire, method, "/api/v1/settings");
        if method == "PUT" {
            assert_eq!(
                body(&wire),
                json!({"livekit_allowed_hosts":["room.example.test"]})
            );
        }
    }
}

#[tokio::test]
async fn malformed_envelopes_and_types_fail_without_claiming_success() {
    for value in [
        json!({"data":call()}),
        json!({"request_id":"r"}),
        json!({"data":null,"request_id":""}),
        json!({"data":{},"request_id":42}),
    ] {
        let (url, wire) = server(200, value.to_string(), "", Duration::ZERO);
        assert_eq!(
            client(&url)
                .request::<Value>("/calls", HttpMethod::GET, None, None)
                .await
                .unwrap_err()
                .code,
            "invalid_response_type"
        );
        wire.join().unwrap();
    }
    let (url, wire) = ok(200, json!({"id":55}));
    assert_eq!(
        client(&url).get_call("call-1").await.unwrap_err().code,
        "invalid_response_type"
    );
    wire.join().unwrap();
}

#[tokio::test]
async fn errors_preserve_body_request_ids_and_redact_formatting_without_retries() {
    for status in [400, 401, 403, 404, 409, 422, 429, 500, 503] {
        let (url, wire) = server(status,json!({"error":{"code":"private-code","message":"sensitive text","details":{"token":"secret"}},"request_id":"body-trace"}).to_string(),"Retry-After: 0\r\n",Duration::ZERO);
        let error = client(&url)
            .create_call(&create(), "stable-key")
            .await
            .unwrap_err();
        assert_eq!(error.status, Some(status));
        assert_eq!(error.request_id.as_deref(), Some("body-trace"));
        assert_eq!(error.code, "private-code");
        assert_eq!(
            error.data.as_ref().unwrap()["error"]["details"]["token"],
            "secret"
        );
        for secret in [
            "secret",
            "sensitive text",
            "private-code",
            "body-trace",
            "127.0.0.1",
        ] {
            assert!(!format!("{error} {error:?}").contains(secret));
        }
        assert!(std::error::Error::source(&error).is_none());
        wire.join().unwrap();
    }
}

#[tokio::test]
async fn invalid_paths_keys_ids_pagination_and_configuration_never_dispatch() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let c = client(&url);
    for path in [
        "//evil.test",
        "/../calls",
        "/%2e%2e/calls",
        "/calls/%2fsecret",
        "/calls?x=%0a",
        "/calls?x=%250a",
        "/calls#fragment",
        "https://evil.test",
    ] {
        assert_eq!(
            c.request::<Value>(path, HttpMethod::GET, None, None)
                .await
                .unwrap_err()
                .code,
            "invalid_path"
        );
    }
    for k in [
        "".to_owned(),
        "1234567".into(),
        "a".repeat(201),
        " key-eight".into(),
        "key-eight ".into(),
        "key\nnewline".into(),
        "nonascii-🦀".into(),
    ] {
        assert_eq!(
            c.create_call(&create(), &k).await.unwrap_err().code,
            "invalid_idempotency_key"
        );
    }
    for id in ["", "..", "a/b", "a?x=1", "%2f", "a\r\n"] {
        assert_eq!(c.get_call(id).await.unwrap_err().code, "invalid_identifier");
    }
    for (limit, offset) in [(0, 0), (101, 0), (1, u64::MAX)] {
        assert_eq!(
            c.list_calls(limit, offset).await.unwrap_err().code,
            "invalid_pagination"
        );
    }
    assert!(ChertSdk::new(None, None).is_err());
    assert!(ChertSdk::new(None, Some(config(&url)))
        .unwrap()
        .imessage
        .is_none());
    for project_id in ["", "x y", "x\n", "../"] {
        let mut cfg = config(&url);
        cfg.project_id = project_id;
        assert!(FaceTimeClient::new(cfg).is_err());
    }
    for base in [
        "http://example.test",
        "https://u:p@example.test",
        "https://example.test/../api",
        "https://example.test?secret",
    ] {
        assert!(FaceTimeClient::new(config(base)).is_err());
    }
    assert!(listener.accept().is_err());
}

#[tokio::test]
async fn transport_bounds_timeout_redirects_and_explicit_json_null() {
    let sink = TcpListener::bind("127.0.0.1:0").unwrap();
    sink.set_nonblocking(true).unwrap();
    let (url, wire) = server(
        307,
        "{}".into(),
        &format!("Location: http://{}/stolen\r\n", sink.local_addr().unwrap()),
        Duration::ZERO,
    );
    assert_eq!(
        client(&url).get_call("call-1").await.unwrap_err().status,
        Some(307)
    );
    wire.join().unwrap();
    assert!(sink.accept().is_err());
    for (limit, delay, expected) in [
        (8, Duration::ZERO, "response_too_large"),
        (8192, Duration::from_millis(150), "outcome_unknown"),
    ] {
        let (url, wire) = server(200, envelope(call()).to_string(), "", delay);
        let mut cfg = config(&url);
        cfg.limits = TransportLimits {
            timeout: Duration::from_millis(50),
            max_response_bytes: limit,
        };
        assert_eq!(
            FaceTimeClient::new(cfg)
                .unwrap()
                .get_call("call-1")
                .await
                .unwrap_err()
                .code,
            expected
        );
        wire.join().unwrap();
    }
    for input in [None, Some(Value::Null)] {
        let (url, wire) = ok(200, Value::Null);
        let r = client(&url)
            .request::<Option<Call>>("/custom", HttpMethod::POST, input.as_ref(), None)
            .await
            .unwrap();
        assert!(r.data.is_none());
        let wire = wire.join().unwrap();
        assert_eq!(
            wire.split_once("\r\n\r\n").unwrap().1,
            if input.is_some() { "null" } else { "" }
        );
    }
}

#[tokio::test]
async fn exact_key_and_response_limits_and_future_call_states_are_preserved() {
    for key_length in [8, 200] {
        let mut snapshot = call();
        snapshot["status"] = json!("future_server_state");
        snapshot["new_field"] = json!({"value":17});
        let response = envelope(snapshot).to_string();
        for limit in [response.len() - 1, response.len()] {
            let (url, wire) = server(201, response.clone(), "", Duration::ZERO);
            let mut cfg = config(&url);
            cfg.limits.max_response_bytes = limit;
            let key = "k".repeat(key_length);
            let result = FaceTimeClient::new(cfg)
                .unwrap()
                .create_call(&create(), &key)
                .await;
            if limit == response.len() {
                let r = result.unwrap();
                assert_eq!(r.data.status, "future_server_state");
                assert_eq!(r.data.extra["new_field"], json!({"value":17}));
            } else {
                assert_eq!(result.unwrap_err().code, "response_too_large");
            }
            assert!(wire
                .join()
                .unwrap()
                .contains(&format!("idempotency-key: {key}\r\n")));
        }
    }
}

#[tokio::test]
async fn invalid_call_modes_and_empty_patches_fail_before_network() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let c = client(&url);
    for variant in 0..6 {
        let mut input = create();
        match variant {
            0 => input.line_id = "../bad".into(),
            1 => {
                input.execution = CallExecution::Managed {
                    assistant_id: "".into(),
                }
            }
            2 => input.target = CallTarget::Group { recipients: vec![] },
            3 => {
                input.target = CallTarget::Group {
                    recipients: vec![Recipient::Email("a@example.test".into()); 32],
                }
            }
            4 => {
                input.target = CallTarget::Destination {
                    destination: "a".into(),
                    destination_type: DestinationType::Email,
                }
            }
            _ => {
                input.media.audio = false;
                input.execution = CallExecution::CustomerManaged {
                    room: RoomCredentials {
                        livekit_url: "wss://room.example.test".into(),
                        participant_token: "synthetic-token".into(),
                        remote_participant_identity: "remote".into(),
                    },
                };
            }
        }
        assert!(c
            .create_call(&input, "valid-key")
            .await
            .unwrap_err()
            .status
            .is_none());
    }
    assert_eq!(
        c.update_line("line-2", &UpdateLine::default())
            .await
            .unwrap_err()
            .code,
        "invalid_line_request"
    );
    assert_eq!(
        c.update_assistant(
            "assistant-3",
            &UpdateAssistant {
                expected_draft_revision: 0,
                name: None,
                description: None,
                status: None,
                draft_config: None
            }
        )
        .await
        .unwrap_err()
        .code,
        "invalid_assistant_request"
    );
    assert_eq!(
        c.call_action(
            "call-1",
            CallAction::End,
            Some(&"r".repeat(161)),
            "valid-key"
        )
        .await
        .unwrap_err()
        .code,
        "invalid_call_request"
    );
    assert!(listener.accept().is_err());
}
