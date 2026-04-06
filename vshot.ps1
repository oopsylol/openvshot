$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $scriptDir "vshot.exe"
if (Test-Path $exePath) {
  & $exePath @args
} else {
  python (Join-Path $scriptDir "scu_cli.py") @args
}
