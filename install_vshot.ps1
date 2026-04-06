param(
  [string]$SourceExe = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $SourceExe) {
  $SourceExe = Join-Path $root "dist\vshot.exe"
}

if (-not (Test-Path $SourceExe)) {
  throw "未找到可执行文件: $SourceExe，请先执行 build_openvshot_exe.ps1"
}

$targetDir = Join-Path $env:LOCALAPPDATA "OpenVShot\bin"
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$targetExe = Join-Path $targetDir "vshot.exe"
Copy-Item -Path $SourceExe -Destination $targetExe -Force

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @()
if ($userPath) { $parts = $userPath.Split(";") | Where-Object { $_ } }
if ($parts -notcontains $targetDir) {
  $newPath = ($parts + $targetDir) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "已将 $targetDir 写入用户 PATH（新终端生效）"
}

Write-Host "安装完成：$targetExe"
Write-Host "请新开终端后执行：vshot"
