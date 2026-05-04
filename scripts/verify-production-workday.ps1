$ErrorActionPreference = 'Stop'

$subscriptionId = '260948a4-1d5e-42c8-b095-33a6641ad189'
$resourceGroup = 'rg-morgan-finance-agent'
$webAppName = 'morganfinanceagent-webapp'
$workdayUrl = 'https://morganfinanceagent-webapp.azurewebsites.net/api/mission-control/run-workday'

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

$handoffs = @($response.result.subAgentHandoffs | ForEach-Object {
  [pscustomobject]@{
    agentId = $_.agentId
    agentName = $_.agentName
    status = $_.status
    summary = $_.summary
    evidence = $_.evidence
  }
})

[pscustomobject]@{
  ok = $response.ok
  period = $response.result.period
  records = @($response.result.records).Count
  subAgentHandoffs = $handoffs
  timestamp = $response.timestamp
} | ConvertTo-Json -Depth 8
