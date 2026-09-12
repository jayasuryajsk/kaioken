#!/bin/sh
set -eu

REPO=${KAIOKEN_DESKTOP_REPO:-jayasuryajsk/kaioken}
CHANNEL=${KAIOKEN_DESKTOP_CHANNEL:-desktop-latest}
INSTALL_DIR=${KAIOKEN_INSTALL_DIR:-/Applications}
BASE="https://github.com/$REPO/releases/download/$CHANNEL"

fail() {
  printf 'kaioken desktop install: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "this installer is for macOS"
[ "$(uname -m)" = arm64 ] || fail "only Apple silicon builds are published"
command -v ditto >/dev/null 2>&1 || fail "ditto is missing"

feed=$(curl -fsSL "$BASE/latest-mac.yml") || fail "could not read the release feed"
archive=$(printf '%s\n' "$feed" | sed -n 's/^path: *//p' | head -n 1)
expected=$(printf '%s\n' "$feed" | sed -n 's/^sha512: *//p' | head -n 1)
version=$(printf '%s\n' "$feed" | sed -n 's/^version: *//p' | head -n 1)
[ -n "$archive" ] && [ -n "$expected" ] || fail "release feed has no archive"

case "$archive" in
  http://*|https://*) url=$archive; archive=$(basename "$archive") ;;
  *) url="$BASE/$archive" ;;
esac

work=$(mktemp -d "${TMPDIR:-/tmp}/kaioken-desktop.XXXXXX")
trap 'rm -rf "$work"' EXIT

printf 'Downloading Kaioken %s\n' "$version"
curl -fL --progress-bar --retry 3 -o "$work/$archive" "$url" || fail "download failed"

actual=$(openssl dgst -sha512 -binary "$work/$archive" | openssl base64 -A)
[ "$actual" = "$expected" ] || fail "checksum mismatch; the download is corrupt"

ditto -xk "$work/$archive" "$work/extract" || fail "could not extract the archive"
bundle=$(find "$work/extract" -maxdepth 1 -name '*.app' | head -n 1)
[ -n "$bundle" ] || fail "no app bundle in the archive"

mkdir -p "$INSTALL_DIR" || fail "cannot write to $INSTALL_DIR"
target="$INSTALL_DIR/$(basename "$bundle")"
if [ "$INSTALL_DIR" = /Applications ]; then
  osascript -e 'tell application "Kaioken" to quit' >/dev/null 2>&1 || true
fi
rm -rf "$target.installing"
ditto "$bundle" "$target.installing" || fail "could not copy the app into $INSTALL_DIR"
rm -rf "$target"
mv "$target.installing" "$target"
xattr -dr com.apple.quarantine "$target" 2>/dev/null || true

printf 'Installed %s\n' "$target"
if [ "$INSTALL_DIR" = /Applications ]; then
  open "$target"
fi
