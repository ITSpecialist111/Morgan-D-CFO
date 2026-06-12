param(
  [ValidateSet('Personal', 'Shared')]
  [string]$Scope = 'Shared'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$manifestDir = Join-Path $root 'manifest'
$manifestPath = Join-Path $manifestDir 'manifest.json'
$templatePath = Join-Path $manifestDir 'agenticUserTemplateManifest.json'
$zipPath = Join-Path $manifestDir 'manifest.zip'

# Blueprint / template / manifest ids are tenant-specific. Keep them out of source control:
# set A365_MANIFEST_ID / A365_BLUEPRINT_ID / A365_TEMPLATE_ID (or the local, gitignored
# a365.generated.config.json) before publishing. The placeholder defaults match the checked-in
# manifest tokens so nothing tenant-specific is committed.
$manifestId = if ($env:A365_MANIFEST_ID) { $env:A365_MANIFEST_ID } else { '<your-app-id>' }
$blueprintId = if ($env:A365_BLUEPRINT_ID) { $env:A365_BLUEPRINT_ID } else { '<your-app-id>' }
$templateId = if ($env:A365_TEMPLATE_ID) { $env:A365_TEMPLATE_ID } else { '<your-template-id>' }
$agentShortName = 'Morgan-Digital-CFO-Agent-Live'
$agentFullName = "Morgan Digital CFO Agent Live - CFO's Digital Finance Analyst"
$packageVersion = '1.1.5'

if ($manifestId -like '<*>' -or $blueprintId -like '<*>' -or $templateId -like '<*>') {
  Write-Warning 'Agent 365 manifest/blueprint/template ids are still placeholders. Set A365_MANIFEST_ID, A365_BLUEPRINT_ID, and A365_TEMPLATE_ID (or populate a365.generated.config.json) before a real publish.'
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

Push-Location $root
try {
  if (-not (Get-Command a365 -ErrorAction SilentlyContinue)) {
    throw 'Agent 365 CLI command a365 was not found on PATH.'
  }

  if (-not (Get-Command atk -ErrorAction SilentlyContinue)) {
    throw 'Microsoft 365 Agents Toolkit CLI command atk was not found on PATH.'
  }

  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  Write-Host 'Packaging Agent 365 manifest with a365 publish...'
  @('n', '') | & a365 publish --aiteammate --verbose
  if ($LASTEXITCODE -ne 0) {
    throw "a365 publish failed with exit code $LASTEXITCODE."
  }

  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.id = $manifestId
  $manifest.name.short = $agentShortName
  $manifest.name.full = $agentFullName
  $manifest.description.short = 'Live Digital CFO agent package for finance analysis, reporting, and approval work.'
  $manifest.description.full = 'Morgan-Digital-CFO-Agent-Live is a Synthetic Worker - an autonomous digital finance employee powered by GPT-5 (Azure OpenAI) and Agent 365. Morgan analyses budget vs actuals, identifies spending anomalies, generates board-ready reports, and posts weekly P&L briefings to the Finance Teams channel. Built on Microsoft Agent 365 with WorkIQ MCP tools including Mail, Teams, SharePoint, OneDrive, Word, Excel, Calendar, Planner, People, and Knowledge, plus a Microsoft IQ showcase that combines Foundry IQ for model, knowledge, trace, and evaluation intelligence with Fabric IQ for financial figures and cross-functional business insights. Morgan prepares drafts and decisions proactively while preserving HITL controls for external sends and dollar-bearing actions.'
  $manifest.version = $packageVersion
  $manifest.developer.termsOfUseUrl = 'https://go.microsoft.com/fwlink/?LinkId=518028'
  $manifest.agenticUserTemplates[0].id = $templateId
  Write-Utf8NoBom -Path $manifestPath -Value ($manifest | ConvertTo-Json -Depth 50)

  $template = Get-Content $templatePath -Raw | ConvertFrom-Json
  $template.id = $templateId
  $template.agentIdentityBlueprintId = $blueprintId
  Write-Utf8NoBom -Path $templatePath -Value ($template | ConvertTo-Json -Depth 50)

  if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
  }

  Compress-Archive -Path $manifestPath, $templatePath, (Join-Path $manifestDir 'color.png'), (Join-Path $manifestDir 'outline.png') -DestinationPath $zipPath -Force

  Write-Host 'Ensuring Developer Portal app registration exists...'
  & atk provision --env dev --folder $root --interactive false --verbose
  if ($LASTEXITCODE -ne 0) {
    throw "atk provision failed with exit code $LASTEXITCODE."
  }

  Write-Host 'Updating Developer Portal app package...'
  & atk update --package-file $zipPath --interactive false --verbose
  if ($LASTEXITCODE -ne 0) {
    throw "atk update failed with exit code $LASTEXITCODE."
  }

  Write-Host "Uploading $zipPath to Microsoft 365 with scope $Scope..."
  & atk install --file-path $zipPath --scope $Scope --interactive false --verbose
  if ($LASTEXITCODE -ne 0) {
    throw "atk install failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
