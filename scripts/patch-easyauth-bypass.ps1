param(
  [string] $ResourceGroup = 'rg-morgan-finance-agent',
  [string] $WebApp = 'morganfinanceagent-webapp'
)
$ErrorActionPreference = 'Stop'

$sub = (az account show --query id -o tsv).Trim()
$body = @{
  properties = @{
    platform = @{ enabled = $true; runtimeVersion = '~1' }
    globalValidation = @{
      unauthenticatedClientAction = 'AllowAnonymous'
      excludedPaths = @(
        '/api/calls',
        '/api/calls/acs-events',
        '/api/calls/acs-media',
        '/api/voice',
        '/api/health'
      )
    }
    identityProviders = @{
      azureActiveDirectory = @{
        registration = @{
          clientId = '151d7bf7-772f-489b-b407-a8541f3eb7a6'
          clientSecretSettingName = 'MicrosoftAppPassword'
          openIdIssuer = 'https://sts.windows.net/e4ccbd32-1a13-4cb6-8fda-c392e7ea359f/'
        }
        validation = @{ defaultAuthorizationPolicy = @{ allowedApplications = @() } }
      }
    }
    login = @{ preserveUrlFragmentsForLogins = $false; routes = @{ logoutEndpoint = '/.auth/logout' } }
  }
} | ConvertTo-Json -Depth 12

$bodyPath = Join-Path $env:TEMP 'morgan-auth-v2.json'
Set-Content -Encoding utf8 -Path $bodyPath -Value $body
Write-Output ('Body written to ' + $bodyPath)

$uri = "https://management.azure.com/subscriptions/$sub/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$WebApp/config/authsettingsV2?api-version=2023-12-01"
Write-Output ('PUT ' + $uri)

az rest --method put --uri $uri --body "@$bodyPath" -o json | Out-String

Write-Output '--- Verification ---'
az webapp auth show -g $ResourceGroup -n $WebApp --query 'properties.globalValidation' -o json | Out-String
