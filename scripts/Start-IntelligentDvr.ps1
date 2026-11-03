<# Foreground PC setup. Never changes execution policy or connects a camera. #>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Check,
    [switch]$Analysis,
    [switch]$Train,
    [ValidateSet('opencv-cpu', 'cuda-preferred')][string]$LiveBackend = 'cuda-preferred',
    [ValidateSet('opencv-cpu', 'cuda-preferred')][string]$AnalysisBackend = 'cuda-preferred',
    [switch]$AllowRecordingImport,
    [switch]$AllowTraining,
    [switch]$AllowFaceEnrollment,
    [string]$PrepareAnalysis = '',
    [switch]$Feeds,
    [switch]$Facility,
    [switch]$NoBrowser,
    [string]$FeedsConfig = '',
    [string]$Recordings = '',
    [string]$AnalysisConfig = '',
    [string]$RecorderConfig = '',
    [string]$Report = '',
    [string]$Python = '',
    [ValidateRange(1024, 65535)][int]$Port
)
$ErrorActionPreference = 'Stop'
$TaskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $TaskRoot
try {
    $TaskPythonArgs = @()
    if ($Python) { $TaskPython = $Python }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $TaskPython = 'py'; $TaskPythonArgs = @('-3.12') }
    else { $TaskPython = 'python' }
    $TaskArgs = @('-m', 'edge.pc_setup')
    if ($PSBoundParameters.ContainsKey('Port')) { $TaskArgs += @('--port', "$Port") }
    if ($Install) { $TaskArgs += '--install' }
    if ($Check) { $TaskArgs += '--check' }
    if ($Analysis) { $TaskArgs += '--analysis' }
    if ($Train) { $TaskArgs += '--train' }
    if ($PSBoundParameters.ContainsKey('LiveBackend')) { $TaskArgs += @('--live-backend', $LiveBackend) }
    if ($PSBoundParameters.ContainsKey('AnalysisBackend')) { $TaskArgs += @('--analysis-backend', $AnalysisBackend) }
    if ($AllowRecordingImport) { $TaskArgs += '--allow-recording-import' }
    if ($AllowTraining) { $TaskArgs += '--allow-training' }
    if ($AllowFaceEnrollment) { $TaskArgs += '--allow-face-enrollment' }
    if ($PrepareAnalysis) { $TaskArgs += @('--prepare-analysis', $PrepareAnalysis) }
    if ($Feeds) { $TaskArgs += '--feeds' }
    if ($Facility) { $TaskArgs += '--facility' }
    if ($NoBrowser) { $TaskArgs += '--no-browser' }
    if ($FeedsConfig) { $TaskArgs += @('--feeds-config', $FeedsConfig) }
    if ($Recordings) { $TaskArgs += @('--recordings', $Recordings) }
    if ($AnalysisConfig) { $TaskArgs += @('--config', $AnalysisConfig) }
    if ($RecorderConfig) { $TaskArgs += @('--recorder-config', $RecorderConfig) }
    if ($Report) { $TaskArgs += @('--report', $Report) }
    & $TaskPython @TaskPythonArgs @TaskArgs
    if ($LASTEXITCODE -ne 0) { throw "Intelligent DVR returned exit code $LASTEXITCODE. See the message above." }
} finally { Pop-Location }
