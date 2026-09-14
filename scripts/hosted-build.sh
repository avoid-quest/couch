#!/bin/bash
# Run inside the pinned Debian builder, on its Linux filesystem.
set -euo pipefail
test "$(uname -m)" = x86_64
test -n "${COUCH_UPDATER_PUBLIC_KEY:-}"
test -n "${TAURI_SIGNING_PRIVATE_KEY:-}"
bun install --frozen-lockfile
bun run package:build
version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
output=.artifacts/hosted-release
rm -rf "$output/public"
mkdir -p "$output/public"
cp "src-tauri/target/release/bundle/appimage/Couch_${version}_amd64.AppImage"{,.sig} "$output/public/"
bun scripts/package-setup.ts "$version" "$output/public"
for archive in "$output/public"/*.tar.gz; do bunx --no-install tauri signer sign "$archive"; done
# Only the signing commands receive the private signing environment.
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
bun scripts/hosted-release.ts seal "$output"
