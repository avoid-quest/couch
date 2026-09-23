#!/bin/bash
set -euo pipefail
export COUCH_PACKAGE_FORMAT="${1:-deb}"
case "$COUCH_PACKAGE_FORMAT" in deb|appimage) ;; *) echo 'Use package:build deb or appimage' >&2; exit 1 ;; esac
export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD)
export PATCHELF=/usr/bin/patchelf
export LDAI_RUNTIME_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/runtime-x86_64"
bun scripts/package-prepare.ts
# Tauri leaves this generated staging directory behind after a failed bundle.
rm -rf "src-tauri/target/release/bundle/$COUCH_PACKAGE_FORMAT"
bun scripts/desktop.ts build --bundles "$COUCH_PACKAGE_FORMAT" --config .artifacts/tauri-release.conf.json -- --locked
if [ "$COUCH_PACKAGE_FORMAT" = deb ]; then bun scripts/package-deb-verify.ts; else bun scripts/package-appimage-verify.ts; fi
