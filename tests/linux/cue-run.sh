#!/usr/bin/env bash
set -euo pipefail

# Run under the container's external timeout with exclusive ownership of its caches.
exec > >(tee /artifacts/cue-run.log) 2>&1
tar -C /source --exclude=target --exclude=binaries -cf - \
  package.json bun.lock bunfig.toml components.json tsconfig.json src src-tauri scripts packaging tests/linux tests/fixtures/cue tests/setup-media.test.ts tests/replaygain-audio.test.ts | tar -xf -
bun install --frozen-lockfile
{ bun --version; rustc --version; pkg-config --modversion webkit2gtk-4.1 mpv; } > /artifacts/versions.txt
bun run desktop:build --debug --no-bundle
mkdir -p /work/bin /artifacts/bin
cp /cache/target/debug/couch /cache/target/debug/couch-server /work/bin/
cp /work/bin/* /artifacts/bin/
sha256sum /work/bin/* > /artifacts/binaries.sha256
find src src-tauri scripts packaging tests -type f -not -path '*/binaries/*' -print0 | sort -z | xargs -0 sha256sum > /artifacts/sources.sha256
cargo test --locked --manifest-path src-tauri/Cargo.toml cue_ -- --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video cue_bounds -- --nocapture
mkdir -p /mnt/cue-fixtures /root/.config
cp tests/fixtures/cue/album.cue tests/fixtures/cue/album.flac tests/fixtures/cue/missing.cue /mnt/cue-fixtures/
pulseaudio --start --exit-idle-time=-1 --log-target=file:/artifacts/pulseaudio.log
pactl load-module module-null-sink sink_name=couch > /artifacts/pulseaudio-module.txt
pactl set-default-sink couch
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' \
  bash -c 'openbox > /artifacts/openbox.log 2>&1 & exec bun tests/linux/cue-run.ts'
