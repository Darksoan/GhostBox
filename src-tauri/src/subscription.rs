use crate::settings::{decrypt_secret_for_current_user, encrypt_secret_for_current_user};
use crate::settings::{read_binary_file, write_binary_file};
use serde::{Deserialize, Serialize};

const SUBSCRIPTION_STATUS_CACHE_FILE: &str = "subscription-status-cache.bin";
const DEFAULT_SUBSCRIPTION_API_URL: &str = "https://ghostbox-subscriptions.hella.workers.dev";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionInfo {
    status: String,
    is_premium: bool,
    plan_id: Option<String>,
    current_period_start: Option<String>,
    current_period_end: Option<String>,
    last_payment_id: Option<String>,
    updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionPayment {
    id: String,
    checkout_reference: String,
    checkout_id: Option<String>,
    steam_id: String,
    plan_id: String,
    amount_cents: u64,
    currency: String,
    status: String,
    hosted_checkout_url: Option<String>,
    created_at: String,
    updated_at: String,
    confirmed_at: Option<String>,
    stripe_checkout_session_id: Option<String>,
    stripe_invoice_id: Option<String>,
    stripe_payment_intent_id: Option<String>,
    stripe_subscription_id: Option<String>,
    provider: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionStatusResponse {
    steam_id: String,
    subscription: SubscriptionInfo,
    latest_payment: Option<SubscriptionPayment>,
    #[serde(default)]
    cached: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionCheckoutResponse {
    payment: Option<SubscriptionPayment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionRefreshResponse {
    payment: SubscriptionPayment,
    subscription: SubscriptionInfo,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionStatusCache {
    steam_id: String,
    subscription: SubscriptionInfo,
    latest_payment: Option<SubscriptionPayment>,
    cached_at: String,
}

fn subscription_api_url() -> String {
    for key in ["GHOSTBOX_SUBSCRIPTION_API_URL", "SUBSCRIPTION_API_URL"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim().trim_end_matches('/').to_string();
            if value.starts_with("https://") {
                return value;
            }
        }
    }
    for value in [
        option_env!("GHOSTBOX_SUBSCRIPTION_API_URL"),
        option_env!("SUBSCRIPTION_API_URL"),
    ]
    .into_iter()
    .flatten()
    {
        let value = value.trim().trim_end_matches('/').to_string();
        if value.starts_with("https://") {
            return value;
        }
    }
    DEFAULT_SUBSCRIPTION_API_URL.to_string()
}

fn valid_steam_id(value: &str) -> bool {
    let length = value.len();
    (15..=20).contains(&length) && value.chars().all(|character| character.is_ascii_digit())
}

fn cache_status(app: &tauri::AppHandle, status: &SubscriptionStatusResponse) -> Result<(), String> {
    let cache = SubscriptionStatusCache {
        steam_id: status.steam_id.clone(),
        subscription: status.subscription.clone(),
        latest_payment: status.latest_payment.clone(),
        cached_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };
    let payload = serde_json::to_string(&cache).map_err(|error| error.to_string())?;
    let encrypted = encrypt_secret_for_current_user(&payload)?;
    write_binary_file(app, SUBSCRIPTION_STATUS_CACHE_FILE, &encrypted)
}

fn load_cached_status(
    app: &tauri::AppHandle,
    steam_id: &str,
) -> Option<SubscriptionStatusResponse> {
    let bytes = read_binary_file(app, SUBSCRIPTION_STATUS_CACHE_FILE).ok()?;
    let payload = decrypt_secret_for_current_user(&bytes).ok()?;
    let cache = serde_json::from_str::<SubscriptionStatusCache>(&payload).ok()?;
    if cache.steam_id != steam_id {
        return None;
    }
    let mut subscription = cache.subscription;
    if subscription.is_premium {
        let still_active = subscription
            .current_period_end
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .is_some_and(|expires_at| expires_at.with_timezone(&chrono::Utc) > chrono::Utc::now());
        if !still_active {
            subscription.is_premium = false;
            subscription.status = "expired".to_string();
        }
    }

    Some(SubscriptionStatusResponse {
        steam_id: cache.steam_id,
        subscription,
        latest_payment: cache.latest_payment,
        cached: true,
    })
}

fn normalize_response_error(value: &serde_json::Value, fallback: String) -> String {
    value
        .get("error")
        .and_then(|value| value.as_str())
        .or_else(|| value.get("message").and_then(|value| value.as_str()))
        .unwrap_or(&fallback)
        .to_string()
}

async fn json_request<T>(
    request: reqwest::RequestBuilder,
) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let value = serde_json::from_str::<serde_json::Value>(&text)
        .unwrap_or_else(|_| serde_json::json!({ "error": text }));
    if !status.is_success() {
        return Err(normalize_response_error(
            &value,
            format!("Subscription API respondeu HTTP {status}"),
        ));
    }
    serde_json::from_value::<T>(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn subscription_get_status(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<SubscriptionStatusResponse, String> {
    let steam_id = steam_id.trim().to_string();
    if !valid_steam_id(&steam_id) {
        return Err("Steam ID inválido.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!(
        "{}/subscription/status?steamId={}",
        subscription_api_url(),
        steam_id
    );
    match json_request::<SubscriptionStatusResponse>(client.get(url)).await {
        Ok(mut status) => {
            status.cached = false;
            let _ = cache_status(&app, &status);
            Ok(status)
        }
        Err(error) => load_cached_status(&app, &steam_id).ok_or(error),
    }
}

#[tauri::command]
pub async fn subscription_create_checkout(
    steam_id: String,
    plan_id: String,
) -> Result<SubscriptionCheckoutResponse, String> {
    let steam_id = steam_id.trim().to_string();
    let plan_id = plan_id.trim().to_string();
    if !valid_steam_id(&steam_id) {
        return Err("Faça login com a Steam antes de assinar.".to_string());
    }
    if plan_id != "monthly" && plan_id != "quarterly" {
        return Err("Plano de assinatura inválido.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/subscription/checkouts", subscription_api_url());
    json_request::<SubscriptionCheckoutResponse>(
        client.post(url).json(&serde_json::json!({
            "steamId": steam_id,
            "planId": plan_id,
        })),
    )
    .await
}

#[tauri::command]
pub async fn subscription_refresh_status(
    app: tauri::AppHandle,
    checkout_id: String,
) -> Result<SubscriptionRefreshResponse, String> {
    let checkout_id = checkout_id.trim().to_string();
    if checkout_id.is_empty() {
        return Err("Checkout inválido.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!(
        "{}/subscription/refresh?checkoutId={}",
        subscription_api_url(),
        checkout_id
    );
    let refresh = json_request::<SubscriptionRefreshResponse>(client.post(url)).await?;
    let status = SubscriptionStatusResponse {
        steam_id: refresh.payment.steam_id.clone(),
        subscription: refresh.subscription.clone(),
        latest_payment: Some(refresh.payment.clone()),
        cached: false,
    };
    let _ = cache_status(&app, &status);
    Ok(refresh)
}
