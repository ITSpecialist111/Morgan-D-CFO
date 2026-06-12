param(
  [string]$ResourceGroup = 'rg-morgan-finance-agent',
  [string]$WebApp = 'morganfinanceagent-webapp',
  [string]$ForbiddenWebApp = 'morgan-ecif-director-webapp',
  [string]$Domain = $(if ($env:MORGAN_TENANT_DOMAIN) { $env:MORGAN_TENANT_DOMAIN } else { '<your-tenant>.onmicrosoft.com' }),
  [string]$ResourceAccountLocalPart = 'morgan-cfo-tpe',
  [string]$DisplayName = 'Morgan Digital CFO',
  [string]$BotServiceName = 'morgan-cfo-tpe-bot',
  [string]$BotServiceDisplayName = 'Morgan Digital CFO Teams Phone Bot',
  [string]$BotServiceSku = 'S1',
  [string]$BotServiceLocation = 'global',
  [string]$GeneratedConfigPath = 'a365.generated.config.json',
  [switch]$SkipBotServiceRegistration,
  [switch]$AssignPhoneResourceAccountLicense
)

$ErrorActionPreference = 'Stop'

function ConvertTo-RedactedText {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  $clean = $Value -replace '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b', '[guid]'
  $clean = $clean -replace '(?i)(secret|token|password|connectionstring|connection string|apikey|api[_-]?key|client[_-]?secret|authorization|bearer|sas=|sig=)[^\s,;]*', '[redacted]'
  if ($clean.Length -gt 220) { return $clean.Substring(0, 220) + '...' }
  return $clean
}

function Get-JsonValue {
  param($Object, [string]$Key)
  if ($null -eq $Object) { return $null }
  if ($Object -is [System.Array]) {
    foreach ($item in $Object) {
      $result = Get-JsonValue -Object $item -Key $Key
      if ($null -ne $result) { return $result }
    }
    return $null
  }
  if ($Object -is [pscustomobject]) {
    foreach ($property in $Object.PSObject.Properties) {
      if ($property.Name -ieq $Key) { return $property.Value }
      $result = Get-JsonValue -Object $property.Value -Key $Key
      if ($null -ne $result) { return $result }
    }
  }
  return $null
}

function New-AcsHmacHeaders {
  param(
    [string]$Method,
    [string]$RequestUri,
    [string]$RequestBody,
    [string]$AccessKey
  )

  $uri = [Uri]$RequestUri
  $date = [DateTime]::UtcNow.ToString('r', [Globalization.CultureInfo]::InvariantCulture)
  $bodyBytes = [Text.Encoding]::UTF8.GetBytes($RequestBody)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $contentHash = [Convert]::ToBase64String($sha.ComputeHash($bodyBytes))
  $stringToSign = $Method.ToUpperInvariant() + "`n" + $uri.PathAndQuery + "`n" + $date + ';' + $uri.Authority + ';' + $contentHash
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Convert]::FromBase64String($AccessKey))
  $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($stringToSign)))

  return @{
    'x-ms-date' = $date
    'x-ms-content-sha256' = $contentHash
    'Authorization' = "HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=$signature"
  }
}

if ($WebApp -eq $ForbiddenWebApp) {
  throw "Refusing forbidden web app target '$ForbiddenWebApp'."
}

foreach ($commandName in @('Get-CsOnlineApplicationInstance', 'New-CsOnlineApplicationInstance', 'Set-CsOnlineApplicationInstance', 'Sync-CsOnlineApplicationInstance')) {
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "Required Teams PowerShell cmdlet '$commandName' is not available."
  }
}

if (-not (Test-Path $GeneratedConfigPath)) {
  throw "Generated Agent 365 config not found at '$GeneratedConfigPath'."
}

$generatedConfig = Get-Content $GeneratedConfigPath -Raw | ConvertFrom-Json
$applicationId = [string](Get-JsonValue -Object $generatedConfig -Key 'botMsaAppId')
if ($applicationId -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'Morgan bot application id is missing or not GUID-shaped.'
}

$tenantId = [string](az account show --query tenantId -o tsv)
if ($LASTEXITCODE -ne 0 -or $tenantId -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'Azure tenant id was not available.'
}

$messagingEndpoint = [string](Get-JsonValue -Object $generatedConfig -Key 'messagingEndpoint')
if ([string]::IsNullOrWhiteSpace($messagingEndpoint)) {
  $messagingEndpoint = "https://$WebApp.azurewebsites.net/api/messages"
}

$settings = az webapp config appsettings list --resource-group $ResourceGroup --name $WebApp --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read app settings for '$WebApp'."
}

$acsResourceId = [string](($settings | Where-Object name -eq 'ACS_TEAMS_FEDERATION_RESOURCE_ID' | Select-Object -First 1).value)
if ($acsResourceId -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'ACS_TEAMS_FEDERATION_RESOURCE_ID is missing or not GUID-shaped.'
}

$acsConnectionString = [string](($settings | Where-Object name -eq 'ACS_CONNECTION_STRING' | Select-Object -First 1).value)
if ([string]::IsNullOrWhiteSpace($acsConnectionString)) {
  throw 'ACS_CONNECTION_STRING is missing.'
}

if (-not $SkipBotServiceRegistration) {
  Write-Output 'BOT_SERVICE ensure Azure Bot registration'
  $botExists = $false
  $existingBot = az bot show --resource-group $ResourceGroup --name $BotServiceName --query name -o tsv 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingBot)) { $botExists = $true }

  if ($botExists) {
    Write-Output 'BOT_SERVICE reused'
  } else {
    az bot create `
      --resource-group $ResourceGroup `
      --name $BotServiceName `
      --appid $applicationId `
      --app-type SingleTenant `
      --tenant-id $tenantId `
      --location $BotServiceLocation `
      --sku $BotServiceSku `
      --display-name $BotServiceDisplayName `
      --description 'Morgan Digital CFO Teams Phone Extensibility bot registration' `
      --endpoint $messagingEndpoint `
      --output none
    if ($LASTEXITCODE -ne 0) { throw 'Bot Service registration failed.' }
    Write-Output 'BOT_SERVICE created'
  }

  $teamsChannel = az bot msteams show --resource-group $ResourceGroup --name $BotServiceName -o json 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($teamsChannel)) {
    Write-Output 'BOT_SERVICE_TEAMS_CHANNEL present'
  } else {
    az bot msteams create --resource-group $ResourceGroup --name $BotServiceName --output none
    if ($LASTEXITCODE -ne 0) { throw 'Bot Service Microsoft Teams channel registration failed.' }
    Write-Output 'BOT_SERVICE_TEAMS_CHANNEL created'
  }
}

$resourceAccountUpn = "$ResourceAccountLocalPart@$Domain"
Write-Output "TPE_INPUTS appIdShape=guid acsResourceIdShape=guid resourceAccountUpn=$resourceAccountUpn"

$instance = $null
try {
  $instance = Get-CsOnlineApplicationInstance -Identity $resourceAccountUpn -ErrorAction Stop
} catch {
  $instance = $null
}

if (-not $instance) {
  $candidateInstances = @(Get-CsOnlineApplicationInstance | Where-Object {
      ([string]$_.DisplayName -eq $DisplayName) -or ([string]$_.UserPrincipalName -eq $resourceAccountUpn)
    })
  if ($candidateInstances.Count -gt 0) { $instance = $candidateInstances[0] }
}

if ($instance) {
  Write-Output ("TPE_RESOURCE_ACCOUNT reused name={0} upn={1}" -f (ConvertTo-RedactedText ([string]$instance.DisplayName)), (ConvertTo-RedactedText ([string]$instance.UserPrincipalName)))
} else {
  Write-Output 'TPE_RESOURCE_ACCOUNT creating'
  New-CsOnlineApplicationInstance -UserPrincipalName $resourceAccountUpn -ApplicationId $applicationId -DisplayName $DisplayName -ErrorAction Stop | Out-Null
  $instance = Get-CsOnlineApplicationInstance -Identity $resourceAccountUpn -ErrorAction Stop
  Write-Output ("TPE_RESOURCE_ACCOUNT created name={0} upn={1}" -f (ConvertTo-RedactedText ([string]$instance.DisplayName)), (ConvertTo-RedactedText ([string]$instance.UserPrincipalName)))
}

$resourceAccountObjectId = [string]$instance.ObjectId
if ($resourceAccountObjectId -notmatch '^[0-9a-fA-F-]{36}$') { $resourceAccountObjectId = [string]$instance.Id }
if ($resourceAccountObjectId -notmatch '^[0-9a-fA-F-]{36}$') {
  throw 'Teams resource account object id was not available after create/reuse.'
}

Write-Output 'TPE_LINK set-csonlineapplicationinstance'
Set-CsOnlineApplicationInstance -Identity $resourceAccountUpn -ApplicationId $applicationId -AcsResourceId $acsResourceId -ErrorAction Stop | Out-Null

Write-Output 'TPE_SYNC sync-csonlineapplicationinstance'
Sync-CsOnlineApplicationInstance -ObjectId $resourceAccountObjectId -ApplicationId $applicationId -AcsResourceId $acsResourceId -ErrorAction Stop | Out-Null

$endpointMatch = [regex]::Match($acsConnectionString, '(?i)(?:^|;)endpoint=(https://[^;]+)')
$accessKeyMatch = [regex]::Match($acsConnectionString, '(?i)(?:^|;)accesskey=([^;]+)')
if (-not $endpointMatch.Success -or -not $accessKeyMatch.Success) {
  throw 'ACS connection string endpoint/accesskey was not available for server consent.'
}

$acsEndpoint = $endpointMatch.Groups[1].Value.TrimEnd('/')
$acsAccessKey = $accessKeyMatch.Groups[1].Value
$consentBody = '{"principalType":"teamsResourceAccount"}'
$consentUri = "$acsEndpoint/access/teamsExtension/tenants/$tenantId/assignments/$resourceAccountObjectId`?api-version=2025-06-30"
Write-Output 'ACS_SERVER_CONSENT put teamsResourceAccount assignment'
$putHeaders = New-AcsHmacHeaders -Method 'PUT' -RequestUri $consentUri -RequestBody $consentBody -AccessKey $acsAccessKey
$putResponse = Invoke-WebRequest -UseBasicParsing -Method Put -Uri $consentUri -Headers $putHeaders -ContentType 'application/json' -Body $consentBody -TimeoutSec 60 -SkipHttpErrorCheck
Write-Output ("ACS_SERVER_CONSENT_PUT http={0}" -f [int]$putResponse.StatusCode)
if ([int]$putResponse.StatusCode -lt 200 -or [int]$putResponse.StatusCode -ge 300) {
  throw ('ACS Teams Extension server consent failed: ' + (ConvertTo-RedactedText $putResponse.Content))
}

$getHeaders = New-AcsHmacHeaders -Method 'GET' -RequestUri $consentUri -RequestBody '' -AccessKey $acsAccessKey
$getResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $consentUri -Headers $getHeaders -TimeoutSec 60 -SkipHttpErrorCheck
Write-Output ("ACS_SERVER_CONSENT_GET http={0}" -f [int]$getResponse.StatusCode)
if ([int]$getResponse.StatusCode -ne 200) {
  throw ('ACS Teams Extension server consent verification failed: ' + (ConvertTo-RedactedText $getResponse.Content))
}

if ($AssignPhoneResourceAccountLicense) {
  Write-Output 'TPE_LICENSE checking Teams Phone Resource Account SKU'
  $licenseResult = 'not-attempted'
  try {
    $skuJson = az rest --method get --url 'https://graph.microsoft.com/v1.0/subscribedSkus' --query "value[?skuPartNumber=='PHONESYSTEM_VIRTUALUSER'].{skuId:skuId,enabled:prepaidUnits.enabled,consumed:consumedUnits}" -o json 2>$null | ConvertFrom-Json
    $sku = @($skuJson | Where-Object { [int]$_.enabled -gt [int]$_.consumed } | Select-Object -First 1)
    if ($sku -and $sku.skuId) {
      az rest --method patch --url ("https://graph.microsoft.com/v1.0/users/{0}" -f $resourceAccountUpn) --headers 'Content-Type=application/json' --body '{"usageLocation":"AU"}' --output none 2>$null
      $body = @{ addLicenses = @(@{ skuId = [string]$sku.skuId }); removeLicenses = @() } | ConvertTo-Json -Depth 6 -Compress
      az rest --method post --url ("https://graph.microsoft.com/v1.0/users/{0}/assignLicense" -f $resourceAccountUpn) --headers 'Content-Type=application/json' --body $body --output none 2>$null
      if ($LASTEXITCODE -eq 0) { $licenseResult = 'assigned-or-already-present' } else { $licenseResult = 'assign-failed' }
    } else {
      $licenseResult = 'no-available-PHONESYSTEM_VIRTUALUSER-sku'
    }
  } catch {
    $licenseResult = 'warn-' + (ConvertTo-RedactedText $_.Exception.Message)
  }
  Write-Output "TPE_LICENSE result=$licenseResult"
}

Write-Output 'APPSETTING set MORGAN_TEAMS_RESOURCE_ACCOUNT_OID on Morgan Digital CFO app only'
az webapp config appsettings set --resource-group $ResourceGroup --name $WebApp --settings MORGAN_TEAMS_RESOURCE_ACCOUNT_OID=$resourceAccountObjectId --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to set MORGAN_TEAMS_RESOURCE_ACCOUNT_OID on '$WebApp'." }
Write-Output 'APPSETTING_OK'

Write-Output 'WEBSOCKETS enable App Service WebSockets for ACS media streaming'
az webapp config set --resource-group $ResourceGroup --name $WebApp --web-sockets-enabled true --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to enable WebSockets on '$WebApp'." }
Write-Output 'WEBSOCKETS_OK'

az webapp restart --resource-group $ResourceGroup --name $WebApp --output none
if ($LASTEXITCODE -ne 0) { throw "Failed to restart '$WebApp'." }
Write-Output 'RESTART_OK'

$settingCount = az webapp config appsettings list --resource-group $ResourceGroup --name $WebApp --query "[?name=='MORGAN_TEAMS_RESOURCE_ACCOUNT_OID'] | length(@)" -o tsv
Write-Output "VERIFY_APPSETTING_PRESENT count=$settingCount"
Write-Output 'TPE_WIRING_COMPLETE'
