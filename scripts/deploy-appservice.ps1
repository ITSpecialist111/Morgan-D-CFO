<#
.SYNOPSIS
  Deploy the complete Morgan D-CFO runtime to the existing Azure App Service.

.DESCRIPTION
  This is the canonical deployment entry point for application, Mission Control,
  governance, Teams/ACS calling, approval, voice, and avatar changes. The legacy
  deploy-avatar-ui.ps1 implementation is retained for compatibility.
#>
$ErrorActionPreference = 'Stop'

$legacyDeploymentScript = Join-Path $PSScriptRoot 'deploy-avatar-ui.ps1'
if (-not (Test-Path -LiteralPath $legacyDeploymentScript)) {
  throw "Legacy App Service deployment implementation not found: $legacyDeploymentScript"
}

& $legacyDeploymentScript @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
