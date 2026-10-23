//! Read-only example. Credentials are read explicitly by this binary, never by the SDK.
use trychert_sdk::{ChertSdk, FaceTimeConfig, HttpMethod, IMessageConfig};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let messaging_url = match std::env::var("CHERT_IMESSAGE_URL") {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(error) => return Err(error.into()),
    };
    let messaging_key = std::env::var("CHERT_IMESSAGE_KEY")?;
    let tenant = std::env::var("CHERT_IMESSAGE_TENANT").ok();
    let facetime_url = match std::env::var("CHERT_FACETIME_URL") {
        Ok(value) => Some(value),
        Err(std::env::VarError::NotPresent) => None,
        Err(error) => return Err(error.into()),
    };
    let facetime_key = std::env::var("CHERT_FACETIME_KEY")?;
    let project = std::env::var("CHERT_FACETIME_PROJECT_ID")?;
    let mut imessage = IMessageConfig::new(&messaging_key);
    imessage.tenant = tenant.as_deref();
    if let Some(url) = messaging_url.as_deref() {
        imessage.base_url = url;
    }
    let mut facetime = FaceTimeConfig::new(&facetime_key, &project);
    if let Some(url) = facetime_url.as_deref() {
        facetime.base_url = url;
    }
    let sdk = ChertSdk::new(Some(imessage), Some(facetime))?;
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
