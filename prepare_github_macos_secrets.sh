#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Collects macOS formal distribution secrets on a Mac and optionally uploads them to GitHub Actions secrets.

SCRIPT_NAME="$(basename "$0")"
DEFAULT_OUTPUT_FILE="github-macos-secrets-import.sh"

# Function summary:
# Writes an informational log line for progress visibility.
log_info() {
  printf '[INFO] %s\n' "$*"
}

# Function summary:
# Writes a warning log line for non-fatal situations.
log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

# Function summary:
# Writes an error log line and terminates immediately.
fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

# Function summary:
# Verifies that a required command exists before continuing.
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing command: $1"
  fi
}

# Function summary:
# Prints the script usage for manual invocation.
usage() {
  cat <<EOF
Usage:
  $SCRIPT_NAME --repo owner/repo --p12 /path/to/certificate.p12 --api-key-file /path/to/AuthKey.p8 --api-key-id KEYID --api-issuer ISSUER [options]

Options:
  --repo <owner/repo>              GitHub repository name.
  --certificate-name <name>        Developer ID Application certificate name. Auto-detected when omitted.
  --p12 <path>                     Exported .p12 certificate path.
  --p12-password <password>        Password used to export the .p12 certificate. Prompts when omitted.
  --keychain-password <password>   Password for temporary CI keychain. Generated when omitted.
  --api-key-file <path>            App Store Connect API key .p8 file path.
  --api-key-id <id>                App Store Connect API key ID.
  --api-issuer <issuer>            App Store Connect issuer ID.
  --output <path>                  Write gh import script to this path. Default: $DEFAULT_OUTPUT_FILE
  --apply                          Apply secrets to GitHub directly with gh CLI.
  --help                           Show this help message.

Examples:
  $SCRIPT_NAME --repo oopsylol/openvshot --p12 ~/Desktop/openvshot.p12 --api-key-file ~/Downloads/AuthKey_ABC123XYZ.p8 --api-key-id ABC123XYZ --api-issuer 00000000-0000-0000-0000-000000000000
  $SCRIPT_NAME --repo oopsylol/openvshot --p12 ~/Desktop/openvshot.p12 --api-key-file ~/Downloads/AuthKey_ABC123XYZ.p8 --api-key-id ABC123XYZ --api-issuer 00000000-0000-0000-0000-000000000000 --apply
EOF
}

# Function summary:
# Reads a secret value from standard input without echoing it to the terminal.
prompt_secret() {
  local prompt_message="$1"
  local secret_value=""
  read -r -s -p "$prompt_message" secret_value
  printf '\n' >&2
  printf '%s' "$secret_value"
}

# Function summary:
# Picks a single Developer ID Application identity from the keychain or fails if ambiguous.
detect_certificate_name() {
  local matches=()
  while IFS= read -r line; do
    matches+=("$line")
  done < <(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p')

  if [[ ${#matches[@]} -eq 0 ]]; then
    fail "No Developer ID Application certificate found in the current keychain."
  fi

  if [[ ${#matches[@]} -gt 1 ]]; then
    printf '[ERROR] Multiple Developer ID Application certificates were found:\n' >&2
    printf '  %s\n' "${matches[@]}" >&2
    fail "Pass --certificate-name explicitly."
  fi

  printf '%s' "${matches[0]}"
}

# Function summary:
# Generates a strong random password when the caller does not provide one.
generate_keychain_password() {
  openssl rand -base64 24 | tr -d '\n'
}

# Function summary:
# Escapes a value for safe single-line shell usage.
shell_escape() {
  python3 -c 'import shlex,sys; print(shlex.quote(sys.argv[1]))' "$1"
}

# Function summary:
# Writes a helper script that can import all required secrets into GitHub Actions.
write_import_script() {
  local output_file="$1"
  local repo="$2"
  local certificate_name="$3"
  local certificate_base64="$4"
  local p12_password="$5"
  local keychain_password="$6"
  local api_key_content="$7"
  local api_key_id="$8"
  local api_issuer="$9"

  cat >"$output_file" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# File summary:
# Imports OpenVshot macOS formal distribution secrets into GitHub Actions with gh CLI.

REPO=$(shell_escape "$repo")

printf '%s' $(shell_escape "$certificate_name") | gh secret set CSC_NAME --repo "\$REPO"
printf '%s' $(shell_escape "$certificate_base64") | gh secret set BUILD_CERTIFICATE_BASE64 --repo "\$REPO"
printf '%s' $(shell_escape "$p12_password") | gh secret set P12_PASSWORD --repo "\$REPO"
printf '%s' $(shell_escape "$keychain_password") | gh secret set KEYCHAIN_PASSWORD --repo "\$REPO"
cat <<'SECRET_EOF' | gh secret set APPLE_API_KEY --repo "\$REPO"
$api_key_content
SECRET_EOF
printf '%s' $(shell_escape "$api_key_id") | gh secret set APPLE_API_KEY_ID --repo "\$REPO"
printf '%s' $(shell_escape "$api_issuer") | gh secret set APPLE_API_ISSUER --repo "\$REPO"

printf 'GitHub Actions secrets updated for %s\n' "\$REPO"
EOF

  chmod 700 "$output_file"
}

REPO=""
CERTIFICATE_NAME=""
P12_PATH=""
P12_PASSWORD="${P12_PASSWORD:-}"
KEYCHAIN_PASSWORD="${KEYCHAIN_PASSWORD:-}"
API_KEY_FILE=""
API_KEY_ID=""
API_ISSUER=""
OUTPUT_FILE="$DEFAULT_OUTPUT_FILE"
APPLY_SECRETS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --certificate-name)
      CERTIFICATE_NAME="${2:-}"
      shift 2
      ;;
    --p12)
      P12_PATH="${2:-}"
      shift 2
      ;;
    --p12-password)
      P12_PASSWORD="${2:-}"
      shift 2
      ;;
    --keychain-password)
      KEYCHAIN_PASSWORD="${2:-}"
      shift 2
      ;;
    --api-key-file)
      API_KEY_FILE="${2:-}"
      shift 2
      ;;
    --api-key-id)
      API_KEY_ID="${2:-}"
      shift 2
      ;;
    --api-issuer)
      API_ISSUER="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
      shift 2
      ;;
    --apply)
      APPLY_SECRETS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "${OSTYPE:-}" != darwin* ]]; then
  fail "This script must run on macOS."
fi

require_command security
require_command openssl
require_command python3

[[ -n "$REPO" ]] || fail "Missing --repo"
[[ -n "$P12_PATH" ]] || fail "Missing --p12"
[[ -n "$API_KEY_FILE" ]] || fail "Missing --api-key-file"
[[ -n "$API_KEY_ID" ]] || fail "Missing --api-key-id"
[[ -n "$API_ISSUER" ]] || fail "Missing --api-issuer"
[[ -f "$P12_PATH" ]] || fail "P12 file not found: $P12_PATH"
[[ -f "$API_KEY_FILE" ]] || fail "API key file not found: $API_KEY_FILE"

if [[ -z "$CERTIFICATE_NAME" ]]; then
  CERTIFICATE_NAME="$(detect_certificate_name)"
  log_info "Auto-detected certificate: $CERTIFICATE_NAME"
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -F "\"$CERTIFICATE_NAME\"" >/dev/null 2>&1; then
  fail "Certificate not found in current keychain: $CERTIFICATE_NAME"
fi

if [[ -z "$P12_PASSWORD" ]]; then
  P12_PASSWORD="$(prompt_secret 'P12 password: ')"
fi

if [[ -z "$P12_PASSWORD" ]]; then
  fail "P12 password cannot be empty."
fi

if [[ -z "$KEYCHAIN_PASSWORD" ]]; then
  KEYCHAIN_PASSWORD="$(generate_keychain_password)"
  log_info "Generated KEYCHAIN_PASSWORD automatically."
fi

P12_BASE64="$(base64 <"$P12_PATH" | tr -d '\n')"
API_KEY_CONTENT="$(cat "$API_KEY_FILE")"

[[ -n "$P12_BASE64" ]] || fail "Failed to encode P12 certificate."
[[ -n "$API_KEY_CONTENT" ]] || fail "API key file is empty: $API_KEY_FILE"

write_import_script \
  "$OUTPUT_FILE" \
  "$REPO" \
  "$CERTIFICATE_NAME" \
  "$P12_BASE64" \
  "$P12_PASSWORD" \
  "$KEYCHAIN_PASSWORD" \
  "$API_KEY_CONTENT" \
  "$API_KEY_ID" \
  "$API_ISSUER"

log_info "Import script written to: $OUTPUT_FILE"

if [[ "$APPLY_SECRETS" -eq 1 ]]; then
  require_command gh
  if ! gh auth status >/dev/null 2>&1; then
    fail "gh CLI is not authenticated. Run: gh auth login"
  fi
  log_info "Applying GitHub Actions secrets to $REPO"
  bash "$OUTPUT_FILE"
else
  log_warn "Secrets were not uploaded yet. Run the generated script manually or re-run with --apply."
fi

printf '\nSummary:\n'
printf '  Repo: %s\n' "$REPO"
printf '  Certificate: %s\n' "$CERTIFICATE_NAME"
printf '  P12: %s\n' "$P12_PATH"
printf '  API key: %s\n' "$API_KEY_FILE"
printf '  Output: %s\n' "$OUTPUT_FILE"
