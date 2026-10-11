param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("x64", "arm64")]
    [string]$Architecture,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$Publisher,

    [Parameter(Mandatory = $true)]
    [string]$IdentityName,

    [Parameter(Mandatory = $true)]
    [string]$PublisherDisplayName,

    [Parameter(Mandatory = $true)]
    [string]$SourceExe,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-WindowsSdkTool([string]$toolName) {
    $command = Get-Command $toolName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (-not (Test-Path -LiteralPath $kitsRoot)) {
        throw "$toolName not found in PATH and Windows SDK bin directory is missing."
    }

    $candidate = Get-ChildItem -Path $kitsRoot -Filter $toolName -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\$([regex]::Escape($toolName))$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if (-not $candidate) {
        throw "$toolName not found under Windows SDK bin directory."
    }

    return $candidate.FullName
}

function Expand-Version([string]$version) {
    if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "MSIX package version must be semver core x.y.z, got: $version"
    }
    return "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
}

function Test-MsixManifest([string]$manifest) {
    if ($manifest -match '<uap:Extension\s+Category="windows\.fullTrustProcess"') {
        throw "MSIX manifest must declare windows.fullTrustProcess with desktop:Extension, not uap:Extension."
    }
    if ($manifest -notmatch 'xmlns:desktop="http://schemas\.microsoft\.com/appx/manifest/desktop/windows10"') {
        throw "MSIX manifest is missing the desktop namespace required by windows.fullTrustProcess."
    }
    if ($manifest -notmatch '<desktop:Extension\s+Category="windows\.fullTrustProcess"') {
        throw "MSIX manifest is missing the desktop full-trust extension declaration."
    }
    if ($manifest -notmatch '<desktop:FullTrustProcess\s*/?>') {
        throw "MSIX manifest is missing desktop:FullTrustProcess."
    }
    if ($manifest -match 'unvirtualizedResources') {
        throw "MSIX manifest should not request unvirtualizedResources unless virtualization exclusions are intentionally configured."
    }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageVersion = Expand-Version $Version
$makeAppx = Get-WindowsSdkTool "makeappx.exe"
$sourceExePath = (Resolve-Path -LiteralPath $SourceExe).Path
$outputFile = [IO.Path]::GetFullPath($OutputPath)
$tempRoot = Join-Path $env:RUNNER_TEMP ("msix-" + $Architecture + "-" + [guid]::NewGuid().ToString("N"))
$packageRoot = Join-Path $tempRoot "package"
$assetsDir = Join-Path $packageRoot "Assets"
$manifestTemplate = Join-Path $root "image-studio/build/windows/msix/AppxManifest.xml.tmpl"
$manifestPath = Join-Path $packageRoot "AppxManifest.xml"

try {
    New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

    Copy-Item -LiteralPath $sourceExePath -Destination (Join-Path $packageRoot "image-studio.exe")

    python3 (Join-Path $root "scripts/generate-msix-assets.py") `
        (Join-Path $root "image-studio/build/appicon.png") `
        $assetsDir

    $manifest = Get-Content -LiteralPath $manifestTemplate -Raw
    $manifest = $manifest.Replace("{{PACKAGE_IDENTITY_NAME}}", $IdentityName)
    $manifest = $manifest.Replace("{{PACKAGE_PUBLISHER}}", $Publisher)
    $manifest = $manifest.Replace("{{PACKAGE_VERSION}}", $packageVersion)
    $manifest = $manifest.Replace("{{PROCESSOR_ARCHITECTURE}}", $Architecture)
    $manifest = $manifest.Replace("{{DISPLAY_NAME}}", "Image-Studio")
    $manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", $PublisherDisplayName)
    $manifest = $manifest.Replace("{{DESCRIPTION}}", "Open-source image generation and editing desktop app")
    Test-MsixManifest $manifest
    Set-Content -LiteralPath $manifestPath -Value $manifest -Encoding UTF8

    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($outputFile)) | Out-Null
    if (Test-Path -LiteralPath $outputFile) {
        Remove-Item -LiteralPath $outputFile -Force
    }

    & $makeAppx pack /d $packageRoot /p $outputFile /o
    if ($LASTEXITCODE -ne 0) {
        throw "makeappx pack failed with exit code $LASTEXITCODE."
    }
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
