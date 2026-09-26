#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/couch-cursor-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
test_binary="$test_dir/cursor-test"
# Deprecated CoreGraphics readback is confined to the test; production uses AppKit.
xcrun clang -fobjc-arc -Wno-deprecated-declarations -framework AppKit -framework WebKit -framework CoreGraphics \
  src-tauri/src/native_cursor.m src-tauri/tests/native_cursor_macos.m -o "$test_binary"
"$test_binary"
