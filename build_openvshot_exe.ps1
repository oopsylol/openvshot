param(
  [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

& $Python -m pip install --upgrade pyinstaller
& $Python -m PyInstaller --noconfirm --clean --onefile --name vshot scu_cli.py

Write-Host ""
Write-Host "Build done:"
Write-Host "  $root\dist\vshot.exe"
