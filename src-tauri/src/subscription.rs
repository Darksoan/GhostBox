use crate::cloud_save::session_token;
use crate::settings::{decrypt_secret_for_current_user, encrypt_secret_for_current_user};
use crate::settings::{read_binary_file, write_binary_file};
use base64::Engine;
use serde::{Deserialize, Serialize};

const SUBSCRIPTION_STATUS_CACHE_FILE: &str = "subscription-status-cache.bin";
const DEFAULT_SUBSCRIPTION_API_URL: &str = "https://ghostbox-subscriptions.hella.workers.dev";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionPaymentMethod {
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    brand: Option<String>,
    #[serde(default)]
    last4: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionInfo {
    status: String,
    is_premium: bool,
    plan_id: Option<String>,
    current_period_start: Option<String>,
    current_period_end: Option<String>,
    last_payment_id: Option<String>,
    #[serde(default)]
    cancel_at_period_end: Option<bool>,
    updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionPayment {
    id: String,
    checkout_reference: String,
    checkout_id: Option<String>,
    #[serde(default)]
    steam_id: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
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
pub(crate) struct DiscordLinkStatus {
    linked: bool,
    discord_user_id: Option<String>,
    discord_username: Option<String>,
    discord_global_name: Option<String>,
    linked_at: Option<String>,
    #[serde(default)]
    premium_role: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionStatusResponse {
    user_id: String,
    #[serde(default)]
    steam_id: Option<String>,
    subscription: SubscriptionInfo,
    latest_payment: Option<SubscriptionPayment>,
    #[serde(default)]
    payment_method: Option<SubscriptionPaymentMethod>,
    #[serde(default)]
    discord_link: Option<DiscordLinkStatus>,
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
pub(crate) struct SubscriptionPortalResponse {
    url: String,
    flow: String,
    #[serde(default)]
    customer_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionRefreshResponse {
    payment: SubscriptionPayment,
    subscription: SubscriptionInfo,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscordLinkStartResponse {
    url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscriptionStatusCache {
    user_id: String,
    #[serde(default)]
    steam_id: Option<String>,
    subscription: SubscriptionInfo,
    latest_payment: Option<SubscriptionPayment>,
    #[serde(default)]
    payment_method: Option<SubscriptionPaymentMethod>,
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

fn cache_status(app: &tauri::AppHandle, status: &SubscriptionStatusResponse) -> Result<(), String> {
    let cache = SubscriptionStatusCache {
        user_id: status.user_id.clone(),
        steam_id: status.steam_id.clone(),
        subscription: status.subscription.clone(),
        latest_payment: status.latest_payment.clone(),
        payment_method: status.payment_method.clone(),
        cached_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };
    let payload = serde_json::to_string(&cache).map_err(|error| error.to_string())?;
    let encrypted = encrypt_secret_for_current_user(&payload)?;
    write_binary_file(app, SUBSCRIPTION_STATUS_CACHE_FILE, &encrypted)
}

fn load_cached_status(app: &tauri::AppHandle, user_id: &str) -> Option<SubscriptionStatusResponse> {
    let bytes = read_binary_file(app, SUBSCRIPTION_STATUS_CACHE_FILE).ok()?;
    let payload = decrypt_secret_for_current_user(&bytes).ok()?;
    let cache = serde_json::from_str::<SubscriptionStatusCache>(&payload).ok()?;
    if cache.user_id != user_id {
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
        user_id: cache.user_id,
        steam_id: cache.steam_id,
        payment_method: cache.payment_method,
        subscription,
        latest_payment: cache.latest_payment,
        discord_link: None,
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

async fn json_request<T>(request: reqwest::RequestBuilder) -> Result<T, String>
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
) -> Result<SubscriptionStatusResponse, String> {
    let token = session_token(&app)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/subscription/status", subscription_api_url());
    match json_request::<SubscriptionStatusResponse>(client.get(url).bearer_auth(&token)).await {
        Ok(mut status) => {
            status.cached = false;
            let _ = cache_status(&app, &status);
            Ok(status)
        }
        Err(error) => {
            // The token itself decodes the userId, so a cached lookup only
            // needs it as a cache key, not another auth check.
            let user_id = decode_session_user_id(&token).unwrap_or_default();
            load_cached_status(&app, &user_id).ok_or(error)
        }
    }
}

#[tauri::command]
pub async fn subscription_create_checkout(
    app: tauri::AppHandle,
    plan_id: String,
) -> Result<SubscriptionCheckoutResponse, String> {
    let token = session_token(&app)?;
    let plan_id = plan_id.trim().to_string();
    if plan_id != "monthly" && plan_id != "quarterly" {
        return Err("Plano de assinatura inválido.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/subscription/checkouts", subscription_api_url());
    json_request::<SubscriptionCheckoutResponse>(
        client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "planId": plan_id })),
    )
    .await
}

#[tauri::command]
pub async fn subscription_create_portal_session(
    app: tauri::AppHandle,
    flow: Option<String>,
) -> Result<SubscriptionPortalResponse, String> {
    let token = session_token(&app)?;
    let flow = flow.unwrap_or_else(|| "manage".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/subscription/portal", subscription_api_url());
    json_request::<SubscriptionPortalResponse>(
        client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "flow": flow })),
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
    if let Some(user_id) = refresh.payment.user_id.clone() {
        let status = SubscriptionStatusResponse {
            user_id,
            steam_id: refresh.payment.steam_id.clone(),
            subscription: refresh.subscription.clone(),
            latest_payment: Some(refresh.payment.clone()),
            payment_method: None,
            discord_link: None,
            cached: false,
        };
        let _ = cache_status(&app, &status);
    }
    Ok(refresh)
}

#[tauri::command]
pub async fn discord_link_start(app: tauri::AppHandle) -> Result<DiscordLinkStartResponse, String> {
    let token = session_token(&app)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/discord/link", subscription_api_url());
    json_request::<DiscordLinkStartResponse>(client.post(url).bearer_auth(token)).await
}

#[tauri::command]
pub async fn discord_link_status(app: tauri::AppHandle) -> Result<DiscordLinkStatus, String> {
    let token = session_token(&app)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("{}/discord/link-status", subscription_api_url());
    json_request::<DiscordLinkStatus>(client.get(url).bearer_auth(token)).await
}

/// The session token's payload is `base64url(json).signature` — decode just
/// enough to read `userId` for cache lookups, without re-verifying the HMAC
/// (the worker already did that; this is only a local cache key).
fn decode_session_user_id(token: &str) -> Option<String> {
    let payload = token.split('.').next()?;
    let padded_len = (payload.len() + 3) / 4 * 4;
    let mut padded = payload.replace('-', "+").replace('_', "/");
    while padded.len() < padded_len {
        padded.push('=');
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(padded)
        .ok()?;
    let value = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
    value
        .get("userId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}
