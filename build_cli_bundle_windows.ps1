param(
  [string]$Python = "python",
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $root "release"
}

$exePath = Join-Path $root "dist\vshot.exe"
if (-not (Test-Path $exePath)) {
  & (Join-Path $root "build_openvshot_exe.ps1") -Python $Python
}

$bundleDir = Join-Path $OutputRoot "cli-windows"
$archivePath = Join-Path $OutputRoot "openvshot-cli-windows-x64.zip"

if (Test-Path $bundleDir) {
  Remove-Item -Recurse -Force $bundleDir
}
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

Copy-Item $exePath (Join-Path $bundleDir "vshot.exe") -Force
Copy-Item (Join-Path $root "install_vshot.ps1") (Join-Path $bundleDir "install_vshot.ps1") -Force
Copy-Item (Join-Path $root "vshot.bat") (Join-Path $bundleDir "vshot.bat") -Force
Copy-Item (Join-Path $root "vshot.ps1") (Join-Path $bundleDir "vshot.ps1") -Force

@"
OpenVshot CLI (Windows)

Quick start:
1. Run install_vshot.ps1
2. Open a new terminal
3. Run: vshot --help
"@ | Set-Content -Path (Join-Path $bundleDir "README.txt") -Encoding UTF8

if (Test-Path $archivePath) {
  Remove-Item -Force $archivePath
}
Compress-Archive -Path (Join-Path $bundleDir "*") -DestinationPath $archivePath -Force

Write-Host ""
Write-Host "CLI bundle created:"
Write-Host "  $archivePath"
