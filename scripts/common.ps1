Set-StrictMode -Version Latest

function Get-LanternRoot {
    [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-LanternDataDirectory {
    param([Parameter(Mandatory = $true)][string] $RepositoryRoot)

    $directory = $env:LAN_DATA_DIR
    if ([string]::IsNullOrWhiteSpace($directory)) {
        $directory = Join-Path $RepositoryRoot 'data'
    } elseif (-not [System.IO.Path]::IsPathRooted($directory)) {
        $directory = Join-Path $RepositoryRoot $directory
    }
    [System.IO.Path]::GetFullPath($directory)
}

function Find-LanternDotnet {
    param([switch] $RequireSdk)

    $candidates = @()
    if ($env:USERPROFILE) { $candidates += Join-Path $env:USERPROFILE '.dotnet\dotnet.exe' }
    if ($env:DOTNET_ROOT) { $candidates += Join-Path $env:DOTNET_ROOT 'dotnet.exe' }
    $pathCommand = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    if ($pathCommand) { $candidates += $pathCommand.Source }
    if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'dotnet\dotnet.exe' }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $runtimes = @(& $candidate --list-runtimes 2>$null)
        if ($LASTEXITCODE -ne 0) { continue }
        $hasCore = @($runtimes | Where-Object { $_ -match '^Microsoft\.NETCore\.App\s+8\.' }).Count -gt 0
        $hasWeb = @($runtimes | Where-Object { $_ -match '^Microsoft\.AspNetCore\.App\s+8\.' }).Count -gt 0
        if (-not ($hasCore -and $hasWeb)) { continue }
        if ($RequireSdk) {
            $sdks = @(& $candidate --list-sdks 2>$null)
            if ($LASTEXITCODE -ne 0) { continue }
            $supported = @($sdks | Where-Object {
                $_ -match '^(\d+)\.' -and [int] $Matches[1] -ge 8
            }).Count -gt 0
            if (-not $supported) { continue }
        }
        return [System.IO.Path]::GetFullPath($candidate)
    }

    if ($RequireSdk) {
        throw 'Build requires .NET SDK 8 or newer, with .NET 8 and ASP.NET Core 8 runtimes. Install the .NET 8 SDK, or place it under %USERPROFILE%\.dotnet.'
    }
    throw 'Start requires .NET 8 and ASP.NET Core 8 runtimes. Install the ASP.NET Core 8 Runtime (or .NET 8 SDK).'
}

function Test-LanternProcess {
    param(
        [Parameter(Mandatory = $true)] $ProcessInfo,
        [Parameter(Mandatory = $true)][string] $ApplicationDll
    )

    if ($ProcessInfo.Name -ine 'dotnet.exe' -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) {
        return $false
    }
    $escaped = [regex]::Escape($ApplicationDll)
    $argumentPattern = '(?i)(?:^|\s)(?:"' + $escaped + '"|' + $escaped + ')(?=\s|$)'
    return [regex]::IsMatch($ProcessInfo.CommandLine, $argumentPattern)
}

function Get-LanternOwnedProcesses {
    param([Parameter(Mandatory = $true)][string] $ApplicationDll)

    Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" -ErrorAction Stop |
        Where-Object { Test-LanternProcess -ProcessInfo $_ -ApplicationDll $ApplicationDll }
}

function Get-LanternListeners {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        throw 'Windows Get-NetTCPConnection is required to check port ownership safely.'
    }
    Get-NetTCPConnection -LocalPort 5188 -State Listen -ErrorAction SilentlyContinue
}

function Enter-LanternLaunchLock {
    param([Parameter(Mandatory = $true)][string] $DataDirectory)

    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    try {
        return [System.IO.File]::Open(
            (Join-Path $DataDirectory 'launch.lock'),
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    } catch {
        throw 'Another start or stop operation is in progress. Wait for it to finish and retry.'
    }
}
