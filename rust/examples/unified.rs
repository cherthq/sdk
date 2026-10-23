//! Read-only example. Credentials are read explicitly by this binary, never by the SDK.
use trychert_sdk::{ChertSdk, FaceTimeConfig, HttpMethod, IMessageConfig, TransportLimits};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let messaging_url = std::env::var("CHERT_IMESSAGE_URL")?;
    let messaging_key = std::env::var("CHERT_IMESSAGE_KEY")?;
    let tenant = std::env::var("CHERT_IMESSAGE_TENANT").ok();
    let facetime_url = std::env::var("CHERT_FACETIME_URL")?;
    let facetime_key = std::env::var("CHERT_FACETIME_KEY")?;
    let project = std::env::var("CHERT_FACETIME_PROJECT_ID")?;
    let sdk = ChertSdk::new(
        Some(IMessageConfig {
            base_url: &messaging_url,
            api_key: &messaging_key,
            tenant: tenant.as_deref(),
            limits: TransportLimits::default(),
        }),
        Some(FaceTimeConfig {
            base_url: &facetime_url,
            api_key: &facetime_key,
            project_id: &project,
            limits: TransportLimits::default(),
        }),
    )?;
    if let Some(imessage) = sdk.imessage {
        let _: serde_json::Value = imessage
            .request("/phone-numbers", HttpMethod::GET, None)
            .await?;
        println!("Messaging phone-number query succeeded; content omitted");
    }
    if let Some(facetime) = sdk.facetime {
        let calls = facetime.list_calls(10, 0).await?;
        println!(
            "FaceTime returned {} call snapshots; content omitted",
            calls.data.items.len()
        );
    }
    Ok(())
}
