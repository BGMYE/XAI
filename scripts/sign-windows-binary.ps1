param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-SignToolPath {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (-not (Test-Path -LiteralPath $kitsRoot)) {
        throw "signtool.exe not found in PATH and Windows SDK bin directory is missing."
    }

    $candidate = Get-ChildItem -Path $kitsRoot -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1

    if (-not $candidate) {
        throw "signtool.exe not found under Windows SDK bin directory."
    }

    return $candidate.FullName
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$certBase64 = $env:IMAGE_STUDIO_WINDOWS_CERT_BASE64
$certPassword = $env:IMAGE_STUDIO_WINDOWS_CERT_PASSWORD
$timestampUrl = if ([string]::IsNullOrWhiteSpace($env:IMAGE_STUDIO_WINDOWS_TIMESTAMP_URL)) {
    "http://timestamp.acs.microsoft.com"
} else {
    $env:IMAGE_STUDIO_WINDOWS_TIMESTAMP_URL.Trim()
}

if ([string]::IsNullOrWhiteSpace($certBase64)) {
    throw "Missing IMAGE_STUDIO_WINDOWS_CERT_BASE64."
}

if ([string]::IsNullOrWhiteSpace($certPassword)) {
    throw "Missing IMAGE_STUDIO_WINDOWS_CERT_PASSWORD."
}

$tempPfx = Join-Path $env:RUNNER_TEMP ("image-studio-codesign-" + [guid]::NewGuid().ToString("N") + ".pfx")
$signtool = Get-SignToolPath

try {
    [IO.File]::WriteAllBytes($tempPfx, [Convert]::FromBase64String($certBase64))

    & $signtool sign `
        /fd SHA256 `
        /td SHA256 `
        /tr $timestampUrl `
        /f $tempPfx `
        /p $certPassword `
        $resolvedPath
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed with exit code $LASTEXITCODE."
    }

    & $signtool verify /pa /all $resolvedPath
    if ($LASTEXITCODE -ne 0) {
        throw "signtool verify failed with exit code $LASTEXITCODE."
    }

    $signature = Get-AuthenticodeSignature -FilePath $resolvedPath
    if ($signature.Status -ne "Valid") {
        throw "Authenticode verification returned status '$($signature.Status)'."
    }

    $subject = $signature.SignerCertificate.Subject
    Write-Host "Signed $resolvedPath"
    Write-Host "Signer: $subject"
    Write-Host "Timestamp: $timestampUrl"
} finally {
    if (Test-Path -LiteralPath $tempPfx) {
        Remove-Item -LiteralPath $tempPfx -Force
    }
}
