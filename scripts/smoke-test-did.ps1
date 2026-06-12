#!/usr/bin/env pwsh
# Smoke tests for Morgan Digital CFO D-ID avatar deployment
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# Target the Digital CFO web app. Override with BASE_URL or MORGAN_AGENT_URL when testing another slot.
$base = if ($env:BASE_URL) { $env:BASE_URL.TrimEnd('/') }
  elseif ($env:MORGAN_AGENT_URL) { $env:MORGAN_AGENT_URL.TrimEnd('/') }
  else { 'https://morganfinanceagent-webapp.azurewebsites.net' }
$bearer = ''
if (Test-Path .env) {
  $bearerLine = (Select-String -Path .env -Pattern '^BEARER_TOKEN=' -SimpleMatch | Select-Object -First 1).Line
  if ($bearerLine) { $bearer = $bearerLine -replace '^BEARER_TOKEN=', '' }
}
$auth = @{ Authorization = "Bearer $bearer" }
$results = @()

Write-Host "Base URL: $base" -ForegroundColor Cyan

function Probe {
  param([string]$Label, [string]$Url, [hashtable]$Headers, [int]$TimeoutSec = 30)
  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  Write-Host "    GET $Url"
  try {
    $r = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec $TimeoutSec
    Write-Host "    HTTP $($r.StatusCode)" -ForegroundColor Green
    return @{ ok = $true; status = $r.StatusCode; body = $r.Content; headers = $r.Headers; label = $Label }
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Write-Host "    HTTP $code  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $bodyText = ''
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $bodyText = $reader.ReadToEnd()
    } catch {}
    return @{ ok = $false; status = $code; body = $bodyText; label = $Label }
  }
}

# 1. D-ID status / config-status (auth required)
$r1 = Probe '[1/6] D-ID status' "$base/api/avatar/did/status" $auth 30
if ($r1.ok) { Write-Host "    Body: $($r1.body)" }

# 2. D-ID config (auth required)
$r2 = Probe '[2/6] D-ID config' "$base/api/avatar/did/config" $auth 30
if ($r2.ok) {
  try {
    $j = $r2.body | ConvertFrom-Json
    Write-Host "    configured     : $($j.configured)"
    Write-Host "    agentId        : $($j.agentId)"
    Write-Host "    clientKey set  : $([bool]$j.clientKey)"
    Write-Host "    backgroundUrl  : $($j.backgroundUrl)"
    Write-Host "    presenter.id   : $($j.presenter.id)"
    Write-Host "    voice.id       : $($j.voice.id)"
  } catch { Write-Host "    JSON parse failed; raw body: $($r2.body)" }
}

# 3. D-ID verify (auth required)
$r3 = Probe '[3/6] D-ID verify' "$base/api/avatar/did/verify" $auth 60
if ($r3.ok) {
  try {
    $j = $r3.body | ConvertFrom-Json
    Write-Host "    verified : $($j.verified)"
    if ($j.issues) { Write-Host "    issues   : $($j.issues -join '; ')" }
    if ($j.checks) { Write-Host "    checks   : $($j.checks | ConvertTo-Json -Compress)" }
  } catch { Write-Host "    Raw body: $($r3.body.Substring(0, [Math]::Min(400, $r3.body.Length)))" }
}

# 4. D-ID HTML page (no auth)
$r4 = Probe '[4/6] /voice/did HTML' "$base/voice/did" @{} 30
if ($r4.ok) {
  $titleMatch = [regex]::Match($r4.body, '<title>([^<]+)</title>')
  Write-Host "    Length         : $($r4.body.Length) bytes"
  Write-Host "    Title          : $($titleMatch.Groups[1].Value)"
  Write-Host "    Has D-ID SDK   : $($r4.body -match 'client-sdk@latest')"
  Write-Host "    Has /did/config: $($r4.body -match '/api/avatar/did/config')"
}

# 5. Mission Control HTML (no auth)
$r5 = Probe '[5/6] /mission-control HTML' "$base/mission-control" @{} 30
if ($r5.ok) {
  Write-Host "    Length         : $($r5.body.Length) bytes"
  Write-Host "    Has toggle tag : $($r5.body -match 'avatar-toggle-ui\.js')"
}

# 6. Avatar toggle JS (no auth)
$r6 = Probe '[6/6] avatar-toggle-ui.js' "$base/mission-control/avatar-toggle-ui.js" @{} 30
if ($r6.ok) {
  Write-Host "    Length         : $($r6.body.Length) bytes"
  Write-Host "    Content-Type   : $($r6.headers.'Content-Type')"
  Write-Host "    Has injector   : $($r6.body -match 'injectAvatarToggle')"
  Write-Host "    Has /voice/did : $($r6.body -match '/voice/did')"
}

# Summary
$all = @($r1, $r2, $r3, $r4, $r5, $r6)
$pass = ($all | Where-Object { $_.ok }).Count
$fail = ($all | Where-Object { -not $_.ok }).Count
Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  SMOKE TEST SUMMARY: $pass passed, $fail failed" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow
