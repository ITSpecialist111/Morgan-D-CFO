$ErrorActionPreference = 'Stop'

$subscriptionId = '260948a4-1d5e-42c8-b095-33a6641ad189'
$resourceGroup = 'rg-morgan-finance-agent'
$webAppName = 'morganfinanceagent-webapp'
$baseUrl = 'https://morganfinanceagent-webapp.azurewebsites.net'
$workdayUrl = "$baseUrl/api/mission-control/run-workday"

az account set --subscription $subscriptionId
$secret = az webapp config appsettings list `
  --resource-group $resourceGroup `
  --name $webAppName `
  --subscription $subscriptionId `
  --query "[?name=='SCHEDULED_SECRET'].value | [0]" `
  -o tsv

if (-not $secret) {
  throw 'SCHEDULED_SECRET was not found on the Morgan App Service.'
}

$response = Invoke-RestMethod `
  -Method Post `
  -Uri $workdayUrl `
  -Headers @{ 'x-scheduled-secret' = $secret } `
  -ContentType 'application/json' `
  -Body '{}'

$records = @($response.result.records)
$statusCounts = [ordered]@{}
foreach ($record in $records) {
  $status = [string]$record.status
  if (-not $status) { $status = 'unknown' }
  if (-not $statusCounts.Contains($status)) { $statusCounts[$status] = 0 }
  $statusCounts[$status]++
}

$workingDayAudit = $records |
  Where-Object { $_.taskId -eq 'working-day-audit' -or $_.title -match 'Working Day Audit' } |
  Select-Object -First 1

$handoffs = @($response.result.subAgentHandoffs | ForEach-Object {
  [pscustomobject]@{
    agentId = $_.agentId
    agentName = $_.agentName
    status = $_.status
    summary = $_.summary
    evidence = $_.evidence
  }
})

$secretHeaders = @{ 'x-scheduled-secret' = $secret }
$audit = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/audit/events?limit=80" -Headers $secretHeaders
$events = @($audit.events)
$eventKindCounts = [ordered]@{}
$eventSeverityCounts = [ordered]@{}
foreach ($auditEvent in $events) {
  $kind = [string]$auditEvent.kind
  if (-not $kind) { $kind = 'unknown' }
  if (-not $eventKindCounts.Contains($kind)) { $eventKindCounts[$kind] = 0 }
  $eventKindCounts[$kind]++

  $severity = [string]$auditEvent.severity
  if (-not $severity) { $severity = 'info' }
  if (-not $eventSeverityCounts.Contains($severity)) { $eventSeverityCounts[$severity] = 0 }
  $eventSeverityCounts[$severity]++
}

$observability = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/observability" -Headers $secretHeaders
$health = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health?verifyProductionWorkday=1"

[pscustomobject]@{
  ok = $response.ok
  period = $response.result.period
  headline = $response.result.headline
  records = $records.Count
  recordStatusCounts = $statusCounts
  workingDayAudit = if ($workingDayAudit) {
    [pscustomobject]@{
      taskId = $workingDayAudit.taskId
      status = $workingDayAudit.status
      title = $workingDayAudit.title
      summary = $workingDayAudit.summary
    }
  } else { $null }
  subAgentHandoffs = $handoffs
  audit = [pscustomobject]@{
    returned = $events.Count
    kindCounts = $eventKindCounts
    severityCounts = $eventSeverityCounts
    recent = @($events | Select-Object -First 15 | ForEach-Object {
      [pscustomobject]@{
        kind = $_.kind
        severity = $_.severity
        label = $_.label
        timestamp = $_.timestamp
      }
    })
  }
  observability = [pscustomobject]@{
    applicationInsightsConfigured = $observability.applicationInsightsConfigured
    applicationInsightsResourceIdPresent = [bool]$observability.applicationInsightsResourceId
    auditEventCount = $observability.auditEventCount
    mcpPlatformEndpointConfigured = $observability.agent365Sdk.mcpPlatformEndpointConfigured
    appIdentityConfigured = $observability.agent365Sdk.appIdentityConfigured
  }
  health = [pscustomobject]@{
    status = $health.status
    applicationInsights = $health.configuration.applicationInsights
    scheduledSecret = $health.configuration.scheduledSecret
    mcpPlatform = $health.configuration.mcpPlatform
    foundryProject = $health.configuration.foundryProject
    acsCallingConfigured = $health.acsCallingConfigured
  }
  timestamp = $response.timestamp
} | ConvertTo-Json -Depth 8
