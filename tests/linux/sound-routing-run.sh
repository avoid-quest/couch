#!/bin/bash
set -euo pipefail
# Disposable container only. The source and shared native caches are read-only.
git init -q
git fetch -q /artifacts/source.bundle HEAD
git checkout -q -f -B qualification FETCH_HEAD
mkdir -p .git/info
printf "/bin/\n/sound.wav\n" >> .git/info/exclude
test -z "$(git status --porcelain)"
bun install --frozen-lockfile
bun run desktop:build --debug --no-bundle
cp src-tauri/build-info.json /artifacts/build-info.json
bun -e 'const b = await Bun.file("src-tauri/build-info.json").json(); if (!/^[a-f0-9]{40}$/.test(b.revision) || b.dirty) throw new Error("Expected clean immutable fixture build");'
mkdir -p /work/bin
cp "$CARGO_TARGET_DIR/debug/couch" "$CARGO_TARGET_DIR/debug/couch-server" /work/bin/
sha256sum /work/bin/* > /artifacts/sound-binaries.sha256
ffmpeg -y -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=90' -ac 2 /work/sound.wav
mkdir -p /mnt/sound-fixtures
ffmpeg -y -hide_banner -loglevel error -i /work/sound.wav -t 3 /mnt/sound-fixtures/Sound-A.flac
ffmpeg -y -hide_banner -loglevel error -i /work/sound.wav /mnt/sound-fixtures/Sound-B.flac
export XDG_RUNTIME_DIR=$(mktemp -d /tmp/couch-sound-runtime.XXXXXX) COUCH_DATA_DIR=$(mktemp -d /tmp/couch-sound-data.XXXXXX)
mkdir -m 700 -p "$XDG_RUNTIME_DIR"
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' bash -c '
  set -euo pipefail
  pipewire > /artifacts/pipewire.log 2>&1 &
  wireplumber > /artifacts/wireplumber.log 2>&1 &
  pipewire-pulse > /artifacts/pipewire-pulse.log 2>&1 &
  openbox > /artifacts/openbox.log 2>&1 &
  for attempt in {1..50}; do pactl info > /artifacts/audio-server.txt 2>/dev/null && break; sleep .1; done
  exec timeout 180 bun tests/linux/sound-routing.ts
'
