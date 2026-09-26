#!/bin/bash
set -euo pipefail
[[ $(uname -m) = arm64 ]] || { echo 'Build the Apple Silicon DMG on an Apple Silicon Mac' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Package a clean committed source revision' >&2; exit 1; }
export COUCH_PACKAGE_FORMAT=dmg
bun scripts/package-mac-prepare.ts
export COUCH_MPV_PREFIX="$(pwd)/src-tauri/resources/mac-mpv"
bun scripts/desktop.ts build --bundles app,dmg --config .artifacts/tauri-mac.conf.json -- --locked
bun scripts/package-mac-verify.ts
