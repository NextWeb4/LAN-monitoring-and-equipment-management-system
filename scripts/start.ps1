[CmdletBinding()]
param([switch] $NoBrowser)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repositoryRoot = Get-LanternRoot
$dataDirectory = Get-LanternDataDirectory -RepositoryRoot $repositoryRoot
$applicationDll = Join-Path $repositoryRoot 'artifacts\app\Lantern.dll'
$pidFile = Join-Path $dataDirectory 'lantern.pid'
$launchLock = Enter-LanternLaunchLock -DataDirectory $dataDirectory
$applicationUrl = 'http://localhost:5188'

try {
    $ownedProcesses = @(Get-LanternOwnedProcesses -ApplicationDll $applicationDll)
    if ($ownedProcesses.Count -gt 1) {
        throw 'Multiple Lantern processes already use this application path. No additional instance was started.'
    }

    if ($ownedProcesses.Count -eq 1) {
        $applicationProcessId = [int] $ownedProcesses[0].ProcessId
        Write-Host "Lantern is already running (PID $applicationProcessId)."
    } else {
        $listeners = @(Get-LanternListeners)
        if ($listeners.Count -gt 0) {
            $listenerProcessIds = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
            throw "Port 5188 is already in use by PID(s) $listenerProcessIds. No process was stopped."
        }

        if (-not (Test-Path -LiteralPath $applicationDll -PathType Leaf)) {
            & (Join-Path $PSScriptRoot 'build.ps1')
        }
        $dotnet = Find-LanternDotnet
        $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $stdoutLog = Join-Path $dataDirectory "launch-$logStamp-stdout.log"
        $stderrLog = Join-Path $dataDirectory "launch-$logStamp-stderr.log"
        $previousDataDirectory = $env:LAN_DATA_DIR
        try {
            $env:LAN_DATA_DIR = $dataDirectory
            $arguments = '"{0}" --urls http://127.0.0.1:5188' -f $applicationDll
            $startedProcess = Start-Process -FilePath $dotnet -ArgumentList $arguments `
                -WorkingDirectory $repositoryRoot -WindowStyle Hidden `
                -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
            $applicationProcessId = $startedProcess.Id
        } finally {
            $env:LAN_DATA_DIR = $previousDataDirectory
        }
        Write-Host "Lantern started in the background (PID $applicationProcessId)."
        Write-Host "Logs: $stdoutLog"
        Write-Host "      $stderrLog"
    }

    [System.IO.File]::WriteAllText($pidFile, [string] $applicationProcessId)
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $applicationProcessId" -ErrorAction Stop
        if (-not $currentProcess -or -not (Test-LanternProcess -ProcessInfo $currentProcess -ApplicationDll $applicationDll)) {
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
            throw "Lantern exited before becoming ready. Inspect launch-*-stderr.log and launch-*-stdout.log in $dataDirectory."
        }
        $listeners = @(Get-LanternListeners)
        $ownListeners = @($listeners | Where-Object { $_.OwningProcess -eq $applicationProcessId })
        $otherListeners = @($listeners | Where-Object { $_.OwningProcess -ne $applicationProcessId })
        if ($otherListeners.Count -gt 0) {
            throw 'Another process is also listening on port 5188. Browser was not opened; inspect the process and Lantern logs.'
        }
        if ($ownListeners.Count -gt 0) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    if (-not $ready) {
        throw "Lantern is still running but has not opened port 5188 within 45 seconds. Inspect logs in $dataDirectory; use scripts/stop.ps1 to stop it."
    }
    Write-Host "Open: $applicationUrl"
    Write-Host "Data directory: $dataDirectory"
    if (-not $NoBrowser) { Start-Process -FilePath $applicationUrl | Out-Null }
} finally {
    $launchLock.Dispose()
}
