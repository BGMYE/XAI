param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Architecture,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$BinaryPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputZipPath,

  [string]$Dlss5BundlePath = $env:XAI_DLSS5_BUNDLE
)

$ErrorActionPreference = "Stop"

function Get-WebView2DownloadInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RequestedArchitecture
  )

  $page = Invoke-WebRequest -UseBasicParsing -Uri "https://developer.microsoft.com/en-us/microsoft-edge/webview2"
  $content = $page.Content
  $needle = "Microsoft.WebView2.FixedVersionRuntime."
  $index = $content.IndexOf($needle)
  if ($index -lt 0) {
    throw "Unable to locate Fixed Version WebView2 metadata on the Microsoft download page."
  }

  $jsonStart = $content.LastIndexOf('[', $index)
  if ($jsonStart -lt 0) {
    throw "Unable to locate WebView2 metadata JSON payload."
  }

  $jsonEndToken = "</script>"
  $jsonEnd = $content.IndexOf($jsonEndToken, $jsonStart)
  if ($jsonEnd -lt 0) {
    throw "Unable to locate the end of the WebView2 metadata payload."
  }

  $jsonPayload = $content.Substring($jsonStart, $jsonEnd - $jsonStart)
  $items = $null
  for ($i = 0; $i -lt 8; $i++) {
    try {
      $items = $jsonPayload | ConvertFrom-Json -Depth 32
      break
    } catch {
      $lastBracket = $jsonPayload.LastIndexOf(']')
      if ($lastBracket -lt 0) {
        break
      }
      $jsonPayload = $jsonPayload.Substring(0, $lastBracket)
    }
  }
  if (-not $items) {
    throw "Unable to parse Fixed Version WebView2 metadata from the Microsoft download page."
  }

  foreach ($item in $items) {
    if ($null -eq $item.builds) {
      continue
    }
    foreach ($build in $item.builds) {
      if ($build.architecture -eq $RequestedArchitecture) {
        return [PSCustomObject]@{
          Version = $item.version
          Url = $build.url
        }
      }
    }
  }

  throw "Unable to find a Fixed Version WebView2 package for architecture '$RequestedArchitecture'."
}

function Expand-CabToDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CabPath,

    [Parameter(Mandatory = $true)]
    [string]$Destination
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $expandExe = Join-Path $env:SystemRoot "System32\expand.exe"
  & $expandExe $CabPath "-F:*" $Destination | Out-Null
}

function Resolve-WebView2RuntimeDir {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $runtimeExe = Get-ChildItem -Path $Root -Recurse -Filter "msedgewebview2.exe" -File | Select-Object -First 1
  if (-not $runtimeExe) {
    throw "Expanded Fixed Version package does not contain msedgewebview2.exe."
  }
  return $runtimeExe.Directory.FullName
}

function Grant-WebView2RuntimeAcl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot
  )

  & icacls $RuntimeRoot /grant "*S-1-15-2-2:(OI)(CI)(RX)" | Out-Null
  & icacls $RuntimeRoot /grant "*S-1-15-2-1:(OI)(CI)(RX)" | Out-Null
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundleVerifier = Join-Path $repoRoot "image-studio/scripts/dlss5/bundle.py"
if ($Architecture -eq "x64") {
  if ([string]::IsNullOrWhiteSpace($Dlss5BundlePath)) {
    throw "Windows x64 packages require the complete DLSS5 bundle. Set -Dlss5BundlePath or XAI_DLSS5_BUNDLE."
  }
  $Dlss5BundlePath = (Resolve-Path -LiteralPath $Dlss5BundlePath).Path
  & python $bundleVerifier verify $Dlss5BundlePath
  if ($LASTEXITCODE -ne 0) { throw "DLSS5 bundle verification failed; refusing to build the enhanced portable package." }
} elseif (-not [string]::IsNullOrWhiteSpace($Dlss5BundlePath)) {
  throw "The DLSS5 bundle supports Windows x64 only. ARM64 packages must not include this runtime."
}
$stageRoot = Join-Path $repoRoot "dist\portable-fixed-webview\$Architecture"
$runtimeStage = Join-Path $stageRoot "WebView2FixedRuntime"
$tempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
if ($Architecture -eq "x64") {
  $sourcePrefix = $Dlss5BundlePath.TrimEnd([char[]]@('\', '/')) + '\'
  $stagePrefix = [IO.Path]::GetFullPath($stageRoot).TrimEnd([char[]]@('\', '/')) + '\'
  if ($sourcePrefix.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase) -or
      $stagePrefix.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Dlss5BundlePath must not overlap the disposable portable staging directory."
  }
}

if (Test-Path $stageRoot) {
  Remove-Item -Recurse -Force $stageRoot
}
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$downloadInfo = Get-WebView2DownloadInfo -RequestedArchitecture $Architecture
$cabPath = Join-Path $tempBase "Microsoft.WebView2.FixedVersionRuntime.$($downloadInfo.Version).$Architecture.cab"

Invoke-WebRequest -UseBasicParsing -Uri $downloadInfo.Url -OutFile $cabPath
Expand-CabToDirectory -CabPath $cabPath -Destination $runtimeStage

$resolvedRuntimeDir = Resolve-WebView2RuntimeDir -Root $runtimeStage
$resolvedRuntimeDirItem = Get-Item -LiteralPath $resolvedRuntimeDir
if ($resolvedRuntimeDirItem.FullName -ne (Get-Item -LiteralPath $runtimeStage).FullName) {
  $tempRoot = Join-Path $tempBase ("webview2-fixed-" + [guid]::NewGuid().ToString("N"))
  if (Test-Path $tempRoot) {
    Remove-Item -Recurse -Force $tempRoot
  }
  Move-Item -LiteralPath $resolvedRuntimeDir -Destination $tempRoot
  Remove-Item -Recurse -Force $runtimeStage
  Move-Item -LiteralPath $tempRoot -Destination $runtimeStage
}

Copy-Item -LiteralPath $BinaryPath -Destination (Join-Path $stageRoot "image-studio.exe")
if ($Architecture -eq "x64") {
  $bundleStage = Join-Path $stageRoot "runtimes\dlss5"
  New-Item -ItemType Directory -Force -Path $bundleStage | Out-Null
  Get-ChildItem -LiteralPath $Dlss5BundlePath -Force | Copy-Item -Destination $bundleStage -Recurse -Force
  & python $bundleVerifier verify $bundleStage
  if ($LASTEXITCODE -ne 0) { throw "Staged DLSS5 bundle is incomplete; refusing to build the enhanced portable package." }
}
Grant-WebView2RuntimeAcl -RuntimeRoot $runtimeStage

$engineNote = if ($Architecture -eq "x64") {
  "- This x64 edition includes the complete runtimes/dlss5 engine. Keep its entire directory tree beside image-studio.exe. Compatible NVIDIA hardware and drivers are still required."
} else {
  "- This ARM64 edition does not include the x64-only DLSS5 engine."
}
$readme = @"
Image Studio portable package with bundled Fixed Version WebView2 Runtime.

Version: $Version
WebView2 Fixed Runtime: $($downloadInfo.Version)
Architecture: $Architecture

Usage:
1. Extract the entire zip to a local folder.
2. Keep image-studio.exe, WebView2FixedRuntime, and all runtimes folders together.
3. Launch image-studio.exe directly.

Notes:
$engineNote
- This package is for users who run the portable exe directly on machines without a stable system WebView2 runtime.
- Do not run it from a network share or UNC path.
- If you replace the bundled runtime manually, keep the folder structure intact and preserve msedgewebview2.exe inside WebView2FixedRuntime.
"@
Set-Content -LiteralPath (Join-Path $stageRoot "README-portable-fixed-webview.txt") -Value $readme -Encoding ASCII

$zipParent = Split-Path -Parent $OutputZipPath
New-Item -ItemType Directory -Force -Path $zipParent | Out-Null
if (Test-Path $OutputZipPath) {
  Remove-Item -Force $OutputZipPath
}
# ZipFile retains hidden files and supports large engine entries; Compress-Archive
# can omit hidden files and has a per-file size limit.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stageRoot, [IO.Path]::GetFullPath($OutputZipPath))
