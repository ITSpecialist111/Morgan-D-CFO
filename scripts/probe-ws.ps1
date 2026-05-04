param([string] $Urls)
$urlList = $Urls -split ','
function Probe-WS($url) {
  $h = @{
    Connection = 'Upgrade'
    Upgrade = 'websocket'
    'Sec-WebSocket-Version' = '13'
    'Sec-WebSocket-Key' = 'dGhlIHNhbXBsZSBub25jZQ=='
  }
  Write-Output ('--- ' + $url + ' ---')
  try {
    $r = Invoke-WebRequest -Uri $url -Headers $h -Method GET -UseBasicParsing -TimeoutSec 12 -MaximumRedirection 0
    Write-Output ('HTTP ' + [int]$r.StatusCode)
    $r.Headers.GetEnumerator() | Where-Object { $_.Key -match 'middleware|server|websocket|upgrade' } | ForEach-Object { '{0}: {1}' -f $_.Key, $_.Value }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      Write-Output ('HTTP ' + [int]$resp.StatusCode)
      $resp.Headers.GetEnumerator() | Where-Object { $_.Key -match 'middleware|server|websocket|upgrade' } | ForEach-Object { '{0}: {1}' -f $_.Key, $_.Value }
    } else {
      Write-Output ('Err: ' + $_.Exception.Message)
    }
  }
}
foreach ($u in $urlList) { Probe-WS $u.Trim() }
