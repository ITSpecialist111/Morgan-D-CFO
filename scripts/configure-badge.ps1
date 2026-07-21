[CmdletBinding()]
param(
    [string]$ApiHost = 'morganfinanceagent-webapp.azurewebsites.net',
    [ValidateRange(1, 65535)]
    [int]$ApiPort = 443
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$firmwareSecretsPath = Join-Path $repoRoot 'firmware\morgan_badge\secrets.h'
$serverEnvironmentPath = Join-Path $repoRoot '.env.badge.local'

function ConvertTo-CppStringLiteral {
    param([Parameter(Mandatory)][string]$Value)

    return $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
}

$wifiSsid = Read-Host 'Wi-Fi SSID'
if ([string]::IsNullOrWhiteSpace($wifiSsid)) {
    throw 'Wi-Fi SSID cannot be empty.'
}

$secureWifiPassword = Read-Host 'Wi-Fi password' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$wifiPassword = $null

try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureWifiPassword)
    $wifiPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ([string]::IsNullOrEmpty($wifiPassword)) {
        throw 'Wi-Fi password cannot be empty.'
    }

    $badgeApiKey = [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    ).ToLowerInvariant()

    $firmwareContents = @"
#pragma once

// Generated locally by scripts/configure-badge.ps1. This file is gitignored.
namespace BadgeSecrets {
constexpr char kWifiSsid[] = "$(ConvertTo-CppStringLiteral $wifiSsid)";
constexpr char kWifiPassword[] = "$(ConvertTo-CppStringLiteral $wifiPassword)";
constexpr char kApiHost[] = "$(ConvertTo-CppStringLiteral $ApiHost)";
constexpr uint16_t kApiPort = $ApiPort;
constexpr char kApiKey[] = "$badgeApiKey";
}  // namespace BadgeSecrets
"@

    $serverEnvironmentContents = @"
# Generated locally by scripts/configure-badge.ps1. This file is gitignored.
MORGAN_BADGE_API_KEY=$badgeApiKey
"@

    [IO.File]::WriteAllText($firmwareSecretsPath, $firmwareContents, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($serverEnvironmentPath, $serverEnvironmentContents, [Text.UTF8Encoding]::new($false))

    Write-Host 'Badge Wi-Fi and API credentials were written locally.'
    Write-Host 'Created firmware/morgan_badge/secrets.h and .env.badge.local (both gitignored).'
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $wifiPassword = $null
    $secureWifiPassword = $null
}