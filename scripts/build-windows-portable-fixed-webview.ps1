param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Architecture,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$BinaryPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputZipPath
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
$stageRoot = Join-Path $repoRoot "dist\portable-fixed-webview\$Architecture"
$runtimeStage = Join-Path $stageRoot "WebView2FixedRuntime"

if (Test-Path $stageRoot) {
  Remove-Item -Recurse -Force $stageRoot
}
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

$downloadInfo = Get-WebView2DownloadInfo -RequestedArchitecture $Architecture
$cabPath = Join-Path $env:RUNNER_TEMP "Microsoft.WebView2.FixedVersionRuntime.$($downloadInfo.Version).$Architecture.cab"

Invoke-WebRequest -UseBasicParsing -Uri $downloadInfo.Url -OutFile $cabPath
Expand-CabToDirectory -CabPath $cabPath -Destination $runtimeStage

$resolvedRuntimeDir = Resolve-WebView2RuntimeDir -Root $runtimeStage
$resolvedRuntimeDirItem = Get-Item -LiteralPath $resolvedRuntimeDir
if ($resolvedRuntimeDirItem.FullName -ne (Get-Item -LiteralPath $runtimeStage).FullName) {
  $tempRoot = Join-Path $env:RUNNER_TEMP ("webview2-fixed-" + [guid]::NewGuid().ToString("N"))
  if (Test-Path $tempRoot) {
    Remove-Item -Recurse -Force $tempRoot
  }
  Move-Item -LiteralPath $resolvedRuntimeDir -Destination $tempRoot
  Remove-Item -Recurse -Force $runtimeStage
  Move-Item -LiteralPath $tempRoot -Destination $runtimeStage
}

Copy-Item -LiteralPath $BinaryPath -Destination (Join-Path $stageRoot "image-studio.exe")
Grant-WebView2RuntimeAcl -RuntimeRoot $runtimeStage

$readme = @"
Image Studio portable package with bundled Fixed Version WebView2 Runtime.

Version: $Version
WebView2 Fixed Runtime: $($downloadInfo.Version)
Architecture: $Architecture

Usage:
1. Extract the entire zip to a local folder.
2. Keep image-studio.exe and the WebView2FixedRuntime folder together.
3. Launch image-studio.exe directly.

Notes:
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
Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $OutputZipPath
