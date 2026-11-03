[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repositoryRoot = Get-LanternRoot
$dataDirectory = Get-LanternDataDirectory -RepositoryRoot $repositoryRoot
$applicationDll = Join-Path $repositoryRoot 'artifacts\app\Lantern.dll'
$pidFile = Join-Path $dataDirectory 'lantern.pid'
$launchLock = Enter-LanternLaunchLock -DataDirectory $dataDirectory

try {
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        Write-Host 'No Lantern PID file was found. No process was stopped.'
        return
    }
    $recordedId = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    $applicationProcessId = 0
    if (-not [int]::TryParse($recordedId, [ref] $applicationProcessId) -or $applicationProcessId -le 0) {
        throw 'The Lantern PID file is invalid. No process was stopped.'
    }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $applicationProcessId" -ErrorAction Stop
    if (-not $processInfo) {
        Remove-Item -LiteralPath $pidFile -Force
        Write-Host 'Lantern was already stopped. The stale PID record was removed.'
        return
    }
    if (-not (Test-LanternProcess -ProcessInfo $processInfo -ApplicationDll $applicationDll)) {
        throw "PID $applicationProcessId does not belong to this Lantern application. No process was stopped."
    }

    Stop-Process -Id $applicationProcessId -ErrorAction Stop
    Wait-Process -Id $applicationProcessId -Timeout 15 -ErrorAction SilentlyContinue
    $remainingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $applicationProcessId" -ErrorAction Stop
    if ($remainingProcess -and (Test-LanternProcess -ProcessInfo $remainingProcess -ApplicationDll $applicationDll)) {
        throw "Lantern PID $applicationProcessId has not stopped yet. The PID file was retained."
    }
    Remove-Item -LiteralPath $pidFile -Force
    Write-Host "Lantern stopped (PID $applicationProcessId). Data and logs were kept."
} finally {
    $launchLock.Dispose()
}
