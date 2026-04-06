#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "$ROOT_DIR"

"$PYTHON_BIN" -m pip install --upgrade pyinstaller
"$PYTHON_BIN" -m PyInstaller --noconfirm --clean --onefile --name vshot scu_cli.py

echo
echo "Build done:"
echo "  $ROOT_DIR/dist/vshot"
