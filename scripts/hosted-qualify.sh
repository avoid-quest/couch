#!/bin/bash
# This is package qualification. Pristine desktop/TV and hosted A-to-B acceptance is #277.
set -euo pipefail
test -z "${TAURI_SIGNING_PRIVATE_KEY:-}${CN_API_KEY:-}"
bun scripts/hosted-release.ts verify .artifacts/hosted-release
bun run typecheck
bun test ./tests/linux/iptv-clock.test.ts
bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
cargo test --manifest-path src-tauri/Cargo.toml --locked --release
# Inspect the signed artifact through the standard runtime, never AppRun.
version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
app=$(realpath ".artifacts/hosted-release/public/Couch_${version}_amd64.AppImage")
inspection=$(mktemp -d)
trap 'rm -rf "$inspection"' EXIT
(cd "$inspection" && "$app" --appimage-extract usr/lib/Couch/release.json)
cmp src-tauri/resources/release.json "$inspection/squashfs-root/usr/lib/Couch/release.json"
bun -e 'const manifest = await Bun.file(".artifacts/hosted-release/manifest.json").json(); await Bun.write(".artifacts/hosted-release/qualified.json", JSON.stringify({version: manifest.version, revision: manifest.revision, files: manifest.files, checks: ["signatures", "typecheck", "bun", "native", "signed-manifest-extraction"]}, null, 2))'
