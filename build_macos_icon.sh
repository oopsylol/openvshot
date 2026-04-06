#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ICON="${1:-${OPENVSHOT_ICON_SOURCE:-$ROOT_DIR/apps/desktop/src/assets/icon.png}}"
BUILD_DIR="$ROOT_DIR/apps/desktop/build"
ICONSET_DIR="$BUILD_DIR/icon.iconset"
OUTPUT_ICNS="$BUILD_DIR/icon.icns"

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "This script must run on macOS."
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "Missing command: sips"
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "Missing command: iconutil"
  exit 1
fi

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Icon source not found: $SOURCE_ICON"
  exit 1
fi

mkdir -p "$BUILD_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

WIDTH="$(sips -g pixelWidth "$SOURCE_ICON" | awk '/pixelWidth:/ {print $2}')"
HEIGHT="$(sips -g pixelHeight "$SOURCE_ICON" | awk '/pixelHeight:/ {print $2}')"
if [[ -n "$WIDTH" && -n "$HEIGHT" ]]; then
  echo "Icon source: ${WIDTH}x${HEIGHT}"
  if (( WIDTH < 1024 || HEIGHT < 1024 )); then
    echo "Warning: source icon is smaller than 1024x1024. macOS icon will be upscaled."
  fi
fi

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  sips -z "$double_size" "$double_size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"
rm -rf "$ICONSET_DIR"

echo
echo "Build done:"
echo "  $OUTPUT_ICNS"
