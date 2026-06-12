$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

$subscriptionId = if ($env:AZURE_SUBSCRIPTION_ID) { $env:AZURE_SUBSCRIPTION_ID } else { '260948a4-1d5e-42c8-b095-33a6641ad189' }
$resourceGroup = if ($env:MORGAN_RESOURCE_GROUP) { $env:MORGAN_RESOURCE_GROUP } else { 'rg-morgan-finance-agent' }
$webAppName = if ($env:MORGAN_WEBAPP_NAME) { $env:MORGAN_WEBAPP_NAME } else { 'morganfinanceagent-webapp' }
$morganAiAccount = if ($env:MORGAN_AI_ACCOUNT) { $env:MORGAN_AI_ACCOUNT } else { 'ai-morgan-voicelive' }

npm run build

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$deployDir = Join-Path $projectRoot '.deploy'
$stage = Join-Path $deployDir "runtime-live-$stamp"
$zip = Join-Path $deployDir "morgan-d-cfo-live-$stamp.zip"

Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

foreach ($item in @('package.json', 'package-lock.json', 'dist', 'manifest', 'ToolingManifest.json')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination (Join-Path $stage $item) -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/start-production.cjs') -Destination (Join-Path $stage 'scripts/start-production.cjs') -Force

Push-Location $stage
try {
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}

$compressionAssemblyLoaded = $false
try {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $compressionAssemblyLoaded = $true
} catch {
  $compressionAssemblyLoaded = $false
}

if ($compressionAssemblyLoaded) {
  $archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $stage -Recurse -File -Force | ForEach-Object {
      $relativePath = $_.FullName.Substring($stage.Length).TrimStart('\', '/').Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $_.FullName,
        $relativePath,
        [System.IO.Compression.CompressionLevel]::Fastest
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
} else {
  $items = Get-ChildItem -LiteralPath $stage -Force
  Compress-Archive -LiteralPath $items.FullName -DestinationPath $zip -Force
}
$zipFull = (Resolve-Path $zip).Path
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "ZIP=$zipFull"

az account set --subscription $subscriptionId
Write-Output 'AZ_ACCOUNT_SET_OK'

az webapp deploy --resource-group $resourceGroup --name $webAppName --src-path $zipFull --type zip --async false --output json
Write-Output 'DEPLOY_OK'

az webapp config set --resource-group $resourceGroup --name $webAppName --startup-file 'npm start' --output none
Write-Output 'STARTUP_OK'

az webapp config appsettings set `
  --resource-group $resourceGroup `
  --name $webAppName `
  --settings `
    'AVATAR_BACKGROUND_COLOR=#FFFFFF' `
    'AVATAR_DISPLAY_NAME=Morgan' `
    'AVATAR_STYLE=business' `
    'VOICE_ENABLED_DEFAULT=true' `
    'WEBSITE_NODE_DEFAULT_VERSION=~20' `
    'SCM_DO_BUILD_DURING_DEPLOYMENT=false' `
    'ENABLE_ORYX_BUILD=false' `
    'NODE_ENV=production' `
    'AUTONOMOUS_WORKDAY_ENABLED=true' `
    'AUTONOMOUS_WORKDAY_TIME_ZONE=Australia/Sydney' `
    'AUTONOMOUS_WORKDAY_START_HOUR=9' `
    'AUTONOMOUS_WORKDAY_END_HOUR=17' `
    'AUTONOMOUS_WORKDAY_INTERVAL_MINUTES=25' `
  --output none
Write-Output 'SETTINGS_OK'

$principalId = az webapp identity show --resource-group $resourceGroup --name $webAppName --query principalId --output tsv 2>$null
if ($LASTEXITCODE -ne 0 -or -not $principalId) {
  Write-Output 'VOICE_RBAC_SKIPPED_NO_MANAGED_IDENTITY'
} else {
  $voiceLiveScope = az cognitiveservices account show --resource-group $resourceGroup --name $morganAiAccount --query id --output tsv 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $voiceLiveScope) {
    Write-Output 'VOICE_RBAC_SKIPPED_NO_AI_RESOURCE'
  } else {
    foreach ($role in @('Cognitive Services OpenAI User', 'Cognitive Services User', 'Azure AI User')) {
      $roleOutput = az role assignment create `
        --assignee-object-id $principalId `
        --assignee-principal-type ServicePrincipal `
        --role $role `
        --scope $voiceLiveScope `
        --output none 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Output "VOICE_RBAC_OK $role"
      } elseif (($roleOutput | Out-String) -match 'RoleAssignmentExists|already exists') {
        Write-Output "VOICE_RBAC_EXISTS $role"
      } else {
        Write-Output "VOICE_RBAC_WARN $role"
      }
    }
  }
}

az webapp restart --resource-group $resourceGroup --name $webAppName --output none
Write-Output 'RESTART_OK'
