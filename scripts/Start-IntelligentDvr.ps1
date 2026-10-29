<# Explicit local launcher. No elevation, service, execution-policy change or camera connection. #>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Check,
    [switch]$Analysis,
    [switch]$Feeds,
    [string]$FeedsConfig = '',
    [string]$Recordings = '',
    [string]$AnalysisConfig = '',
    [string]$Python = '',
    [ValidateRange(1024, 65535)][int]$Port = 4173
)
$ErrorActionPreference = 'Stop'
$TaskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $TaskRoot
try {
    if (($Analysis -or $Feeds) -and ($Install -or $Check)) { throw 'Use -Analysis separately from -Install and -Check.' }
    if ($Install -and $Check) { throw 'Choose either -Install or -Check.' }
    $TaskNodeMajor = & node -p 'process.versions.node.split(".")[0]'
    if ($LASTEXITCODE -ne 0 -or $TaskNodeMajor.Trim() -ne '22') { throw 'Install Node.js 22 LTS first.' }
    $TaskPythonArgs = @()
    if ($Python) { $TaskPython = $Python }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $TaskPython = 'py'; $TaskPythonArgs = @('-3.12') }
    else { $TaskPython = 'python' }
    & $TaskPython @TaskPythonArgs -c 'import sys; assert sys.version_info[:2] == (3,12)'
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 with the Windows Python launcher.' }
    if ($Check) { Write-Output 'Node 22 and Python 3.12 detected. No install or server start performed.'; return }
    if ($Install) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
        if (-not (Test-Path '.venv')) {
            & $TaskPython @TaskPythonArgs -m venv .venv
            if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
        }
        & '.\.venv\Scripts\python.exe' -m pip install -r edge/requirements-test.txt
        if ($LASTEXITCODE -ne 0) { throw 'Edge test dependency installation failed.' }
    }
    if (-not (Test-Path 'node_modules/vite/bin/vite.js')) { throw 'Run this script with -Install first.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    if ($Analysis -or $Feeds) {
        if (-not (Test-Path '.venv/Scripts/python.exe')) { throw 'Install the local edge environment first.' }
        $TaskServiceArgs = @('--port', $Port)
        if ($Analysis -or $Recordings -or $AnalysisConfig) {
            if (-not $Recordings -or -not $AnalysisConfig) { throw 'Supply -Recordings and -AnalysisConfig together.' }
            $TaskServiceArgs += @('--recordings', $Recordings, '--config', $AnalysisConfig)
        }
        if ($Feeds -or $FeedsConfig) {
            if (-not $FeedsConfig) { throw 'Supply -FeedsConfig with the local DVR source file.' }
            $TaskServiceArgs += @('--feeds-config', $FeedsConfig)
        }
        & '.\.venv\Scripts\python.exe' -m edge.local_service @TaskServiceArgs
        if ($LASTEXITCODE -ne 0) { throw 'Local service exited with an error.' }
        return
    }
    Write-Output 'Loopback preview only; Ctrl+C stops it. Analysis is a separate explicit command.'
    & npm.cmd run preview -- --host 127.0.0.1 --port $Port --strictPort
    if ($LASTEXITCODE -ne 0) { throw 'Preview exited with an error.' }
} finally { Pop-Location }
