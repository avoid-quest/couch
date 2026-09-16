#!/bin/bash
set -euo pipefail
export COUCH_PACKAGE_FORMAT="${1:-deb}"
case "$COUCH_PACKAGE_FORMAT" in deb) ;; *) echo 'Use package:build deb' >&2; exit 1 ;; esac
export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD)
export PATCHELF=/usr/bin/patchelf
export LDAI_RUNTIME_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/runtime-x86_64"
bun scripts/package-prepare.ts
# Tauri leaves this generated staging directory behind after a failed bundle.
rm -rf src-tauri/target/release/bundle/deb
bun scripts/desktop.ts build --bundles "$COUCH_PACKAGE_FORMAT" --config .artifacts/tauri-release.conf.json -- --locked
bun scripts/package-deb-verify.ts
