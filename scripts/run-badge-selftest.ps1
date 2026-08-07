<#
.SYNOPSIS
    Drives the Morgan badge on-device self-test over USB serial and asserts the result.

.DESCRIPTION
    Opens the badge serial console, optionally enables simulation for the parts that
    are not soldered yet, runs the on-device self-test, and validates the structured
    JSON it returns.

    Hardware passes and simulated passes are reported separately and never merged.
    Use -Gate PreSolder to fail the run when any component is only simulated, so a
    bench result can never be presented as electrical verification.

.EXAMPLE
    ./scripts/run-badge-selftest.ps1 -Port COM7 -EnableSimulation

.EXAMPLE
    ./scripts/run-badge-selftest.ps1 -Port COM7 -Gate PreSolder
#>
[CmdletBinding()]
param(
    [string]$Port = 'COM7',
    [int]$BaudRate = 115200,
    [switch]$EnableSimulation,
    [ValidateSet('None', 'PreSolder', 'PostSolder')]
    [string]$Gate = 'None',
    [string]$ArtifactPath,
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$ExpectedSchemaVersion = 1

function Read-BadgeLines {
    param(
        [System.IO.Ports.SerialPort]$Serial,
        [string]$UntilPattern,
        [int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lines = New-Object System.Collections.Generic.List[string]
    while ((Get-Date) -lt $deadline) {
        try {
            $line = $Serial.ReadLine()
        } catch [TimeoutException] {
            continue
        }
        if ($null -eq $line) { continue }
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0) { continue }
        $lines.Add($trimmed) | Out-Null
        if ($UntilPattern -and $trimmed -match $UntilPattern) { return $lines }
    }
    return $lines
}

function Send-BadgeCommand {
    param(
        [System.IO.Ports.SerialPort]$Serial,
        [string]$Command
    )
    $Serial.DiscardInBuffer()
    $Serial.WriteLine($Command)
    Start-Sleep -Milliseconds 250
}

Write-Host "Morgan badge self-test" -ForegroundColor Cyan
Write-Host "Port: $Port  Baud: $BaudRate  Gate: $Gate"

$serial = New-Object System.IO.Ports.SerialPort($Port, $BaudRate, 'None', 8, 'One')
$serial.ReadTimeout = 2000
$serial.WriteTimeout = 2000
$serial.NewLine = "`n"
$serial.DtrEnable = $true
$serial.RtsEnable = $false

try {
    $serial.Open()
} catch {
    throw "Could not open $Port. Close any serial monitor using it, then retry. $($_.Exception.Message)"
}

try {
    Start-Sleep -Milliseconds 600
    $serial.DiscardInBuffer()

    if ($EnableSimulation) {
        Write-Host "Enabling simulation for unsoldered components..." -ForegroundColor Yellow
        Send-BadgeCommand -Serial $serial -Command 'sim all on'
        Read-BadgeLines -Serial $serial -UntilPattern '"event":"HAL"' -TimeoutSeconds 8 | Out-Null
    } else {
        # Simulation state lives in device RAM and survives between runs, so an
        # earlier simulated run would otherwise contaminate this one. Clear it
        # explicitly so a run without -EnableSimulation always means the same
        # thing. Peripherals detected as Real are not affected.
        Send-BadgeCommand -Serial $serial -Command 'sim all off'
        Read-BadgeLines -Serial $serial -UntilPattern '"event":"HAL"' -TimeoutSeconds 8 | Out-Null
    }

    Send-BadgeCommand -Serial $serial -Command 'modes'
    $modeLines = Read-BadgeLines -Serial $serial -UntilPattern '"event":"HAL"' -TimeoutSeconds 8
    $halLine = $modeLines | Where-Object { $_ -like '*"event":"HAL"*' } | Select-Object -Last 1

    Write-Host "Running on-device self-test..." -ForegroundColor Yellow
    Send-BadgeCommand -Serial $serial -Command 'selftest'
    $testLines = Read-BadgeLines -Serial $serial -UntilPattern '"event":"SELFTEST".*"summary"' -TimeoutSeconds $TimeoutSeconds
    $selfTestLine = $testLines | Where-Object { $_ -like '*"event":"SELFTEST"*' -and $_ -like '*summary*' } | Select-Object -Last 1
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
}

if (-not $selfTestLine) {
    throw "No self-test result received from $Port. Confirm the badge firmware is flashed and the board is not held in bootloader mode."
}

try {
    $result = $selfTestLine | ConvertFrom-Json
} catch {
    throw "Self-test output was not valid JSON: $selfTestLine"
}

if ($result.schemaVersion -ne $ExpectedSchemaVersion) {
    throw "Self-test schema version $($result.schemaVersion) does not match expected $ExpectedSchemaVersion. Update this script deliberately."
}
Write-Host ""
Write-Host "Firmware $($result.firmware)  pin contract rev $($result.pinContractRev)  $($result.chip) rev $($result.chipRevision)"
Write-Host ""

$rows = foreach ($check in $result.checks) {
    [pscustomobject]@{
        Check    = $check.id
        Mode     = $check.mode
        Verdict  = $check.verdict
        Evidence = $check.evidence
    }
}
$rows | Format-Table -AutoSize -Wrap | Out-String | Write-Host

$summary = $result.summary
Write-Host "Hardware passes : $($summary.hardwarePass)" -ForegroundColor Green
Write-Host "Simulated passes: $($summary.simulatedPass)" -ForegroundColor Yellow
Write-Host "Skipped         : $($summary.skipped)"
Write-Host "Failed          : $($summary.failed)" -ForegroundColor $(if ($summary.failed -gt 0) { 'Red' } else { 'Green' })

if (-not $ArtifactPath) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $ArtifactPath = Join-Path 'verification' "badge-selftest-$stamp.json"
}
$artifactDirectory = Split-Path -Parent $ArtifactPath
if ($artifactDirectory -and -not (Test-Path $artifactDirectory)) {
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
}

$artifact = [ordered]@{
    capturedUtc  = (Get-Date).ToUniversalTime().ToString('o')
    port         = $Port
    gate         = $Gate
    simulationRequested = [bool]$EnableSimulation
    halModes     = if ($halLine) { $halLine | ConvertFrom-Json } else { $null }
    selfTest     = $result
    coverageNote = 'Simulated results prove firmware logic only. They do not prove analogue levels, timing margin, current draw, thermal behaviour, RF performance, panel initialisation, acoustic response, speaker polarity, or the LiPo charge path.'
}
$artifact | ConvertTo-Json -Depth 8 | Set-Content -Path $ArtifactPath -Encoding utf8
Write-Host ""
Write-Host "Artifact written to $ArtifactPath"

if ($summary.failed -gt 0) {
    throw "$($summary.failed) self-test check(s) failed."
}

if ($Gate -eq 'PreSolder' -and $summary.simulatedPass -gt 0) {
    throw "Pre-solder gate: $($summary.simulatedPass) component(s) reported SIM-PASS. A simulated run cannot sign off soldering. Fit the hardware and re-run without -EnableSimulation."
}

if ($Gate -eq 'PreSolder' -and $result.simulationBuild) {
    throw "Pre-solder gate: this firmware was built with simulation support compiled in. Rebuild with BADGE_ALLOW_SIMULATION=0 for a hardware sign-off."
}

if ($Gate -eq 'PostSolder') {
    # display.panel and audio.microphone are the only checks that fail closed on
    # a bare board, so they are what actually discriminate. input.ptt and
    # power.batterySense also pass on a bare XIAO (a released and a missing
    # switch both read HIGH; the divider reads the USB rail), so they are
    # required here only to catch a regression, and the operator steps in
    # firmware/README.md remain mandatory for those two nets.
    $mustBeHardware = @('display.panel', 'audio.microphone', 'input.ptt', 'power.batterySense')
    $problems = @()
    foreach ($id in $mustBeHardware) {
        $check = $result.checks | Where-Object { $_.id -eq $id } | Select-Object -First 1
        if (-not $check) {
            $problems += "$id was not reported"
        } elseif ($check.verdict -ne 'HW-PASS') {
            $problems += "$id is $($check.verdict) ($($check.mode)): $($check.evidence)"
        }
    }
    if ($summary.simulatedPass -gt 0) {
        $problems += "$($summary.simulatedPass) component(s) are simulated"
    }
    if ($problems.Count -gt 0) {
        throw "Post-solder gate failed:`n  - " + ($problems -join "`n  - ")
    }
    Write-Host ""
    Write-Host "Post-solder gate passed. Still unverified by this rig: PTT continuity (run" -ForegroundColor Yellow
    Write-Host "pttwait), the LiPo path (re-run on battery with USB removed), speaker" -ForegroundColor Yellow
    Write-Host "polarity and sound pressure, acoustic response, and thermals." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Self-test completed." -ForegroundColor Green
