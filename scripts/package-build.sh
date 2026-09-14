#!/bin/bash
set -euo pipefail
export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD)
export PATCHELF=/usr/bin/patchelf
export LDAI_RUNTIME_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/runtime-x86_64"
bun scripts/package-prepare.ts
# Tauri leaves this generated staging directory behind after a failed bundle.
rm -rf src-tauri/target/release/bundle/appimage_deb src-tauri/target/release/bundle/appimage
bun scripts/desktop.ts build --bundles appimage --config .artifacts/tauri-release.conf.json -- --locked
bun scripts/package-verify-helpers.ts
bun scripts/package-inventory.ts
