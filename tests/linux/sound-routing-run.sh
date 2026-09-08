#!/bin/bash
set -euo pipefail
# Disposable container only. The source and shared native caches are read-only.
tar -C /source --exclude=target --exclude=binaries -cf - package.json bun.lock bunfig.toml components.json tsconfig.json src src-tauri scripts packaging tests/linux | tar -xf -
bun install --frozen-lockfile
bun run desktop:build --debug --no-bundle
cargo test --locked --manifest-path src-tauri/Cargo.toml
mkdir -p /work/bin
cp "$CARGO_TARGET_DIR/debug/couch" "$CARGO_TARGET_DIR/debug/couch-server" /work/bin/
sha256sum /work/bin/* > /artifacts/sound-binaries.sha256
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=90' -ac 2 /work/sound.wav
export XDG_RUNTIME_DIR=/tmp/couch-sound-runtime COUCH_DATA_DIR=/tmp/couch-sound-data
mkdir -m 700 -p "$XDG_RUNTIME_DIR"
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' bash -c '
  set -euo pipefail
  pipewire > /artifacts/pipewire.log 2>&1 &
  wireplumber > /artifacts/wireplumber.log 2>&1 &
  pipewire-pulse > /artifacts/pipewire-pulse.log 2>&1 &
  openbox > /artifacts/openbox.log 2>&1 &
  for attempt in {1..50}; do pactl info > /artifacts/audio-server.txt 2>/dev/null && break; sleep .1; done
  exec bun tests/linux/sound-routing.ts
'
