use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};
use trychert_sdk::{
    facetime::FaceTimeClient,
    media::{
        ColorSpace, CustomVideoTransport, PixelFormat, PlaneRef, Rotation, VideoFrameInit,
        MAX_FRAME_BYTES,
    },
    parse_media_capabilities, ChertError, CreateMediaSession, FaceTimeConfig, MediaCapabilities,
    MediaContent, MediaDirection, MediaFrameError, MediaSessionContent, MediaSessionGrant,
    TransportLimits, VideoCodec, VideoFrame,
};

const KEY: &str = "ft-media-synthetic";
const GRANT_TOKEN: &str = "session-bearer-secret";
const PRIVATE: &str = "private-server-content";

/// One-shot loopback HTTP fixture; asserts the SDK never retries.
fn server(status: u16, body: String) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
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
fn client(url: &str) -> FaceTimeClient {
    FaceTimeClient::new(FaceTimeConfig {
        base_url: url,
        api_key: KEY,
        project_id: "project-ft",
        limits: TransportLimits::default(),
    })
    .unwrap()
}
fn grant() -> Value {
    json!({"session_id":"0b7f3c9e-2d4a-4c1b-9e8f-1a2b3c4d5e6f","direction":"publish",
        "endpoint":"https://media.example.test/opaque/abc","token":GRANT_TOKEN,
        "connect_by":"2026-10-25T12:00:00Z","expires_at":"2026-10-25T12:30:00.5+00:00",
        "ice_servers":[{"urls":"stun:stun.example.test"},
            {"urls":["turn:turn.example.test"],"username":"u","credential":"turn-secret","credentialType":"password"}],
        "codecs":["h264","vp8"],
        "limits":{"max_width":1920,"max_height":1080,"max_fps":30,"max_frame_bytes":8388608}})
}
fn with(mut value: Value, key: &str, replacement: Value) -> Value {
    value[key] = replacement;
    value
}
fn publish(codecs: Option<Vec<VideoCodec>>) -> CreateMediaSession {
    CreateMediaSession {
        direction: MediaDirection::Publish,
        codecs,
        content: None,
    }
}
fn body(wire: &str) -> Value {
    serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap()
}

#[tokio::test]
async fn request_body_headers_and_redacted_grant() {
    let (url, handle) = server(201, json!({"data": grant()}).to_string());
    let result = client(&url)
        .create_media_session("call-1", publish(None))
        .await
        .unwrap();
    let wire = handle.join().unwrap();
    assert!(wire.starts_with("POST /api/v1/calls/call-1/media-sessions HTTP/1.1\r\n"));
    let headers = wire.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase();
    assert!(headers.contains(&format!("authorization: bearer {KEY}")));
    assert!(headers.contains("x-chert-project-id: project-ft"));
    assert_eq!(body(&wire), json!({"direction":"publish"}));
    assert_eq!(result.token, GRANT_TOKEN);
    assert_eq!(result.codecs, vec![VideoCodec::H264, VideoCodec::Vp8]);
    assert_eq!(result.limits.max_frame_bytes as usize, MAX_FRAME_BYTES);
    let debug = format!("{result:?}");
    assert!(!debug.contains(GRANT_TOKEN) && !debug.contains("turn-secret"));

    let (url, handle) = server(201, json!({"data": grant()}).to_string());
    client(&url)
        .create_media_session(
            "call-1",
            publish(Some(vec![VideoCodec::Vp8, VideoCodec::H264])),
        )
        .await
        .unwrap();
    assert_eq!(
        body(&handle.join().unwrap()),
        json!({"direction":"publish","codecs":["vp8","h264"]})
    );
}

#[tokio::test]
async fn local_validation_sends_nothing() {
    // Unroutable base: any network attempt would surface as outcome_unknown instead.
    let sdk = client("http://127.0.0.1:9");
    for (id, codecs) in [
        ("call-1", Some(vec![])),
        ("call-1", Some(vec![VideoCodec::H264, VideoCodec::H264])),
        ("", None),
        ("..", None),
        ("call/1", None),
    ] {
        let error = sdk
            .create_media_session(id, publish(codecs))
            .await
            .unwrap_err();
        assert!(error.status.is_none());
        assert!(matches!(
            error.code.as_str(),
            "invalid_media_session_request" | "invalid_identifier"
        ));
    }
}

#[tokio::test]
async fn grant_validation_failures_are_invalid_response() {
    let limits = |w: Value, h: Value, fps: Value, bytes: Value| json!({"max_width":w,"max_height":h,"max_fps":fps,"max_frame_bytes":bytes});
    let invalid = [
        Value::Null,
        json!([]),
        with(grant(), "direction", json!("subscribe")),
        with(grant(), "session_id", json!("not-a-uuid")),
        with(grant(), "endpoint", json!("http://media.example.test/x")),
        with(
            grant(),
            "endpoint",
            json!("https://user:pw@media.example.test/"),
        ),
        with(
            grant(),
            "endpoint",
            json!("https://media.example.test/#frag"),
        ),
        with(grant(), "endpoint", json!("not a url")),
        with(grant(), "token", json!("")),
        with(grant(), "token", json!("a\r\nb")),
        with(grant(), "token", Value::Null),
        with(grant(), "connect_by", json!("yesterday")),
        with(grant(), "expires_at", json!("2026-13-01T00:00:00Z")),
        with(grant(), "ice_servers", json!({})),
        with(grant(), "ice_servers", json!([{"urls":3}])),
        with(grant(), "ice_servers", json!([["stun:x"]])),
        with(grant(), "codecs", json!([])),
        with(grant(), "codecs", json!(["av1"])),
        with(grant(), "codecs", json!(["h264", "h264"])),
        with(grant(), "connect_by", json!("2026-10-25 12:00:00Z")),
        with(
            with(grant(), "connect_by", json!("2026-10-25T12:30:00.001Z")),
            "expires_at",
            json!("2026-10-25T12:30:00Z"),
        ),
        with(
            with(grant(), "connect_by", json!("2026-10-25T12:00:00-01:00")),
            "expires_at",
            json!("2026-10-25T12:30:00Z"),
        ),
        with(grant(), "ice_servers", json!([{"urls":[]}])),
        with(
            grant(),
            "ice_servers",
            json!([{"urls":"stun:x","username":null}]),
        ),
        with(
            grant(),
            "ice_servers",
            json!([{"urls":"stun:x","credential":7}]),
        ),
        with(
            grant(),
            "ice_servers",
            json!([{"urls":"stun:x","credentialType":null}]),
        ),
        with(
            grant(),
            "ice_servers",
            json!([{"urls":"stun:x","credentialType":"oauth"}]),
        ),
        with(
            grant(),
            "limits",
            limits(json!(1921), json!(1080), json!(30), json!(1)),
        ),
        with(
            grant(),
            "limits",
            limits(json!(1920), json!(1080), json!(31), json!(1)),
        ),
        with(
            grant(),
            "limits",
            limits(json!(1920), json!(1080), json!(30), json!(8388609)),
        ),
        with(
            grant(),
            "limits",
            limits(json!(0), json!(1080), json!(30), json!(1)),
        ),
        with(grant(), "limits", Value::Null),
    ];
    for data in invalid {
        let (url, handle) = server(201, json!({ "data": data }).to_string());
        let error = client(&url)
            .create_media_session("call-1", publish(None))
            .await
            .unwrap_err();
        handle.join().unwrap();
        assert_eq!(
            (error.status, error.code.as_str()),
            (Some(201), "invalid_response")
        );
        assert!(error.data.is_none());
        assert!(!format!("{error:?} {error}").contains(GRANT_TOKEN));
    }
    for endpoint in [
        "http://localhost:8889/x",
        "http://127.0.0.1/x",
        "http://[::1]:1/x",
    ] {
        let data = with(grant(), "endpoint", json!(endpoint));
        let (url, handle) = server(201, json!({ "data": data }).to_string());
        let result = client(&url)
            .create_media_session("call-1", publish(None))
            .await
            .unwrap();
        handle.join().unwrap();
        assert_eq!(result.endpoint, endpoint);
    }
}

#[tokio::test]
async fn timestamp_ordering_uses_instants_with_millisecond_precision() {
    for (connect_by, expires_at) in [
        ("2026-10-25T12:30:00Z", "2026-10-25T12:30:00Z"),
        ("2026-10-25T13:00:00+01:00", "2026-10-25T12:00:00Z"),
        ("2026-10-25T12:30:00.0009Z", "2026-10-25T12:30:00.0001Z"),
    ] {
        let data = with(
            with(grant(), "connect_by", json!(connect_by)),
            "expires_at",
            json!(expires_at),
        );
        let (url, handle) = server(201, json!({ "data": data }).to_string());
        let result = client(&url)
            .create_media_session("call-1", publish(None))
            .await
            .unwrap();
        handle.join().unwrap();
        assert_eq!(result.connect_by, connect_by);
    }
}

#[tokio::test]
async fn returned_codecs_must_be_within_requested() {
    let data = with(grant(), "codecs", json!(["h264", "vp8"]));
    let (url, handle) = server(201, json!({ "data": data }).to_string());
    let error = client(&url)
        .create_media_session("call-1", publish(Some(vec![VideoCodec::Vp8])))
        .await
        .unwrap_err();
    handle.join().unwrap();
    assert_eq!(
        (error.status, error.code.as_str()),
        (Some(201), "invalid_response")
    );
    let data = with(grant(), "codecs", json!(["h264"]));
    let (url, handle) = server(201, json!({ "data": data }).to_string());
    let result = client(&url)
        .create_media_session(
            "call-1",
            publish(Some(vec![VideoCodec::Vp8, VideoCodec::H264])),
        )
        .await
        .unwrap();
    handle.join().unwrap();
    assert_eq!(result.codecs, vec![VideoCodec::H264]);
}

#[tokio::test]
async fn subscribe_limits_are_capped_at_720p() {
    let subscribe = || CreateMediaSession {
        direction: MediaDirection::Subscribe,
        codecs: None,
        content: None,
    };
    for (w, h, ok) in [(1280, 720, true), (1281, 720, false), (1280, 721, false)] {
        let data = with(
            with(grant(), "direction", json!("subscribe")),
            "limits",
            json!({"max_width":w,"max_height":h,"max_fps":30,"max_frame_bytes":8388608}),
        );
        let (url, handle) = server(201, json!({ "data": data }).to_string());
        let result = client(&url)
            .create_media_session("call-1", subscribe())
            .await;
        handle.join().unwrap();
        match result {
            Ok(grant) => assert!(ok && grant.limits.max_width == 1280),
            Err(error) => assert!(!ok && error.code == "invalid_response"),
        }
    }
}

#[tokio::test]
async fn error_codes_surface_without_server_text() {
    for (status, code, expected) in [
        (401, "unauthorized", "unauthorized"),
        (401, "media_session_expired", "media_session_expired"),
        (404, "call_not_found", "call_not_found"),
        (
            409,
            "media_capability_unsupported",
            "media_capability_unsupported",
        ),
        (409, "media_session_conflict", "media_session_conflict"),
        (409, "call_not_active", "call_not_active"),
        (410, "call_ended", "call_ended"),
        (
            503,
            "media_transport_unavailable",
            "media_transport_unavailable",
        ),
        (409, "something_else", "request_failed"),
    ] {
        let payload = json!({"error":{"code":code,"message":PRIVATE}}).to_string();
        let (url, handle) = server(status, payload);
        let error = client(&url)
            .create_media_session("call-1", publish(None))
            .await
            .unwrap_err();
        handle.join().unwrap();
        assert_eq!(
            (error.status, error.code.as_str()),
            (Some(status), expected)
        );
        assert!(error.data.is_none());
        assert!(!format!("{error:?} {error}").contains(PRIVATE));
    }
}

fn session(direction: MediaDirection, content: Option<MediaSessionContent>) -> CreateMediaSession {
    CreateMediaSession {
        direction,
        codecs: None,
        content,
    }
}
fn screen_grant() -> Value {
    with(
        with(grant(), "content", json!("screen")),
        "limits",
        json!({"max_width":1920,"max_height":1080,"max_fps":15,"max_frame_bytes":8388608}),
    )
}
fn caller_screen_grant() -> Value {
    let data = with(grant(), "direction", json!("subscribe"));
    let data = with(data, "content", json!("caller_screen"));
    with(
        data,
        "limits",
        json!({"max_width":1280,"max_height":720,"max_fps":30,"max_frame_bytes":8388608}),
    )
}
async fn attempt(
    request: CreateMediaSession,
    data: Value,
) -> Result<MediaSessionGrant, ChertError> {
    let (url, handle) = server(201, json!({ "data": data }).to_string());
    let result = client(&url).create_media_session("call-1", request).await;
    handle.join().unwrap();
    result
}

#[tokio::test]
async fn screen_content_is_validated_echoed_and_capped() {
    use MediaDirection::{Publish, Subscribe};
    use MediaSessionContent::{CallerScreen, Camera, Screen};
    let (url, handle) = server(201, json!({"data": screen_grant()}).to_string());
    let result = client(&url)
        .create_media_session("call-1", session(Publish, Some(Screen)))
        .await
        .unwrap();
    assert_eq!(
        body(&handle.join().unwrap()),
        json!({"direction":"publish","content":"screen"})
    );
    assert_eq!((result.content, result.limits.max_fps), (Some(Screen), 15));
    let (url, handle) = server(201, json!({"data": caller_screen_grant()}).to_string());
    let result = client(&url)
        .create_media_session("call-1", session(Subscribe, Some(CallerScreen)))
        .await
        .unwrap();
    assert_eq!(
        body(&handle.join().unwrap()),
        json!({"direction":"subscribe","content":"caller_screen"})
    );
    assert_eq!(result.content, Some(CallerScreen));

    // Wrong combinations fail locally; the unroutable base would surface any request.
    let sdk = client("http://127.0.0.1:9");
    for (direction, content) in [
        (Publish, CallerScreen),
        (Subscribe, Screen),
        (Subscribe, Camera),
    ] {
        let error = sdk
            .create_media_session("call-1", session(direction, Some(content)))
            .await
            .unwrap_err();
        assert_eq!(
            (error.status, error.code.as_str()),
            (None, "invalid_media_session_request")
        );
    }

    let mut no_echo = screen_grant();
    no_echo.as_object_mut().unwrap().remove("content");
    for (request, data) in [
        (
            session(Publish, Some(Screen)),
            with(
                screen_grant(),
                "limits",
                json!({"max_width":1920,"max_height":1080,"max_fps":30,"max_frame_bytes":8388608}),
            ),
        ),
        (session(Publish, Some(Screen)), no_echo),
        (
            session(Publish, Some(Screen)),
            with(screen_grant(), "content", json!("camera")),
        ),
        (session(Publish, None), screen_grant()),
        (session(Subscribe, None), caller_screen_grant()),
    ] {
        let error = attempt(request, data).await.unwrap_err();
        assert_eq!(
            (error.status, error.code.as_str()),
            (Some(201), "invalid_response")
        );
    }
    // The backend echoes the resolved camera content on default requests in both directions.
    let result = attempt(
        session(Publish, None),
        with(grant(), "content", json!("camera")),
    )
    .await
    .unwrap();
    assert_eq!(result.content, Some(Camera));
    let result = attempt(
        session(Subscribe, None),
        with(caller_screen_grant(), "content", json!("camera")),
    )
    .await
    .unwrap();
    assert_eq!(result.content, Some(Camera));

    let payload =
        json!({"error":{"code":"caller_screen_not_shared","message":PRIVATE}}).to_string();
    let (url, handle) = server(409, payload);
    let error = client(&url)
        .create_media_session("call-1", session(Subscribe, Some(CallerScreen)))
        .await
        .unwrap_err();
    handle.join().unwrap();
    assert_eq!(
        (error.status, error.code.as_str()),
        (Some(409), "caller_screen_not_shared")
    );
    assert!(!format!("{error:?} {error}").contains(PRIVATE));

    for (status, code) in [
        (409, "media_content_unsupported"),
        (409, "caller_screen_unsupported"),
        (422, "media_limit_exceeded"),
    ] {
        let (url, handle) = server(
            status,
            json!({"error":{"code":code,"message":PRIVATE}}).to_string(),
        );
        let error = client(&url)
            .create_media_session("call-1", session(Publish, Some(Screen)))
            .await
            .unwrap_err();
        handle.join().unwrap();
        assert_eq!((error.status, error.code.as_str()), (Some(status), code));
        assert!(!format!("{error:?} {error}").contains(PRIVATE));
    }
}

fn caps() -> Value {
    json!({"version":1,
        "custom_video":{"supported":true,"transports":["whip","whip","livekit"],"codecs":["vp8","h264","vp8"],
            "max_width":1920,"max_height":1080,"max_fps":30},
        "inbound_caller_video":{"supported":true,"transports":["whep"],"max_width":1280,"max_height":720,"max_fps":30}})
}
fn section(name: &str, key: &str, value: Value) -> Value {
    let mut caps = caps();
    caps[name][key] = value;
    caps
}

#[test]
fn capabilities_absent_malformed_and_unknown_version_are_unsupported() {
    for value in [
        Value::Null,
        json!({}),
        json!("v1"),
        json!([]),
        with(caps(), "version", json!(2)),
        with(caps(), "version", json!(true)),
        json!({"video":true,"supports_video":true}),
    ] {
        assert_eq!(
            parse_media_capabilities(&value),
            MediaCapabilities::default()
        );
    }
}

#[test]
fn capabilities_contents_default_to_camera_and_ignore_unknown_entries() {
    use MediaContent::{Camera, Screen};
    let parsed = parse_media_capabilities(&caps());
    assert_eq!(parsed.custom_video.unwrap().contents, vec![Camera]);
    assert_eq!(parsed.inbound_caller_video.unwrap().contents, vec![Camera]);
    let mut value = section(
        "custom_video",
        "contents",
        json!(["screen", "window", "camera", "screen"]),
    );
    value["inbound_caller_video"]["contents"] = json!(["screen"]);
    let parsed = parse_media_capabilities(&value);
    assert_eq!(parsed.custom_video.unwrap().contents, vec![Screen, Camera]);
    assert_eq!(parsed.inbound_caller_video.unwrap().contents, vec![Screen]);
    for contents in [
        json!([]),
        json!(["window"]),
        json!("screen"),
        Value::Null,
        json!([7]),
    ] {
        let parsed = parse_media_capabilities(&section("custom_video", "contents", contents));
        assert_eq!(parsed.custom_video.unwrap().contents, vec![Camera]);
    }
}

#[test]
fn capabilities_sections_are_deduped_and_validated_independently() {
    let parsed = parse_media_capabilities(&caps());
    let custom = parsed.custom_video.unwrap();
    assert_eq!(
        custom.transports,
        vec![CustomVideoTransport::Whip, CustomVideoTransport::Livekit]
    );
    assert_eq!(custom.codecs, vec![VideoCodec::Vp8, VideoCodec::H264]);
    assert_eq!(parsed.inbound_caller_video.unwrap().max_width, 1280);
    assert!(
        parse_media_capabilities(&with(caps(), "version", json!(1.0)))
            .custom_video
            .is_some()
    );

    for (key, value) in [
        ("max_width", json!(1921)),
        ("max_height", json!(1081)),
        ("max_fps", json!(31)),
        ("max_fps", json!(0)),
        ("max_fps", json!(29.5)),
        ("max_width", json!(true)),
        ("transports", json!(["whep"])),
        ("transports", json!([])),
        ("codecs", json!([])),
        ("codecs", json!(["av1"])),
        ("supported", json!(false)),
        ("supported", json!(1)),
    ] {
        let parsed = parse_media_capabilities(&section("custom_video", key, value));
        assert!(parsed.custom_video.is_none(), "{key}");
        assert!(parsed.inbound_caller_video.is_some());
    }
    for (key, value) in [
        ("max_width", json!(1281)),
        ("max_height", json!(721)),
        ("transports", json!(["whip"])),
        ("max_fps", json!(31)),
    ] {
        let parsed = parse_media_capabilities(&section("inbound_caller_video", key, value));
        assert!(parsed.inbound_caller_video.is_none(), "{key}");
        assert!(parsed.custom_video.is_some());
    }
}

fn frame<'a>(
    format: PixelFormat,
    width: u32,
    height: u32,
    planes: &'a [PlaneRef<'a>],
) -> VideoFrameInit<'a> {
    VideoFrameInit {
        format,
        width,
        height,
        planes,
        timestamp_us: 1,
        duration_us: None,
        rotation: None,
        color_space: None,
    }
}
fn code(input: &VideoFrameInit<'_>) -> &'static str {
    VideoFrame::copy_from(input).unwrap_err().code()
}

#[test]
fn frames_copy_only_required_bytes_and_apply_defaults() {
    let mut y = vec![0u8; 80 * 32];
    let uv = vec![0u8; 40 * 16];
    let copied = {
        let planes = [
            PlaneRef {
                data: &y,
                stride: 80,
            },
            PlaneRef {
                data: &uv,
                stride: 40,
            },
            PlaneRef {
                data: &uv,
                stride: 40,
            },
        ];
        VideoFrame::copy_from(&frame(PixelFormat::I420, 64, 32, &planes)).unwrap()
    };
    y[0] = 9;
    assert_eq!(copied.planes()[0].data()[0], 0);
    assert_eq!(copied.planes()[0].data().len(), 80 * 31 + 64);
    assert_eq!(copied.planes()[1].data().len(), 40 * 15 + 32);
    assert_eq!(
        (
            copied.color_space(),
            copied.rotation(),
            copied.duration_us()
        ),
        (ColorSpace::Bt709Limited, Rotation::Deg0, None)
    );
    let rgba = [0u8; 1024];
    let planes = [PlaneRef {
        data: &rgba,
        stride: 64,
    }];
    let mut input = frame(PixelFormat::Bgra, 16, 16, &planes);
    input.rotation = Some(Rotation::Deg90);
    let bgra = VideoFrame::copy_from(&input).unwrap();
    assert_eq!(
        (bgra.color_space(), bgra.rotation()),
        (ColorSpace::SrgbFull, Rotation::Deg90)
    );
}

#[test]
fn frame_bounds() {
    let y = vec![0u8; 400 * 32];
    let uv = vec![0u8; 32 * 16];
    let i420 = |stride: usize| {
        [
            PlaneRef { data: &y, stride },
            PlaneRef {
                data: &uv,
                stride: 32,
            },
            PlaneRef {
                data: &uv,
                stride: 32,
            },
        ]
    };
    assert_eq!(
        code(&frame(PixelFormat::I420, 64, 32, &i420(62))),
        "invalid_frame"
    );
    assert_eq!(
        code(&frame(PixelFormat::I420, 64, 32, &i420(64 + 257))),
        "invalid_frame"
    );
    let ok = i420(64);
    for (w, h) in [(63, 32), (64, 14), (1922, 1080), (64, 1082)] {
        let error = VideoFrame::copy_from(&frame(PixelFormat::I420, w, h, &ok)).unwrap_err();
        assert!(matches!(&error, MediaFrameError::InvalidFrame(m) if m.contains("even")));
    }
    let mut zero_duration = frame(PixelFormat::I420, 64, 32, &ok);
    zero_duration.duration_us = Some(0);
    assert_eq!(code(&zero_duration), "invalid_frame");
    let one = [PlaneRef {
        data: &y,
        stride: 16,
    }];
    let error = VideoFrame::copy_from(&frame(PixelFormat::Nv12, 16, 16, &one)).unwrap_err();
    assert_eq!(error.to_string(), "nv12 requires 2 plane(s).");
    let short_uv = [0u8; 10];
    let short = [
        ok[0],
        PlaneRef {
            data: &short_uv,
            stride: 32,
        },
        ok[2],
    ];
    let error = VideoFrame::copy_from(&frame(PixelFormat::I420, 64, 32, &short)).unwrap_err();
    assert!(error.to_string().contains("Plane 1"));

    let big = vec![0u8; 7936 * 1080];
    let padded = [PlaneRef {
        data: &big,
        stride: 7936,
    }];
    assert_eq!(
        VideoFrame::copy_from(&frame(PixelFormat::Rgba, 1920, 1080, &padded)).unwrap_err(),
        MediaFrameError::FrameTooLarge
    );
    let tight = [PlaneRef {
        data: &big,
        stride: 7680,
    }];
    let frame = VideoFrame::copy_from(&frame(PixelFormat::Rgba, 1920, 1080, &tight)).unwrap();
    assert_eq!(frame.planes()[0].data().len(), 8_294_400);
}

mod call_video {
    use super::*;
    use trychert_sdk::{
        composition_input_target,
        media::{
            BaseLayerInput, CompositionBackground, CompositionBaseKind, CompositionRegion,
            LivingInputKind, PageLayerInput, VideoLayer, VideoLayerInput,
        },
        parse_video_composition, CallVideoComposition, SetCallVideo,
    };

    fn camera_grant() -> Value {
        json!({"session_id":"3f2b8c1e-0d4a-4b7e-9c11-2a6f5e0d9b77","direction":"publish","content":"camera",
            "endpoint":"https://signal.example/opaque/abc","token":"session-bearer",
            "connect_by":"2026-10-25T00:05:00Z","expires_at":"2026-10-25T01:00:00Z",
            "ice_servers":[{"urls":["turn:turn.example:3478"]}],"codecs":["h264"],
            "limits":{"max_width":1920,"max_height":1080,"max_fps":24,"max_frame_bytes":8388608}})
    }
    fn living(fps: u32, call: &str) -> Value {
        json!({"session_id":"ls","call_id":call,"deployment_id":"dep","status":"starting",
            "viewport":{"width":1920,"height":270},"fps":fps,"ready_at":null,"last_heartbeat_at":null,"error_code":null})
    }
    fn captions() -> Value {
        json!({"id":"captions","z":1,"living_session":living(12, "call"),
            "region":{"x":0,"y":0.75,"width":1,"height":0.25},"background":"transparent","opacity":0.8,"input":["pointer"]})
    }
    fn base_layer() -> Value {
        json!({"id":"base","z":0,"source":{"kind":"camera"},"publish":camera_grant()})
    }
    fn layered() -> Value {
        json!({"composition_id":"cmp","call_id":"call","revision":3,"status":"starting",
            "output":{"width":1920,"height":1080,"fps":24},"error_code":null,"layers":[base_layer(), captions()]})
    }
    fn page_only() -> Value {
        let mut value = layered();
        value["output"] = json!({"width":1280,"height":720,"fps":30});
        value["layers"] = json!([{"id":"page","z":1,"living_session":living(30, "call"),
            "region":{"x":0,"y":0,"width":1,"height":1},"background":"opaque","opacity":1,"input":[]}]);
        value
    }
    fn base() -> VideoLayerInput {
        VideoLayerInput::Base(BaseLayerInput {
            id: "base".into(),
            source: CompositionBaseKind::Camera,
        })
    }
    fn page() -> PageLayerInput {
        PageLayerInput::new("p", 1, "dep")
    }
    fn layers(layers: Vec<VideoLayerInput>) -> SetCallVideo {
        SetCallVideo::Layers {
            layers,
            revision: None,
        }
    }
    fn shortcut(deployment_id: &str) -> SetCallVideo {
        SetCallVideo::Page {
            deployment_id: deployment_id.into(),
            input: None,
            initial_state: None,
            revision: None,
        }
    }
    async fn get(data: Value) -> Result<CallVideoComposition, ChertError> {
        let (url, handle) = server(200, json!({ "data": data }).to_string());
        let result = client(&url).get_call_video("call").await;
        handle.join().unwrap();
        result
    }
    fn key_header(wire: &str) -> Option<String> {
        wire.split_once("\r\n\r\n")
            .unwrap()
            .0
            .lines()
            .find_map(|l| {
                l.to_ascii_lowercase()
                    .strip_prefix("idempotency-key: ")
                    .map(|_| l[17..].to_owned())
            })
    }

    #[tokio::test]
    async fn page_shortcut_layered_get_and_clear() {
        let (url, handle) = server(200, json!({"data": page_only()}).to_string());
        let result = client(&url)
            .set_call_video("call", &shortcut("dep-url"), "video-key-1")
            .await
            .unwrap();
        let wire = handle.join().unwrap();
        assert!(wire.starts_with("PUT /api/v1/calls/call/video HTTP/1.1\r\n"));
        assert_eq!(key_header(&wire).as_deref(), Some("video-key-1"));
        assert_eq!(
            body(&wire),
            json!({"layers":[{"id":"page","z":1,"page":{"deployment_id":"dep-url"},
                "region":{"x":0,"y":0,"width":1,"height":1},"background":"opaque","opacity":1}]})
        );
        // Integral numbers go out as JSON integers, as in the TypeScript SDK.
        assert!(wire.contains("\"opacity\":1,") && !wire.contains("1.0"));
        assert_eq!(result.output.fps, 30);

        let (url, handle) = server(200, json!({"data": layered()}).to_string());
        let input = SetCallVideo::Layers {
            revision: Some(2),
            layers: vec![
                base(),
                VideoLayerInput::Page(PageLayerInput {
                    region: Some(CompositionRegion {
                        x: 0.0,
                        y: 0.75,
                        width: 1.0,
                        height: 0.25,
                    }),
                    background: Some(CompositionBackground::Transparent),
                    opacity: Some(0.8),
                    input: Some(vec![LivingInputKind::Pointer]),
                    initial_state: Some(json!({"lang":"en"})),
                    ..PageLayerInput::new("captions", 1, "dep")
                }),
            ],
        };
        let result = client(&url)
            .set_call_video("call", &input, "video-key-2")
            .await
            .unwrap();
        let wire = handle.join().unwrap();
        assert!(wire.starts_with("PUT /api/v1/calls/call/video HTTP/1.1\r\n"));
        assert_eq!(key_header(&wire).as_deref(), Some("video-key-2"));
        assert_eq!(
            body(&wire),
            json!({"revision":2,"layers":[{"id":"base","z":0,"source":{"kind":"camera"}},
                {"id":"captions","z":1,"page":{"deployment_id":"dep"},"region":{"x":0,"y":0.75,"width":1,"height":0.25},
                 "background":"transparent","opacity":0.8,"input":["pointer"],"initial_state":{"lang":"en"}}]})
        );
        match &result.layers[0] {
            VideoLayer::Base(base) => {
                assert_eq!(base.publish.as_ref().unwrap().token, "session-bearer")
            }
            VideoLayer::Page(_) => panic!("expected base"),
        }
        assert!(!format!("{result:?}").contains("session-bearer"));

        for (method, wire) in [
            ("GET", {
                let (url, handle) = server(200, json!({"data": layered()}).to_string());
                client(&url).get_call_video("call").await.unwrap();
                handle.join().unwrap()
            }),
            ("DELETE", {
                let (url, handle) = server(200, json!({"data": layered()}).to_string());
                client(&url).clear_call_video("call").await.unwrap();
                handle.join().unwrap()
            }),
        ] {
            assert!(wire.starts_with(&format!("{method} /api/v1/calls/call/video HTTP/1.1\r\n")));
            assert_eq!(key_header(&wire), None);
            assert!(wire.ends_with("\r\n\r\n"));
        }

        // Input targets use output-frame coordinates; only the overlay's region accepts pointer input.
        assert_eq!(
            composition_input_target(&result, 0.5, 0.9).map(|p| p.id.as_str()),
            Some("captions")
        );
        assert!(composition_input_target(&result, 0.5, 0.74).is_none());
        let page_only = get(page_only()).await.unwrap();
        assert!(composition_input_target(&page_only, 0.5, 0.5).is_none());
    }

    #[tokio::test]
    async fn invalid_compositions_are_rejected_locally_before_any_request() {
        // Unroutable base: any network attempt would surface as outcome_unknown instead.
        let sdk = client("http://127.0.0.1:9");
        let with = |f: fn(&mut PageLayerInput)| {
            let mut p = page();
            f(&mut p);
            VideoLayerInput::Page(p)
        };
        // Unrepresentable here: z 1.5 and negative revision (integer types), background
        // `blurred` and base `screen` (enums), a base at z != 0 (no z field) and URL pages
        // (pages are deployment IDs only).
        let mut deep = json!(0);
        for _ in 0..70 {
            deep = json!([deep]);
        }
        let cases = vec![
            layers(vec![]),
            layers(vec![
                base(),
                VideoLayerInput::Page(page()),
                with(|p| {
                    p.id = "q".into();
                    p.z = 2
                }),
            ]),
            layers(vec![
                base(),
                VideoLayerInput::Base(BaseLayerInput {
                    id: "b2".into(),
                    source: CompositionBaseKind::Managed,
                }),
            ]),
            layers(vec![base(), with(|p| p.id = "base".into())]),
            layers(vec![base(), with(|p| p.z = 0)]),
            layers(vec![base(), with(|p| p.z = 65)]),
            layers(vec![
                base(),
                with(|p| {
                    p.region = Some(CompositionRegion {
                        x: 0.5,
                        y: 0.0,
                        width: 0.6,
                        height: 1.0,
                    })
                }),
            ]),
            layers(vec![
                base(),
                with(|p| {
                    p.region = Some(CompositionRegion {
                        x: 0.0,
                        y: 0.0,
                        width: 0.0,
                        height: 1.0,
                    })
                }),
            ]),
            layers(vec![
                base(),
                with(|p| {
                    p.region = Some(CompositionRegion {
                        x: f64::NAN,
                        ..CompositionRegion::FULL
                    })
                }),
            ]),
            layers(vec![base(), with(|p| p.opacity = Some(1.2))]),
            layers(vec![base(), with(|p| p.opacity = Some(f64::INFINITY))]),
            layers(vec![with(|p| {
                p.background = Some(CompositionBackground::Transparent)
            })]),
            layers(vec![with(|p| p.opacity = Some(0.5))]),
            layers(vec![with(|p| {
                p.region = Some(CompositionRegion {
                    x: 0.0,
                    y: 0.0,
                    width: 0.5,
                    height: 1.0,
                })
            })]),
            layers(vec![
                base(),
                with(|p| p.input = Some(vec![LivingInputKind::Pointer, LivingInputKind::Pointer])),
            ]),
            layers(vec![with(|p| p.id = "Upper".into())]),
            layers(vec![with(|p| p.id = "a".repeat(33))]),
            layers(vec![with(|p| p.deployment_id = String::new())]),
            layers(vec![with(|p| p.deployment_id = "d".repeat(129))]),
            layers(vec![
                base(),
                with(|p| p.initial_state = Some(json!({"blob": "x".repeat(64 * 1024)}))),
            ]),
            shortcut(""),
            // URL pages need a TypeScript SDK deployment first.
            shortcut("https://agent.example/p"),
            SetCallVideo::Page {
                deployment_id: "dep".into(),
                input: None,
                initial_state: Some(deep),
                revision: None,
            },
            SetCallVideo::Page {
                deployment_id: "dep".into(),
                input: None,
                initial_state: None,
                revision: Some(9_007_199_254_740_992),
            },
        ];
        for input in cases {
            let error = sdk
                .set_call_video("call", &input, "video-key-1")
                .await
                .unwrap_err();
            assert_eq!(
                (error.status, error.code.as_str()),
                (None, "invalid_call_video_request"),
                "{input:?}"
            );
        }
        for (id, key) in [
            ("..", "video-key-1"),
            ("call", "short"),
            ("call", " padded-key "),
        ] {
            let error = sdk
                .set_call_video(id, &shortcut("dep"), key)
                .await
                .unwrap_err();
            assert!(error.status.is_none());
            assert!(matches!(
                error.code.as_str(),
                "invalid_identifier" | "invalid_idempotency_key"
            ));
        }
        // A region touching the frame edge is inside it.
        let (url, handle) = server(200, json!({"data": layered()}).to_string());
        client(&url)
            .set_call_video(
                "call",
                &layers(vec![
                    base(),
                    with(|p| {
                        p.region = Some(CompositionRegion {
                            x: 0.75,
                            y: 0.75,
                            width: 0.25,
                            height: 0.25,
                        })
                    }),
                ]),
                "video-key-1",
            )
            .await
            .unwrap();
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn responses_outside_the_contract_are_invalid_response() {
        let with_layers = |layers: Value, extra: Option<(&str, Value)>| {
            let mut value = layered();
            value["layers"] = layers;
            if let Some((key, replacement)) = extra {
                value[key] = replacement;
            }
            value
        };
        let caption = |key: &str, replacement: Value| {
            let mut value = captions();
            value[key] = replacement;
            value
        };
        let mut screen = base_layer();
        screen["publish"]["content"] = json!("screen");
        let mut status = layered();
        status["status"] = json!("paused");
        let mut width = layered();
        width["output"]["width"] = json!(1921);
        let mut missing_error_code = layered();
        missing_error_code
            .as_object_mut()
            .unwrap()
            .remove("error_code");
        for bad in [
            with_layers(
                json!([base_layer(), caption("living_session", living(30, "call"))]),
                None,
            ),
            with_layers(
                json!([base_layer(), captions()]),
                Some(("output", json!({"width":1920,"height":1080,"fps":30}))),
            ),
            with_layers(
                json!([{"id":"base","z":0,"source":{"kind":"managed"},"publish":camera_grant()}, captions()]),
                None,
            ),
            with_layers(json!([screen, captions()]), None),
            with_layers(
                json!([base_layer(), captions(), caption("id", json!("more"))]),
                None,
            ),
            with_layers(
                json!([base_layer(), caption("living_session", living(12, "other"))]),
                None,
            ),
            with_layers(
                json!([
                    base_layer(),
                    caption("region", json!({"x":0.5,"y":0,"width":0.6,"height":1}))
                ]),
                None,
            ),
            with_layers(json!([base_layer(), caption("z", json!(0))]), None),
            with_layers(
                json!([
                    base_layer(),
                    caption("input", json!(["pointer", "pointer"]))
                ]),
                None,
            ),
            status,
            width,
            missing_error_code,
            Value::Null,
        ] {
            let error = get(bad).await.unwrap_err();
            assert_eq!(
                (error.status, error.code.as_str()),
                (Some(200), "invalid_response")
            );
            assert!(error.data.is_none());
        }
        get(with_layers(
            json!([{"id":"base","z":0,"source":{"kind":"managed"}}, captions()]),
            None,
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn composition_error_codes_survive_without_server_text() {
        for (status, code, expected) in [
            (
                409,
                "video_composition_unsupported",
                "video_composition_unsupported",
            ),
            (422, "composition_invalid", "composition_invalid"),
            (
                409,
                "composition_revision_conflict",
                "composition_revision_conflict",
            ),
            (
                409,
                "composition_base_unavailable",
                "composition_base_unavailable",
            ),
            (409, "media_session_conflict", "media_session_conflict"),
            (409, "composition_secret", "request_failed"),
        ] {
            let payload = json!({"error":{"code":code,"message":PRIVATE}}).to_string();
            let (url, handle) = server(status, payload);
            let error = client(&url)
                .set_call_video("call", &shortcut("dep"), "video-key-1")
                .await
                .unwrap_err();
            handle.join().unwrap();
            assert_eq!(
                (error.status, error.code.as_str()),
                (Some(status), expected)
            );
            assert!(error.data.is_none());
            assert!(!format!("{error:?} {error}").contains(PRIVATE));
        }
    }

    #[test]
    fn video_composition_capability_is_explicit_versioned_and_clamped() {
        let cap = json!({"version":1,"supported":true,"max_layers":4,"bases":["camera","hologram","managed","camera",3],
            "page_alpha":true,"regions":true,"max_width":3840,"max_height":1080,"max_fps":60});
        let parsed = parse_video_composition(&cap).unwrap();
        assert_eq!(
            (
                parsed.max_layers,
                parsed.bases.as_slice(),
                parsed.page_alpha,
                parsed.regions
            ),
            (
                2,
                &[CompositionBaseKind::Camera, CompositionBaseKind::Managed][..],
                true,
                true
            )
        );
        assert_eq!(
            (parsed.max_width, parsed.max_height, parsed.max_fps),
            (1920, 1080, 30)
        );
        let mut alpha = cap.clone();
        alpha["page_alpha"] = json!("yes");
        assert!(!parse_video_composition(&alpha).unwrap().page_alpha);
        for (key, value) in [
            ("version", json!(2)),
            ("supported", json!(false)),
            ("max_layers", json!(0)),
            ("max_fps", json!(1.5)),
            ("bases", json!("camera")),
        ] {
            let mut bad = cap.clone();
            bad[key] = value;
            assert!(parse_video_composition(&bad).is_none(), "{key}");
        }
        assert!(parse_video_composition(&Value::Null).is_none());
    }
}
