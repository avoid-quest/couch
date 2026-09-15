#!/bin/bash
# This is package qualification. Pristine desktop/TV and hosted A-to-B acceptance is #277.
set -euo pipefail
test -z "${TAURI_SIGNING_PRIVATE_KEY:-}${CN_API_KEY:-}"
# A failed retry must not retain a receipt from an earlier qualification attempt.
rm -f .artifacts/hosted-release/qualified.json
bun scripts/hosted-release.ts verify .artifacts/hosted-release
bun run typecheck
bun test ./tests/linux/iptv-clock.test.ts
bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
cargo test --manifest-path src-tauri/Cargo.toml --locked --release
# Inspect the signed package without running application code as root.
version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
inspection=$(mktemp -d)
trap 'rm -rf "$inspection"' EXIT
if [ "${COUCH_PACKAGE_FORMAT:-appimage}" = deb ]; then
  dpkg-deb --extract ".artifacts/hosted-release/public/Couch_${version}_amd64.deb" "$inspection"
  cmp src-tauri/resources/release.json "$inspection/usr/lib/Couch/release.json"
else
  app=$(realpath ".artifacts/hosted-release/public/Couch_${version}_amd64.AppImage")
  (cd "$inspection" && "$app" --appimage-extract usr/lib/Couch/release.json)
  cmp src-tauri/resources/release.json "$inspection/squashfs-root/usr/lib/Couch/release.json"
fi
# The workflow writes qualified.json only after the separate installer fixture passes.
