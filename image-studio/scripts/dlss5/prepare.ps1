# Publisher/developer environment only. Never run by or shipped as end-user setup.
#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ToolRoot,
    [string]$RuntimePath,
    [string]$EnvironmentRoot,
    [string]$Python,
    [string]$BridgePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'This preparation script requires Windows x64.' }

function Resolve-File([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
    return (Get-Item -LiteralPath $Path).FullName
}

function Find-ToolFile([string]$FileName) {
    foreach ($relative in @("_internal\$FileName", "runtime\$FileName", $FileName)) {
        $candidate = Join-Path $script:resolvedToolRoot $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Get-Item -LiteralPath $candidate).FullName
        }
    }
    throw "$FileName was not found in toolRoot/_internal, toolRoot/runtime, or toolRoot. Provide the complete publisher-curated native runtime."
}

function Write-JsonFile([object]$Value, [string]$Path) {
    $json = ConvertTo-Json -InputObject $Value -Depth 6
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $ToolRoot -PathType Container)) {
    throw "Publisher native runtime directory was not found: $ToolRoot"
}
$resolvedToolRoot = (Get-Item -LiteralPath $ToolRoot).FullName
if ($RuntimePath) { $RuntimePath = $RuntimePath.Trim() }
if (-not $RuntimePath) {
    $modsRuntime = Join-Path $resolvedToolRoot 'mods\nvngx_dlssnr.dll'
    if (Test-Path -LiteralPath $modsRuntime -PathType Leaf) {
        $RuntimePath = $modsRuntime
    } else {
        $runtimeCandidates = @(foreach ($relative in @('_internal\nvngx_dlssnr.dll', 'runtime\nvngx_dlssnr.dll', 'nvngx_dlssnr.dll')) {
            $candidate = Join-Path $resolvedToolRoot $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                (Get-Item -LiteralPath $candidate).FullName
            }
        })
        $runtimeCandidates = @($runtimeCandidates | Select-Object -Unique)
        if ($runtimeCandidates.Count -ne 1) {
            throw 'No unique default nvngx_dlssnr.dll was found. Select an authorized DLL explicitly with RuntimePath.'
        }
        $RuntimePath = $runtimeCandidates[0]
    }
}
$resolvedRuntime = Resolve-File $RuntimePath 'Authorized NVIDIA Neural Rendering DLL'
if ([IO.Path]::GetExtension($resolvedRuntime) -ine '.dll') {
    throw 'RuntimePath must identify the selected NVIDIA Neural Rendering DLL file.'
}
$hostPath = Find-ToolFile 'dlssnr_host_v2.dll'
$resolvedFFmpeg = Find-ToolFile 'ffmpeg.exe'
$resolvedFFprobe = Find-ToolFile 'ffprobe.exe'
if (-not $BridgePath) {
    $BridgePath = Join-Path $PSScriptRoot '..\..\backend\dlss5bridge\bridge.py'
}
$resolvedBridge = Resolve-File $BridgePath 'XAI bridge.py'
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $resolvedBridge) 'vendor\dlss5tool') -PathType Container)) {
    throw 'The vendored DLSS5Tool Python core is missing beside bridge.py.'
}

if (-not $EnvironmentRoot) {
    $localData = [Environment]::GetFolderPath('LocalApplicationData')
    if (-not $localData) { throw 'Pass EnvironmentRoot: LocalApplicationData is unavailable.' }
    $EnvironmentRoot = Join-Path $localData 'XAI\dlss5'
}
$EnvironmentRoot = [IO.Path]::GetFullPath($EnvironmentRoot)
$markerPath = Join-Path $EnvironmentRoot 'xai-dlss5-environment.json'
if (Test-Path -LiteralPath $EnvironmentRoot) {
    if (-not (Test-Path -LiteralPath $EnvironmentRoot -PathType Container)) {
        throw 'EnvironmentRoot must be a directory.'
    }
    if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
        $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($marker.owner -ne 'XAI-DLSS5') { throw 'EnvironmentRoot has an unrelated ownership marker.' }
    } elseif (@(Get-ChildItem -LiteralPath $EnvironmentRoot -Force).Count -gt 0) {
        throw 'EnvironmentRoot is not empty and is not an XAI DLSS5 environment. Choose a new directory.'
    }
}

$pythonArguments = @()
if ($Python) {
    if (Test-Path -LiteralPath $Python -PathType Leaf) {
        $pythonCommand = (Get-Item -LiteralPath $Python).FullName
    } else {
        $pythonCommand = (Get-Command -Name $Python -CommandType Application -ErrorAction Stop).Source
    }
} else {
    $launcher = Get-Command -Name 'py.exe' -CommandType Application -ErrorAction SilentlyContinue
    if ($launcher) {
        $pythonCommand = $launcher.Source
        $pythonArguments = @('-3')
    } else {
        $pythonCommand = (Get-Command -Name 'python.exe' -CommandType Application -ErrorAction Stop).Source
    }
}
$probe = "import json,struct,sys,sysconfig; print(json.dumps({'executable':sys.executable,'version':list(sys.version_info[:3]),'bits':struct.calcsize('P')*8,'platform':sysconfig.get_platform()}))"
$pythonInfoText = & $pythonCommand @pythonArguments -I -c $probe
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the selected Python installation.' }
$pythonInfo = $pythonInfoText | ConvertFrom-Json
if ($pythonInfo.platform -ne 'win-amd64' -or $pythonInfo.bits -ne 64 -or
    $pythonInfo.version[0] -ne 3 -or $pythonInfo.version[1] -lt 10) {
    throw 'Use an existing Windows 64-bit Python 3.10 or newer (Python 3.x). No Python is downloaded by this script.'
}

[void](New-Item -ItemType Directory -Path $EnvironmentRoot -Force)
Write-JsonFile ([ordered]@{ owner = 'XAI-DLSS5'; schemaVersion = 1 }) $markerPath
$venvRoot = Join-Path $EnvironmentRoot 'venv'
$venvPython = Join-Path $venvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    & ($pythonInfo.executable) -I -m venv $venvRoot | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed. No global packages were installed.' }
}
$venvProbe = "import json,struct,sys,sysconfig; print(json.dumps({'isolated':sys.prefix!=sys.base_prefix,'bits':struct.calcsize('P')*8,'platform':sysconfig.get_platform(),'version':list(sys.version_info[:3])}))"
$venvInfoText = & $venvPython -I -c $venvProbe
if ($LASTEXITCODE -ne 0) { throw 'The dedicated Python environment could not be inspected.' }
$venvInfo = $venvInfoText | ConvertFrom-Json
if (-not $venvInfo.isolated -or $venvInfo.bits -ne 64 -or $venvInfo.platform -ne 'win-amd64' -or
    $venvInfo.version[0] -ne 3 -or $venvInfo.version[1] -lt 10) {
    throw 'The existing environment must be a 64-bit Python 3.10+ virtual environment. Choose a new EnvironmentRoot.'
}

& $venvPython -I -m pip --isolated --disable-pip-version-check --require-virtualenv install `
    --only-binary=:all: -r (Join-Path $PSScriptRoot 'requirements.txt') | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw 'Dependency installation failed. Use a Python version with wheels for all listed dependencies, then rerun.'
}

$manifest = [ordered]@{
    schemaVersion = 1
    environmentRoot = $EnvironmentRoot
    pythonPath = $venvPython
    bridgePath = $resolvedBridge
    arguments = @('-u', $resolvedBridge)
    toolRoot = $resolvedToolRoot
    runtimePath = $resolvedRuntime
    nativeHostPath = $hostPath
    ffmpegPath = $resolvedFFmpeg
    ffprobePath = $resolvedFFprobe
    protocol = 'jsonl-stdin-stdout'
    createdAt = [DateTime]::UtcNow.ToString('o')
}
$manifestPath = Join-Path $EnvironmentRoot 'environment.json'
Write-JsonFile $manifest $manifestPath
Write-Host "Prepared environment. Manifest: $manifestPath"
$manifest | ConvertTo-Json -Depth 6
