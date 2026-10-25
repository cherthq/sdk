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
    parse_media_capabilities, CreateMediaSession, FaceTimeConfig, MediaCapabilities,
    MediaDirection, MediaFrameError, TransportLimits, VideoCodec, VideoFrame,
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
