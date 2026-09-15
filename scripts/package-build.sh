#!/bin/bash
set -euo pipefail
export COUCH_PACKAGE_FORMAT="${1:-appimage}"
case "$COUCH_PACKAGE_FORMAT" in appimage|deb) ;; *) echo 'Use package:build [appimage|deb]' >&2; exit 1 ;; esac
export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD)
export PATCHELF=/usr/bin/patchelf
export LDAI_RUNTIME_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/runtime-x86_64"
bun scripts/package-prepare.ts
# Tauri leaves these generated staging directories behind after a failed bundle.
if [ "$COUCH_PACKAGE_FORMAT" = appimage ]; then
  rm -rf src-tauri/target/release/bundle/appimage_deb src-tauri/target/release/bundle/appimage
else
  rm -rf src-tauri/target/release/bundle/deb
fi
bun scripts/desktop.ts build --bundles "$COUCH_PACKAGE_FORMAT" --config .artifacts/tauri-release.conf.json -- --locked
if [ "$COUCH_PACKAGE_FORMAT" = deb ]; then
  bun scripts/package-deb-verify.ts
else
  bun scripts/package-verify-helpers.ts
  bun scripts/package-inventory.ts
fi
