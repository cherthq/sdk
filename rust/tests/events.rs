use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    ops::ControlFlow,
    sync::mpsc,
    thread,
    time::Duration,
};
use trychert_sdk::{events::*, ChertClient};

fn server(
    body: Vec<u8>,
    status: &str,
    content_type: &str,
    fragment: bool,
    linger: bool,
) -> (ChertClient, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = ChertClient::new(
        &format!("http://{}/prefix", listener.local_addr().unwrap()),
        "secret-key",
        Some("tenant"),
        Duration::from_secs(3),
        2048,
    )
    .unwrap();
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        loop {
            let mut buf = [0; 1024];
            let n = stream.read(&mut buf).unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buf[..n]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                let len = headers
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length: "))
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= end + 4 + len {
                    break;
                }
            }
        }
        tx.send(String::from_utf8(request).unwrap()).unwrap();
        stream.write_all(head.as_bytes()).unwrap();
        if linger {
            // Client cancels while waiting for the advertised body; socket must close.
            let mut buf = [0; 1];
            match stream.read(&mut buf) {
                Ok(n) => assert_eq!(n, 0),
                Err(e) => assert_eq!(e.kind(), std::io::ErrorKind::ConnectionReset),
            }
        } else if fragment && body.len() > 64 * 1024 {
            // Exercise a final LF arriving separately from its CR.
            let last = body.len() - 1;
            let _ = stream.write_all(&body[..last]);
            thread::sleep(Duration::from_millis(30));
            let _ = stream.write_all(&body[last..]);
        } else if fragment {
            for byte in body {
                if stream.write_all(&[byte]).is_err() {
                    break;
                }
            }
        } else {
            let _ = stream.write_all(&body);
        }
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err(), "no reconnect or retry");
    });
    (client, rx, handle)
}
fn check(rx: mpsc::Receiver<String>, method_path: &str) -> String {
    let wire = rx.recv().unwrap();
    assert!(
        wire.starts_with(&format!("{method_path} HTTP/1.1")),
        "{wire}"
    );
    let lower = wire.to_lowercase();
    assert!(lower.contains("authorization: bearer secret-key\r\n"));
    assert!(lower.contains("x-chert-tenant: tenant\r\n"));
    assert!(!lower.contains("last-event-id"));
    wire
}
fn fixture(value: Value) -> (ChertClient, mpsc::Receiver<String>, thread::JoinHandle<()>) {
    server(
        value.to_string().into_bytes(),
        "200 OK",
        "application/json",
        false,
        false,
    )
}
#[tokio::test]
async fn event_list_detail_and_validation() {
    let row = json!({"id":"row-a","type":"message.received","event_id":"event-a","lead_id":null,
        "convo_id":null,"payload":{"text":"private"},"created_at":"now",
        "delivery":{"status":"pending","url":null,"attempts":[],"delivered_at":null}});
    let (c, rx, h) = fixture(json!({"events":[row],"count":1,"next_cursor":"opaque"}));
    let page = c
        .list_events(&EventListOptions {
            r#type: Some("message.received"),
            status: Some("pending"),
            lead_id: Some("lead-a"),
            since: Some("a/b+="),
            cursor: Some("next/x"),
            limit: Some(200),
        })
        .await
        .unwrap();
    assert_eq!(page.events[0].event.id, "row-a");
    assert_eq!(page.next_cursor.as_deref(), Some("opaque"));
    assert!(!format!("{page:?}").contains("private"));
    check(rx, "GET /prefix/events?type=message.received&status=pending&lead_id=lead-a&since=a%2Fb%2B%3D&cursor=next%2Fx&limit=200");
    h.join().unwrap();
    let (c, rx, h) = fixture(row);
    assert_eq!(
        c.get_event("row-a").await.unwrap().event.event_id,
        "event-a"
    );
    check(rx, "GET /prefix/events/row-a");
    h.join().unwrap();
    let c = ChertClient::new(
        "http://127.0.0.1:1",
        "key",
        None,
        Duration::from_secs(1),
        1024,
    )
    .unwrap();
    for limit in [0, 201] {
        assert_eq!(
            c.list_events(&EventListOptions {
                limit: Some(limit),
                ..Default::default()
            })
            .await
            .unwrap_err()
            .code,
            "invalid_pagination"
        );
    }
    for id in ["", "..", "a/b", "a?b", "%2f"] {
        assert_eq!(
            c.get_event(id).await.unwrap_err().code,
            "invalid_identifier"
        );
        assert_eq!(
            c.delete_webhook_subscription(id).await.unwrap_err().code,
            "invalid_identifier"
        );
    }
}
#[tokio::test]
async fn subscriptions_preserve_envelopes_and_patch_omission() {
    let sub = json!({"id":"sub-a","url":"https://example.test/hook","events":["message.received"],
        "version":"v1","is_active":true,"created_at":"now"});
    let (c, rx, h) = fixture(json!({"subscriptions":[sub]}));
    assert_eq!(
        c.list_webhook_subscriptions()
            .await
            .unwrap()
            .subscriptions
            .len(),
        1
    );
    check(rx, "GET /prefix/webhook-subscriptions");
    h.join().unwrap();
    let (c, rx, h) = fixture(json!({"subscription":sub}));
    c.get_webhook_subscription("sub-a").await.unwrap();
    check(rx, "GET /prefix/webhook-subscriptions/sub-a");
    h.join().unwrap();
    let mut created = sub.clone();
    created["secret"] = json!("private-secret");
    let (c, rx, h) = fixture(json!({"subscription":created}));
    let result = c
        .create_webhook_subscription(&CreateWebhookSubscription {
            url: "https://example.test/hook".into(),
            events: None,
            version: None,
        })
        .await
        .unwrap();
    assert_eq!(result.subscription.secret, "private-secret");
    assert!(!format!("{result:?}").contains("private-secret"));
    let wire = check(rx, "POST /prefix/webhook-subscriptions");
    assert_eq!(
        serde_json::from_str::<Value>(wire.split_once("\r\n\r\n").unwrap().1).unwrap(),
        json!({"url":"https://example.test/hook"})
    );
    h.join().unwrap();
    let (c, rx, h) = fixture(json!({"subscription":sub}));
    c.update_webhook_subscription(
        "sub-a",
        &UpdateWebhookSubscription {
            is_active: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let wire = check(rx, "PATCH /prefix/webhook-subscriptions/sub-a");
    assert_eq!(
        serde_json::from_str::<Value>(wire.split_once("\r\n\r\n").unwrap().1).unwrap(),
        json!({"is_active":false})
    );
    h.join().unwrap();
    let (c, rx, h) = fixture(json!({"deleted":true,"id":"sub-a"}));
    assert!(
        c.delete_webhook_subscription("sub-a")
            .await
            .unwrap()
            .deleted
    );
    check(rx, "DELETE /prefix/webhook-subscriptions/sub-a");
    h.join().unwrap();
}
#[tokio::test]
async fn stream_fragmentation_names_multiline_and_close() {
    let body = ": heartbeat\r\n\r\nid: ignored\r\ndata: {\r\ndata: \"text\":\"hé😀\"}\r\n\r\nevent: error\ndata: {\"code\":\"slow\"}\n\nevent: close\rdata: {\"reconnect_with_since\":\"opaque\"}\r\rdata: {}\n\n";
    let (c, rx, h) = server(
        body.as_bytes().to_vec(),
        "200 OK",
        "text/event-stream; charset=utf-8",
        true,
        false,
    );
    let mut frames = Vec::new();
    c.stream_events(Some("a/b+="), |frame| {
        frames.push(frame);
        ControlFlow::Continue(())
    })
    .await
    .unwrap();
    assert_eq!(
        frames.iter().map(|f| f.event.as_str()).collect::<Vec<_>>(),
        ["message", "error", "close"]
    );
    assert_eq!(frames[0].data["text"], "hé😀");
    let wire = check(rx, "GET /prefix/events/stream?since=a%2Fb%2B%3D");
    assert!(wire.to_lowercase().contains("accept: text/event-stream"));
    h.join().unwrap();
}
#[tokio::test]
async fn stream_bounds_errors_eof_and_callback_stop() {
    for body in [
        b"data: not-json\n\n".to_vec(),
        b"data: \xff\n\n".to_vec(),
        vec![b'x'; 1024 * 1024 + 1],
        format!("{}data: {{}}\r\n\r\n", ":\r\n".repeat(400_000)).into_bytes(),
    ] {
        let (c, rx, h) = server(body, "200 OK", "text/event-stream", false, false);
        let e = c
            .stream_events(None, |_| panic!("must not emit"))
            .await
            .unwrap_err();
        assert_eq!(e.code, "invalid_event_stream");
        assert_eq!(e.status, Some(502));
        check(rx, "GET /prefix/events/stream");
        h.join().unwrap();
    }
    for (status, content_type) in [
        ("307 Temporary Redirect", "text/event-stream"),
        ("200 OK", "application/json"),
    ] {
        let (c, rx, h) = server(b"{}".to_vec(), status, content_type, false, false);
        assert_eq!(
            c.stream_events(None, |_| panic!()).await.unwrap_err().code,
            "stream_unavailable"
        );
        check(rx, "GET /prefix/events/stream");
        h.join().unwrap();
    }
    let (c, rx, h) = server(
        b"data: {}\n".to_vec(),
        "200 OK",
        "text/event-stream",
        false,
        false,
    );
    c.stream_events(None, |_| panic!("incomplete frame"))
        .await
        .unwrap();
    check(rx, "GET /prefix/events/stream");
    h.join().unwrap();
    let (c, rx, h) = server(
        b"data: {}\n\ndata: {}\n\n".to_vec(),
        "200 OK",
        "text/event-stream",
        false,
        false,
    );
    let mut count = 0;
    c.stream_events(None, |_| {
        count += 1;
        ControlFlow::Break(())
    })
    .await
    .unwrap();
    assert_eq!(count, 1);
    check(rx, "GET /prefix/events/stream");
    h.join().unwrap();
}
#[tokio::test]
async fn opaque_queries_round_trip_and_crlf_frames_have_independent_byte_limits() {
    let token = "% %2F /+ =& hé";
    let encoded = "%25+%252F+%2F%2B+%3D%26+h%C3%A9";
    let (c, rx, h) = fixture(json!({"events":[],"count":0,"next_cursor":null}));
    c.list_events(&EventListOptions {
        since: Some(token),
        cursor: Some(token),
        ..Default::default()
    })
    .await
    .unwrap();
    check(
        rx,
        &format!("GET /prefix/events?since={encoded}&cursor={encoded}"),
    );
    h.join().unwrap();

    // Each frame is exactly 1 MiB including both bytes of both CRLF delimiters.
    let suffix = "\r\ndata: {}\r\n\r\n";
    let frame = format!(":{}{suffix}", "x".repeat(1024 * 1024 - 1 - suffix.len()));
    assert_eq!(frame.len(), 1024 * 1024);
    let (c, rx, h) = server(
        frame.repeat(2).into_bytes(),
        "200 OK",
        "text/event-stream",
        false,
        false,
    );
    let mut count = 0;
    c.stream_events(Some(token), |_| {
        count += 1;
        ControlFlow::Continue(())
    })
    .await
    .unwrap();
    assert_eq!(count, 2);
    check(rx, &format!("GET /prefix/events/stream?since={encoded}"));
    h.join().unwrap();
}

#[tokio::test]
async fn final_lf_is_validated_before_any_message_or_close_callback() {
    for event in ["message", "close"] {
        for split in [false, true] {
            let suffix = format!("\r\nevent: {event}\r\ndata: {{}}\r\n\r\n");
            let body = format!(":{}{suffix}", "x".repeat(1024 * 1024 - suffix.len()));
            assert_eq!(body.len(), 1024 * 1024 + 1);
            let (c, rx, h) = server(
                body.into_bytes(),
                "200 OK",
                "text/event-stream",
                split,
                false,
            );
            let mut callbacks = 0;
            let result = c
                .stream_events(None, |_| {
                    callbacks += 1;
                    ControlFlow::Continue(())
                })
                .await;
            assert_eq!(callbacks, 0, "event={event}, split={split}");
            assert_eq!(result.unwrap_err().code, "invalid_event_stream");
            check(rx, "GET /prefix/events/stream");
            h.join().unwrap();
        }
    }
}

#[tokio::test]
async fn bare_cr_at_eof_completes_message_and_close_frames() {
    for event in ["message", "close"] {
        let body = format!("event: {event}\rdata: {{}}\r\r");
        let (c, rx, h) = server(
            body.into_bytes(),
            "200 OK",
            "text/event-stream",
            true,
            false,
        );
        let mut callbacks = 0;
        c.stream_events(None, |frame| {
            assert_eq!(frame.event, event);
            callbacks += 1;
            ControlFlow::Continue(())
        })
        .await
        .unwrap();
        assert_eq!(callbacks, 1);
        check(rx, "GET /prefix/events/stream");
        h.join().unwrap();
    }
}

#[tokio::test]
async fn dropping_stream_future_releases_socket() {
    let (c, rx, h) = server(
        b"data: {}\n\n".to_vec(),
        "200 OK",
        "text/event-stream",
        false,
        true,
    );
    let task =
        tokio::spawn(async move { c.stream_events(None, |_| ControlFlow::Continue(())).await });
    loop {
        if rx.try_recv().is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    h.join().unwrap();
}
