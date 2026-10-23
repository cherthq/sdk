//! Test-only joined HTTP fixture CLI. Arguments must contain synthetic credentials only.
use serde_json::{json, Value};
use std::{process::ExitCode, time::Duration};
use trychert_sdk::{ChertClient, HttpMethod};

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("expected synthetic fixture BASE_URL API_KEY");
        return ExitCode::FAILURE;
    }
    let client = match ChertClient::new(
        &args[1],
        &args[2],
        Some("fixture-tenant"),
        Duration::from_secs(5),
        1024 * 1024,
    ) {
        Ok(client) => client,
        Err(_) => {
            eprintln!("invalid fixture configuration");
            return ExitCode::FAILURE;
        }
    };
    let output = match client
        .request::<Value>("/phone-numbers", HttpMethod::GET, None)
        .await
    {
        Ok(data) => json!({"ok": true, "data": data}),
        Err(error) => {
            json!({"ok": false, "status": error.status, "code": error.code, "display": error.to_string()})
        }
    };
    println!("{output}");
    ExitCode::SUCCESS
}
