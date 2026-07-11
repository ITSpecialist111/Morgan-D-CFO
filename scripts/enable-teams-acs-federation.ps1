<#
.SYNOPSIS
  Remediate the Teams 403/10391 "Teams rejected the ACS federated call" error by
  enabling ACS<->Teams federation in the Teams tenant for Morgan's outbound calls.

.DESCRIPTION
  Morgan places outbound calls to Teams users over Azure Communication Services
  (ACS) to Teams federation. The application side is already correct
  (ACS_TEAMS_FEDERATION_RESOURCE_ID is set to the immutable ACS resource ID and
  the policy is acknowledged). The 403 sub-code 10391 is raised by Teams when the
  *tenant* has not allow-listed the ACS resource for federation and/or the target
  user is not enabled for ACS federation. Those are Teams admin operations and
  cannot be performed by the web app.

    This script (run by a Teams Administrator) validates the target and performs
    the two required policy steps:
     1. Verify the target is a human Teams user with Teams Phone Standard
       (MCOEV), Enterprise Voice, SIP, and registrar provisioning. Resource-
       account licensing (PHONESYSTEM_VIRTUALUSER / MCOEV_VIRTUALUSER) is
       rejected because it causes direct user calls to fail with 403/10391.
     2. Set-CsTeamsAcsFederationConfiguration  -> allow-list the immutable ACS
       resource ID at tenant scope (EnableAcsUsers = true).
     3. Set/Grant-CsExternalAccessPolicy       -> enable ACS federation access for
       the target Teams user.
  It then verifies and prints the resulting state. The target user must also be
  Teams Phone / Enterprise Voice eligible to receive the call.

  Defaults to -WhatIf (no changes) so you can preview. Add -Apply to make changes.

.PARAMETER TargetUserUpn
  UPN of the Teams user Morgan calls (the CFO/operator). Required to grant the
  per-user external access policy.

.PARAMETER AcsResourceId
  The immutable ACS resource ID (GUID). If omitted, the script reads it from the
  App Service setting ACS_TEAMS_FEDERATION_RESOURCE_ID via Azure CLI.

.PARAMETER ResourceGroup
  App Service resource group (used only to read AcsResourceId). Default: rg-morgan-finance-agent.

.PARAMETER AppName
  App Service name (used only to read AcsResourceId). Default: morganfinanceagent-webapp.

.PARAMETER Apply
  Actually make the changes. Without it, the script runs in -WhatIf preview mode.

.EXAMPLE
  # Preview (no changes)
  ./scripts/enable-teams-acs-federation.ps1 -TargetUserUpn cfo@contoso.com

.EXAMPLE
  # Apply
  ./scripts/enable-teams-acs-federation.ps1 -TargetUserUpn cfo@contoso.com -Apply
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetUserUpn,

  [string]$AcsResourceId,

  [string]$ResourceGroup = 'rg-morgan-finance-agent',

  [string]$AppName = 'morganfinanceagent-webapp',

  [string]$ExternalAccessPolicyName = 'Global',

  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$whatIf = -not $Apply

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 1. Resolve the immutable ACS resource ID
# ---------------------------------------------------------------------------
if (-not $AcsResourceId) {
  Write-Step "Reading ACS_TEAMS_FEDERATION_RESOURCE_ID from App Service '$AppName'"
  try {
    $AcsResourceId = az webapp config appsettings list -g $ResourceGroup -n $AppName `
      --query "[?name=='ACS_TEAMS_FEDERATION_RESOURCE_ID'].value | [0]" -o tsv
  } catch {
    throw "Could not read ACS_TEAMS_FEDERATION_RESOURCE_ID from App Service. Pass -AcsResourceId explicitly. ($($_.Exception.Message))"
  }
}
if (-not $AcsResourceId) {
  throw "No ACS resource ID available. Set ACS_TEAMS_FEDERATION_RESOURCE_ID on the App Service or pass -AcsResourceId."
}
Write-Ok "ACS immutable resource ID: $AcsResourceId"
if ($AcsResourceId -notmatch '^[0-9a-fA-F-]{36}$') {
  Write-Warn2 "This does not look like the 36-char immutable resource ID. Use the ACS resource's immutable id (Properties > Immutable resource ID), not the ARM resource id."
}

# ---------------------------------------------------------------------------
# 2. Connect to Microsoft Teams
# ---------------------------------------------------------------------------
Write-Step "Ensuring MicrosoftTeams PowerShell module"
if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
  if ($whatIf) {
    Write-Warn2 "MicrosoftTeams module not installed. Would run: Install-Module MicrosoftTeams -Scope CurrentUser"
  } else {
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
  }
}
Import-Module MicrosoftTeams -ErrorAction SilentlyContinue

Write-Step "Connecting to Microsoft Teams (sign in as a Teams Administrator)"
if ($whatIf) {
  Write-Warn2 "Would run: Connect-MicrosoftTeams"
} else {
  Connect-MicrosoftTeams | Out-Null
}

# ---------------------------------------------------------------------------
# 2a. Validate that the destination is a human Teams Phone user
# ---------------------------------------------------------------------------
Write-Step "Validating the target as a callable Teams Phone user"
if ($whatIf) {
  Write-Warn2 "Would verify Get-CsOnlineUser for Teams Phone Standard, Enterprise Voice, SIP, and registrar provisioning"
} else {
  $targetUser = Get-CsOnlineUser -Identity $TargetUserUpn -ErrorAction Stop
  $enabledCapabilities = @($targetUser.AssignedPlan | Where-Object CapabilityStatus -eq 'Enabled' | Select-Object -ExpandProperty Capability)
  $isApplicationInstance = [string]$targetUser.InterpretedUserType -match 'ApplicationInstance'
  $hasHumanPhonePlan = @($enabledCapabilities | Where-Object { $_ -eq 'MCOEV' }).Count -gt 0
  $hasVirtualUserPlan = @($enabledCapabilities | Where-Object { $_ -eq 'MCOEV_VIRTUALUSER' }).Count -gt 0
  if ($isApplicationInstance -or $hasVirtualUserPlan) {
    throw 'The target is provisioned as a Teams application/resource account. Direct ACS-to-Teams user calls require a human Teams user with Teams Phone Standard, not PHONESYSTEM_VIRTUALUSER.'
  }
  if (-not $hasHumanPhonePlan) {
    throw 'The target does not have the human Teams Phone Standard (MCOEV) service plan.'
  }
  if (-not $targetUser.EnterpriseVoiceEnabled) {
    throw 'The target is not Enterprise Voice enabled. Run Set-CsPhoneNumberAssignment -Identity <target> -EnterpriseVoiceEnabled $true.'
  }
  if ([string]::IsNullOrWhiteSpace([string]$targetUser.RegistrarPool) -or [string]::IsNullOrWhiteSpace([string]$targetUser.SipAddress)) {
    throw 'Teams has not completed SIP/registrar provisioning for the target. Wait for license propagation, then retry.'
  }
  Write-Ok 'Target is a human Teams Phone user with Enterprise Voice and SIP/registrar provisioning.'
}

# ---------------------------------------------------------------------------
# 3. Tenant: allow-list the ACS resource for federation
# ---------------------------------------------------------------------------
Write-Step "Allow-listing the ACS resource for Teams<->ACS federation (tenant scope)"
$federationCmd = "Set-CsTeamsAcsFederationConfiguration -Identity Global -EnableAcsUsers `$true -AllowedAcsResources @{Replace=@('$AcsResourceId')}"
if ($whatIf) {
  Write-Warn2 "Would run: $federationCmd"
} else {
  $currentFederation = Get-CsTeamsAcsFederationConfiguration -ErrorAction Stop
  $currentAllowedResources = @($currentFederation.AllowedAcsResources | ForEach-Object { [string]$_ })
  if ($currentFederation.EnableAcsUsers -and $currentAllowedResources -contains $AcsResourceId) {
    Write-Ok 'Federation configuration already contains the immutable ACS resource ID.'
  } else {
    $nextAllowedResources = @($currentAllowedResources + $AcsResourceId | Sort-Object -Unique)
    Set-CsTeamsAcsFederationConfiguration -Identity Global -EnableAcsUsers $true -AllowedAcsResources @{ Replace = $nextAllowedResources } -Force
    Write-Ok "Federation configuration updated."
  }
}

# ---------------------------------------------------------------------------
# 4. User: enable ACS federation access on the external access policy
# ---------------------------------------------------------------------------
Write-Step "Enabling ACS federation access for the target user's external access policy"
$policyCmd = "Set-CsExternalAccessPolicy -Identity '$ExternalAccessPolicyName' -EnableAcsFederationAccess `$true"
$grantCmd  = "Grant-CsExternalAccessPolicy -Identity '$TargetUserUpn' -PolicyName '$ExternalAccessPolicyName'"
if ($whatIf) {
  Write-Warn2 "Would run: $policyCmd"
  Write-Warn2 "Would run: $grantCmd  (omit -PolicyName to use the Global policy)"
} else {
  $currentExternalPolicy = Get-CsExternalAccessPolicy -Identity $ExternalAccessPolicyName -ErrorAction Stop
  if ($currentExternalPolicy.EnableAcsFederationAccess) {
    Write-Ok "External access policy '$ExternalAccessPolicyName' already enables ACS federation."
  } else {
    Set-CsExternalAccessPolicy -Identity $ExternalAccessPolicyName -EnableAcsFederationAccess $true
  }
  if ($ExternalAccessPolicyName -ne 'Global') {
    Grant-CsExternalAccessPolicy -Identity $TargetUserUpn -PolicyName $ExternalAccessPolicyName
  }
  Write-Ok "External access policy updated for $TargetUserUpn."
}

# ---------------------------------------------------------------------------
# 5. Verify
# ---------------------------------------------------------------------------
Write-Step "Verifying federation configuration"
if ($whatIf) {
  Write-Warn2 "Would run: Get-CsTeamsAcsFederationConfiguration | Format-List EnableAcsUsers,AllowedAcsResources"
  Write-Warn2 "Would run: Get-CsExternalAccessPolicy -Identity '$ExternalAccessPolicyName' | Format-List Identity,EnableAcsFederationAccess"
} else {
  Get-CsTeamsAcsFederationConfiguration | Format-List EnableAcsUsers, AllowedAcsResources
  Get-CsExternalAccessPolicy -Identity $ExternalAccessPolicyName | Format-List Identity, EnableAcsFederationAccess
}

Write-Host ""
Write-Host "Notes:" -ForegroundColor Cyan
Write-Host "  - The target user ($TargetUserUpn) must be Teams Phone / Enterprise Voice eligible to receive the call." -ForegroundColor Gray
Write-Host "  - Policy changes can take time to propagate across Teams (often up to ~1 hour)." -ForegroundColor Gray
Write-Host "  - Re-run Morgan's Teams call from Mission Control after propagation to confirm the 403/10391 is cleared." -ForegroundColor Gray
if ($whatIf) {
  Write-Host ""
  Write-Host "Preview only. Re-run with -Apply to make these changes." -ForegroundColor Yellow
}
