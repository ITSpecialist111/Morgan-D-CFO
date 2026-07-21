#pragma once

// Copy to secrets.h using scripts/configure-badge.ps1. Never commit secrets.h.
namespace BadgeSecrets {
constexpr char kWifiSsid[] = "YOUR_WIFI_SSID";
constexpr char kWifiPassword[] = "YOUR_WIFI_PASSWORD";
constexpr char kApiHost[] = "morganfinanceagent-webapp.azurewebsites.net";
constexpr uint16_t kApiPort = 443;
constexpr char kApiKey[] = "GENERATE_A_RANDOM_32_BYTE_OR_LONGER_KEY";
}  // namespace BadgeSecrets
