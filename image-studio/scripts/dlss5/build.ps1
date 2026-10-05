#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RuntimeSource,
    [string]$EnvironmentRoot,
    [string]$OutputDirectory,
    [string]$BundleVersion = 'development'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Build the Windows AMD64 video engine on Windows x64.' }
if (-not $EnvironmentRoot) {
    $EnvironmentRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'XAI\dlss5'
}
$EnvironmentRoot = [IO.Path]::GetFullPath($EnvironmentRoot)
$environmentFile = Join-Path $EnvironmentRoot 'environment.json'
$markerPath = Join-Path $EnvironmentRoot 'xai-dlss5-environment.json'
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf) -or
    -not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { throw 'Run the developer prepare.ps1 first.' }
$marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($marker.owner -ne 'XAI-DLSS5') { throw 'Not an XAI developer environment.' }
$environment = Get-Content -LiteralPath $environmentFile -Raw -Encoding UTF8 | ConvertFrom-Json
$python = Join-Path $EnvironmentRoot 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'Developer Python environment is missing.' }
$bridgeRoot = Split-Path -Parent $environment.bridgePath
if (-not (Test-Path -LiteralPath (Join-Path $bridgeRoot 'bridge.py') -PathType Leaf)) { throw 'Bridge source is missing.' }
$RuntimeSource = [IO.Path]::GetFullPath($RuntimeSource)
if (-not (Test-Path -LiteralPath $RuntimeSource -PathType Container)) { throw 'Provide a trusted curated RuntimeSource directory. No native assets are downloaded.' }
foreach ($name in @('dlssnr_host_v2.dll', 'nvngx_dlssnr.dll', 'ffmpeg.exe', 'ffprobe.exe', 'THIRD_PARTY_NOTICES.md')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeSource $name) -PathType Leaf)) { throw "RuntimeSource is incomplete: $name" }
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $EnvironmentRoot ('build\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')) }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path -LiteralPath $OutputDirectory) -and
    (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container) -or @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -gt 0)) {
    throw 'OutputDirectory must be new or empty; previous builds are never removed automatically.'
}
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
& $python -I -m pip --isolated --disable-pip-version-check --require-virtualenv install --only-binary=:all: 'PyInstaller>=6,<7' | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Installing PyInstaller in the developer environment failed.' }
$previousBridgeRoot = $env:XAI_ENGINE_BRIDGE_ROOT
try {
    $env:XAI_ENGINE_BRIDGE_ROOT = $bridgeRoot
    & $python -I -m PyInstaller --noconfirm --clean `
        --distpath (Join-Path $OutputDirectory 'worker-dist') `
        --workpath (Join-Path $OutputDirectory 'work') `
        (Join-Path $PSScriptRoot 'engine.spec') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed; retained build files are available for diagnosis.' }
} finally {
    $env:XAI_ENGINE_BRIDGE_ROOT = $previousBridgeRoot
}
$workerRoot = Join-Path $OutputDirectory 'worker-dist\xai-video-engine'
$worker = Join-Path $workerRoot 'xai-video-engine.exe'
if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) { throw 'The frozen worker was not produced.' }
# Dependency smoke is intentionally GPU-free; it cannot certify NR compatibility.
$smokeText = & $worker --self-test
if ($LASTEXITCODE -ne 0) { throw 'Frozen worker dependency smoke failed.' }
$smoke = $smokeText | ConvertFrom-Json
if (-not $smoke.available -or -not $smoke.frozen) { throw 'Worker is not a complete frozen Python engine.' }
$bundleParent = Join-Path $OutputDirectory 'bundle'
[void](New-Item -ItemType Directory -Path $bundleParent -Force)
$bundleRoot = Join-Path $bundleParent 'dlss5'
& $python -I (Join-Path $PSScriptRoot 'bundle.py') build `
    --worker-root $workerRoot --runtime-root $RuntimeSource --output $bundleRoot --bundle-version $BundleVersion | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Engine bundle validation failed; no release archive was produced.' }
& $python -I (Join-Path $PSScriptRoot 'bundle.py') verify $bundleRoot | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Engine bundle integrity check failed.' }
$zipPath = Join-Path $OutputDirectory 'dlss5-bundle.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($bundleParent, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
# This developer report stays outside the distributable bundle/ZIP.
$report = [ordered]@{ schemaVersion = 1; bundlePath = $bundleRoot; archivePath = $zipPath; archiveSha256 = $hash; gpuTested = $false }
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'build-report.json'), ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json
