#!/bin/bash
# Run inside the pinned Debian builder, on its Linux filesystem.
set -euo pipefail
test "$(uname -m)" = x86_64
test -n "${COUCH_UPDATER_PUBLIC_KEY:-}"
test -n "${TAURI_SIGNING_PRIVATE_KEY:-}"
export COUCH_PACKAGE_FORMAT="${1:-deb}"
bun install --frozen-lockfile
bun run package:build "$COUCH_PACKAGE_FORMAT"
version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
output=.artifacts/hosted-release
rm -rf "$output/public"
mkdir -p "$output/public"
if [ "$COUCH_PACKAGE_FORMAT" = deb ]; then
  mkdir -p "$output/signatures"
  bun x --no-install tauri signer sign "src-tauri/target/release/bundle/deb/Couch_${version}_amd64.deb"
  cp "src-tauri/target/release/bundle/deb/Couch_${version}_amd64.deb" "$output/public/"
  cp "src-tauri/target/release/bundle/deb/Couch_${version}_amd64.deb.sig" "$output/signatures/"
fi
bun scripts/hosted-release.ts seal "$output"
bun x --no-install tauri signer sign "$output/manifest.json"
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
