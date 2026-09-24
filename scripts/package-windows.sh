#!/bin/bash
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then echo 'Build this Windows package with the supported macOS cross-build tools' >&2; exit 1; fi
export PATH="$HOME/.cargo/bin:${COUCH_LLVM_PREFIX:-$(brew --prefix llvm)}/bin:$PATH"
export COUCH_PACKAGE_FORMAT=nsis COUCH_DESKTOP_TARGET=x86_64-pc-windows-msvc COUCH_CLIENT_ONLY=0
export SOURCE_DATE_EPOCH=$(git show -s --format=%ct HEAD)
bun scripts/package-windows-prepare.ts
export RUSTFLAGS="${RUSTFLAGS:-} -L native=$PWD/src-tauri/resources/windows-native"
rm -rf src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis
bun scripts/desktop.ts build --config .artifacts/tauri-windows.conf.json --runner cargo-xwin --target x86_64-pc-windows-msvc -- --locked
bun scripts/package-windows-verify.ts
