#!/bin/bash
set -euo pipefail
[[ $(uname -m) = arm64 ]] || { echo 'Build the Apple Silicon DMG on an Apple Silicon Mac' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Package a clean committed source revision' >&2; exit 1; }
export COUCH_PACKAGE_FORMAT=dmg
export COUCH_CLIENT_ONLY=1
bun scripts/package-mac-prepare.ts
bun scripts/desktop.ts build --bundles app,dmg --config .artifacts/tauri-mac.conf.json -- --locked --no-default-features
bun scripts/package-mac-verify.ts
