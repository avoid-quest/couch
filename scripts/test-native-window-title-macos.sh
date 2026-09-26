#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test_binary=$(mktemp "${TMPDIR:-/tmp}/couch-window-title-test.XXXXXX")
trap 'rm -f "$test_binary"' EXIT
xcrun clang -fobjc-arc -framework AppKit \
  src-tauri/src/native_window_title.m src-tauri/tests/native_window_title_macos.m -o "$test_binary"
"$test_binary"
