#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_binary=$(mktemp "${TMPDIR:-/tmp}/couch-artwork-test.XXXXXX")
trap 'rm -f "$test_binary"' EXIT
xcrun clang -fobjc-arc -framework AppKit -framework MediaPlayer \
  src-tauri/src/now_playing.m src-tauri/tests/now_playing_macos.m -o "$test_binary"
"$test_binary" "$@"
