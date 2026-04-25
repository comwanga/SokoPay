//! Shared M-Pesa helpers used by the B2C payout handler.
//!
//! The STK Push buyer-checkout flow has been removed — SokoPay is a
//! Lightning-first non-custodial marketplace. This module now contains
//! only the Daraja IP allowlist utilities required by b2c.rs.

use axum::http::HeaderMap;

// ── Safaricom Daraja IP allowlist ─────────────────────────────────────────────
//
// Daraja's B2C result callbacks originate from Safaricom's known server IPs.
// Accepting callbacks only from these addresses prevents external actors from
// faking payout confirmations by POSTing crafted payloads to our result URL.
//
// Source: Safaricom Developer Portal (last verified 2024).
pub(crate) const SAFARICOM_IP_ALLOWLIST: &[&str] = &[
    "196.201.214.200",
    "196.201.214.206",
    "196.201.213.114",
    "196.201.214.207",
    "196.201.214.208",
    "196.201.213.44",
    "196.201.212.127",
    "196.201.212.138",
    "196.201.212.129",
    "196.201.212.136",
    "196.201.212.74",
    "196.201.212.69",
];

/// Extract the caller's IP from proxy-forwarded headers.
/// Uses the same trust order as `TrustedIpExtractor` in `routes/mod.rs`.
pub(crate) fn extract_caller_ip(headers: &HeaderMap) -> Option<String> {
    // CF-Connecting-IP or X-Real-IP (set by trusted proxies)
    if let Some(ip) = headers
        .get("CF-Connecting-IP")
        .or_else(|| headers.get("X-Real-IP"))
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(ip.to_string());
    }
    // Rightmost X-Forwarded-For entry (appended by the nearest proxy)
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next_back())
        .map(|s| s.trim().to_string())
}

/// Returns `true` if `ip` is in the Safaricom allowlist.
/// Set `MPESA_DISABLE_IP_FILTER=true` to bypass for local dev / ngrok tunnels.
pub(crate) fn is_allowed_daraja_ip(ip: &str) -> bool {
    SAFARICOM_IP_ALLOWLIST.contains(&ip)
}
