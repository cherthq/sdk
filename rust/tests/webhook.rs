use trychert_sdk::webhook::{
    verify_facetime_signature, verify_messaging_signature, WebhookSignatureError, TOLERANCE_SECS,
};

const BODY: &[u8] = br#"{"event_id":"e1"}"#;
const MESSAGING: &str = "8a9b910184f1d9ed3590e106c991e230a182f3b9356c7c1ed91c013d17ed0775";
const FACETIME: &str = "606be14f4ad74c0185dd68d7cf5e8d9f5752f0a67ef0f5d00b22a50a4b8a5956";
const AT: i64 = 1_700_000_000;

#[test]
fn messaging_signatures_accept_both_header_formats() {
    let modern = format!("t={AT},v1={MESSAGING}");
    let legacy = format!("v1,{AT},{MESSAGING}");
    for header in [&modern, &legacy, &format!(" {modern} ")] {
        assert_eq!(
            verify_messaging_signature(header, BODY, "whsec_test", AT + 10),
            Ok(())
        );
    }
    let upper = format!("t={AT},v1={}", MESSAGING.to_ascii_uppercase());
    assert_eq!(
        verify_messaging_signature(&upper, BODY, "whsec_test", AT),
        Ok(())
    );
}

#[test]
fn messaging_signatures_fail_closed() {
    let modern = format!("t={AT},v1={MESSAGING}");
    use WebhookSignatureError::*;
    for (header, body, secret, now, want) in [
        (modern.as_str(), BODY, "other", AT, Mismatch),
        (
            modern.as_str(),
            br#"{"event_id":"e2"}"#.as_slice(),
            "whsec_test",
            AT,
            Mismatch,
        ),
        (modern.as_str(), BODY, "", AT, Mismatch),
        (
            modern.as_str(),
            BODY,
            "whsec_test",
            AT + TOLERANCE_SECS + 1,
            Stale,
        ),
        (
            modern.as_str(),
            BODY,
            "whsec_test",
            AT - TOLERANCE_SECS - 1,
            Stale,
        ),
        ("", BODY, "whsec_test", AT, Malformed),
        ("t=1700000000,v1=zz", BODY, "whsec_test", AT, Malformed),
        ("v2,1700000000,00", BODY, "whsec_test", AT, Malformed),
        ("t=-1,v1=00", BODY, "whsec_test", AT, Malformed),
    ] {
        assert_eq!(
            verify_messaging_signature(header, body, secret, now),
            Err(want),
            "{header}"
        );
    }
    let moved = modern.replacen("t=1700000000", "t=1700000001", 1);
    assert_eq!(
        verify_messaging_signature(&moved, BODY, "whsec_test", AT),
        Err(Mismatch)
    );
    let plus = format!("t={AT},v1=+{}", &MESSAGING[1..]);
    assert_eq!(
        verify_messaging_signature(&plus, BODY, "whsec_test", AT),
        Err(Malformed)
    );
    assert_eq!(
        verify_messaging_signature(&modern, BODY, "whsec_test", AT + TOLERANCE_SECS),
        Ok(())
    );
}

#[test]
fn facetime_signatures_cover_the_raw_body() {
    let header = format!("sha256={FACETIME}");
    assert_eq!(verify_facetime_signature(&header, BODY, "fts_test"), Ok(()));
    use WebhookSignatureError::*;
    assert_eq!(
        verify_facetime_signature(&header, BODY, "other"),
        Err(Mismatch)
    );
    assert_eq!(
        verify_facetime_signature(&header, b"{}", "fts_test"),
        Err(Mismatch)
    );
    assert_eq!(verify_facetime_signature(&header, BODY, ""), Err(Mismatch));
    assert_eq!(
        verify_facetime_signature("", BODY, "fts_test"),
        Err(Malformed)
    );
    assert_eq!(
        verify_facetime_signature("md5=00", BODY, "fts_test"),
        Err(Malformed)
    );
    for header in [
        format!("sha256={}", FACETIME.to_uppercase()),
        format!(" sha256={FACETIME}"),
        format!("sha256={FACETIME}\n"),
    ] {
        assert_eq!(
            verify_facetime_signature(&header, BODY, "fts_test"),
            Err(Malformed)
        );
    }
    assert!(!format!("{:?}", Mismatch).contains("fts_test"));
}
