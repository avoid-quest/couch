#!/bin/bash
set -euo pipefail
export COUCH_PACKAGE_FORMAT="${1:-deb}"
case "$COUCH_PACKAGE_FORMAT" in deb|appimage) ;; *) echo 'Use package:build deb or appimage' >&2; exit 1 ;; esac
if [ "$COUCH_PACKAGE_FORMAT" = deb ]; then export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD); else unset SOURCE_DATE_EPOCH; fi
export PATCHELF=/usr/bin/patchelf
tool_cache="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
export LDAI_RUNTIME_FILE="$tool_cache/runtime-x86_64"
if [ "$COUCH_PACKAGE_FORMAT" = appimage ]; then bun scripts/package-appimage-tools.ts "$tool_cache"; fi
bun scripts/package-prepare.ts
# Tauri leaves these generated staging directories behind after a failed bundle.
rm -rf "src-tauri/target/release/bundle/$COUCH_PACKAGE_FORMAT"
if [ "$COUCH_PACKAGE_FORMAT" = appimage ]; then rm -rf src-tauri/target/release/bundle/appimage_deb; fi
flags=()
if [ "$COUCH_PACKAGE_FORMAT" = appimage ]; then flags=(-v); fi
bun scripts/desktop.ts build "${flags[@]}" --bundles "$COUCH_PACKAGE_FORMAT" --config .artifacts/tauri-release.conf.json -- --locked
if [ "$COUCH_PACKAGE_FORMAT" = appimage ]; then bun scripts/package-appimage-tools.ts "$tool_cache" --check; fi
if [ "$COUCH_PACKAGE_FORMAT" = deb ]; then bun scripts/package-deb-verify.ts; else bun scripts/package-appimage-verify.ts; fi
