[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repositoryRoot = Get-LanternRoot
$applicationDll = Join-Path $repositoryRoot 'artifacts\app\Lantern.dll'
$frontendDirectory = Join-Path $repositoryRoot 'frontend'
$projectPath = Join-Path $repositoryRoot 'src\Lantern\Lantern.csproj'

if (@(Get-LanternOwnedProcesses -ApplicationDll $applicationDll).Count -gt 0) {
    throw 'Lantern is running from artifacts/app. Run scripts/stop.ps1 before rebuilding.'
}
if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "Project not found: $projectPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDirectory 'package.json') -PathType Leaf)) {
    throw "Frontend package.json not found: $frontendDirectory"
}

$dotnet = Find-LanternDotnet -RequireSdk
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw 'Node.js and npm.cmd are required to build the frontend. Install Node.js LTS and retry.' }

Write-Host "Using .NET: $dotnet"
Push-Location $frontendDirectory
try {
    if (Test-Path -LiteralPath (Join-Path $frontendDirectory 'package-lock.json') -PathType Leaf) {
        & $npm.Source ci --no-audit --no-fund
    } else {
        & $npm.Source install --no-audit --no-fund
    }
    if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed (exit $LASTEXITCODE)." }
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}

$staticIndex = Join-Path $repositoryRoot 'src\Lantern\wwwroot\index.html'
if (-not (Test-Path -LiteralPath $staticIndex -PathType Leaf)) {
    throw 'Frontend build did not produce src/Lantern/wwwroot/index.html. Check the Vite output directory.'
}

$publishDirectory = Join-Path $repositoryRoot 'artifacts\app'
& $dotnet publish $projectPath --configuration Release --output $publishDirectory --self-contained false
if ($LASTEXITCODE -ne 0) { throw "Application publish failed (exit $LASTEXITCODE)." }
Write-Host "Build complete: $publishDirectory"
Write-Host 'Run start.cmd to open Lantern.'
