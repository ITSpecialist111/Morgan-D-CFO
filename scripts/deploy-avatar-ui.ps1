$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

$subscriptionId = '260948a4-1d5e-42c8-b095-33a6641ad189'
$resourceGroup = 'rg-morgan-finance-agent'
$webAppName = 'morganfinanceagent-webapp'

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

if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}

$items = Get-ChildItem -LiteralPath $stage -Force
Compress-Archive -LiteralPath $items.FullName -DestinationPath $zip -Force
$zipFull = (Resolve-Path $zip).Path
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
    'AVATAR_BACKGROUND_COLOR=#000000' `
    'AVATAR_STYLE=casual' `
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

az webapp restart --resource-group $resourceGroup --name $webAppName --output none
Write-Output 'RESTART_OK'
