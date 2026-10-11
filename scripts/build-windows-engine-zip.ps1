#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BinaryPath,
    [Parameter(Mandatory = $true)][string]$OutputZipPath,
    [string]$Dlss5BundlePath = $env:XAI_DLSS5_BUNDLE
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([string]::IsNullOrWhiteSpace($Dlss5BundlePath)) { throw 'A complete DLSS5 bundle is required; there is no bare-EXE fallback.' }
$root = Split-Path -Parent $PSScriptRoot
$verifier = Join-Path $root 'image-studio\scripts\dlss5\bundle.py'
$BinaryPath = (Resolve-Path -LiteralPath $BinaryPath).Path
$Dlss5BundlePath = (Resolve-Path -LiteralPath $Dlss5BundlePath).Path
$OutputZipPath = [IO.Path]::GetFullPath($OutputZipPath)
if (Test-Path -LiteralPath $OutputZipPath) { throw 'Output ZIP already exists; select a new name.' }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $OutputZipPath) -PathType Container)) { throw 'Output ZIP parent directory must exist.' }
& python $verifier verify $Dlss5BundlePath
if ($LASTEXITCODE -ne 0) { throw 'Engine bundle integrity validation failed.' }
# Reject an ARM64/x86 application paired with the AMD64 engine without execution.
& python -c "import importlib.util,sys; s=importlib.util.spec_from_file_location('bundle',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.verify_pe(sys.argv[2])" $verifier $BinaryPath
if ($LASTEXITCODE -ne 0) { throw 'The application must be a Windows AMD64 PE32+ executable.' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('xai-windows-package-' + [guid]::NewGuid().ToString('N'))
$temporaryZip = Join-Path (Split-Path -Parent $OutputZipPath) ('.xai-package-' + [guid]::NewGuid().ToString('N') + '.zip')
$engine = Join-Path $stage 'runtimes\dlss5'
try {
    [void](New-Item -ItemType Directory -Force -Path $engine)
    Copy-Item -LiteralPath $BinaryPath -Destination (Join-Path $stage 'image-studio.exe')
    Get-ChildItem -LiteralPath $Dlss5BundlePath -Force | Copy-Item -Destination $engine -Recurse -Force
    & python $verifier verify $engine
    if ($LASTEXITCODE -ne 0) { throw 'Staged engine integrity validation failed.' }
    Set-Content -LiteralPath (Join-Path $stage 'README-Windows.txt') -Encoding UTF8 -Value @(
        'Extract this complete ZIP. Keep image-studio.exe and runtimes/dlss5 together.'
        'Python and DLSS5Tool installation are not required.'
        'Compatible NVIDIA RTX hardware/driver and the system WebView2 Runtime are required.'
        'The fixed-WebView portable edition includes WebView2 when needed.'
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $temporaryZip)
    # File.Move refuses an existing destination, including one created after
    # our initial check. Cleanup never touches a file owned by another writer.
    [IO.File]::Move($temporaryZip, $OutputZipPath)
} finally {
    if (Test-Path -LiteralPath $temporaryZip -PathType Leaf) { Remove-Item -LiteralPath $temporaryZip -Force }
    if (Test-Path -LiteralPath $stage -PathType Container) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
[ordered]@{ archivePath = $OutputZipPath; sha256 = (Get-FileHash -LiteralPath $OutputZipPath -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json
