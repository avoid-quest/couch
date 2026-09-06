#!/usr/bin/env bash
set -euo pipefail

# The source mount is read-only. Linux outputs and application data never reach host targets.
tar -C /source --exclude=target --exclude=binaries -cf - \
  package.json bun.lock bunfig.toml components.json tsconfig.json src src-tauri scripts packaging tests/linux tests/setup-media.test.ts tests/replaygain-audio.test.ts | tar -xf -
bun install --frozen-lockfile
{ bun --version; rustc --version; cargo install --list; pkg-config --modversion webkit2gtk-4.1 mpv; yt-dlp --version; deno --version; } > /artifacts/versions.txt
bun run check
bun run desktop:build --debug --no-bundle
mkdir -p /work/bin
cp /cache/target/debug/couch /cache/target/debug/couch-server /work/bin/
mkdir -p /artifacts/bin
cp /work/bin/* /artifacts/bin/
sha256sum /work/bin/* > /artifacts/binaries.sha256
sha256sum package.json bun.lock bunfig.toml components.json tsconfig.json > /artifacts/sources.sha256
find src src-tauri scripts packaging tests -type f -not -path '*/binaries/*' -print0 | sort -z | xargs -0 sha256sum >> /artifacts/sources.sha256
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video dash_selection
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video resume_start
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video external_subtitles
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video radio_metadata
cargo test --locked --manifest-path src-tauri/Cargo.toml -p tauri-plugin-video replaygain_native_policy -- --nocapture
bun tests/linux/fixtures.ts
bun tests/linux/replaygain-fixtures.ts /replaygain-fixtures
mkdir -p /root/.config /artifacts
pulseaudio --start --exit-idle-time=-1 --log-target=file:/artifacts/pulseaudio.log
pactl load-module module-null-sink sink_name=couch > /artifacts/pulseaudio-module.txt
pactl set-default-sink couch
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' \
  bash -c 'openbox > /artifacts/openbox.log 2>&1 & if [ -n "${COUCH_TEST_PROVIDERS:-}${COUCH_TEST_PROVIDER_CATALOGS:-}" ]; then exec bun tests/linux/providers.ts; else exec bun tests/linux/playback.ts; fi'
