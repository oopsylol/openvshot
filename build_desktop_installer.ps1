param(
  [string]$Npm = "npm"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = Join-Path $root "apps\desktop"

if (-not (Test-Path $desktop)) {
  throw "Desktop app directory not found: $desktop"
}

Set-Location $desktop

Write-Host "Building OpenVshot desktop installer..."
& $Npm run dist

Write-Host ""
Write-Host "Build complete:"
Write-Host "  $desktop\release\OpenVshot Setup *.exe"
