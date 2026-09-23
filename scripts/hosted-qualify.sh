#!/bin/bash
# This is package qualification. Pristine desktop/TV and hosted A-to-B acceptance is #277.
set -euo pipefail
test -z "${TAURI_SIGNING_PRIVATE_KEY:-}${CN_API_KEY:-}"
# A failed retry must not retain a receipt from an earlier qualification attempt.
rm -f .artifacts/hosted-release/qualified.json
bun scripts/hosted-release.ts verify .artifacts/hosted-release
bun run typecheck
bun test --parallel=4 ./tests/linux/iptv-clock.test.ts
bun test --parallel=4 --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
cargo test --manifest-path src-tauri/Cargo.toml --locked --release
# Inspect the signed package without running application code as root.
version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
inspection=$(mktemp -d)
trap 'rm -rf "$inspection"' EXIT
if [ "${1:-deb}" = deb ]; then
  dpkg-deb --extract ".artifacts/hosted-release/public/Couch_${version}_amd64.deb" "$inspection"
else
  (cd "$inspection" && "$OLDPWD/.artifacts/hosted-release/public/Couch_${version}_amd64.AppImage" --appimage-extract usr/lib/Couch/release.json > /dev/null)
  mv "$inspection/squashfs-root" "$inspection/app"
fi
cmp src-tauri/resources/release.json "${inspection}/$( [ "${1:-deb}" = deb ] && echo usr || echo app/usr )/lib/Couch/release.json"
# The workflow writes qualified.json only after the separate installer fixture passes.
