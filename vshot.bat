@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%vshot.exe" (
  "%SCRIPT_DIR%vshot.exe" %*
) else (
  python "%SCRIPT_DIR%scu_cli.py" %*
)
endlocal
