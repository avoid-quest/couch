#!/usr/bin/env bash
set -euo pipefail

# The launcher supplies a full immutable checkout, not a partial source tar.
# Linux outputs and application data never reach host targets.
[[ $(git rev-parse HEAD) = "$COUCH_SOURCE_REVISION" ]]
bun install --frozen-lockfile
{ bun --version; rustc --version; cargo install --list; pkg-config --modversion webkit2gtk-4.1 mpv; yt-dlp --version; deno --version; } > /artifacts/versions.txt
COUCH_IPTV_CLOCK_EVIDENCE=/artifacts/iptv-clock-preflight.json bun run check
if [[ ${COUCH_TEST_BUILT_REMOTE:-} = 1 ]]; then
  bun run build
else
  bun run desktop:build --debug --no-bundle
  mkdir -p /work/bin
  cp /cache/target/debug/couch /cache/target/debug/couch-server /work/bin/
  mkdir -p /artifacts/bin
  cp /work/bin/* /artifacts/bin/
  sha256sum /work/bin/* > /artifacts/binaries.sha256
  sha256sum package.json bun.lock bunfig.toml components.json tsconfig.json vite.config.ts > /artifacts/sources.sha256
  find src src-tauri scripts packaging tests -type f -not -path '*/binaries/*' -print0 | sort -z | xargs -0 sha256sum >> /artifacts/sources.sha256
  cargo test --locked --manifest-path src-tauri/Cargo.toml --lib --tests
  bun tests/linux/fixtures.ts
  mkdir -p /mnt/cue-fixtures
  cp tests/fixtures/cue/album.cue tests/fixtures/cue/album.flac tests/fixtures/cue/missing.cue /mnt/cue-fixtures/
  bun tests/linux/replaygain-fixtures.ts /replaygain-fixtures
fi
mkdir -p /root/.config /artifacts
export COUCH_DATA_DIR=$(mktemp -d /tmp/couch-native-data.XXXXXX)
export COUCH_TV_PRESENTATION=1
if [[ ${COUCH_TEST_DESKTOP_SMOKE:-} = 1 ]]; then export COUCH_TV_PRESENTATION=0; fi
pulseaudio --start --exit-idle-time=-1 --log-target=file:/artifacts/pulseaudio.log
pactl load-module module-null-sink sink_name=couch > /artifacts/pulseaudio-module.txt
pactl load-module module-null-sink sink_name=couch-replaygain format=float32le rate=48000 channels=2 > /artifacts/replaygain-pulseaudio-module.txt
pactl set-default-sink couch
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' \
  bash -ec 'openbox > /artifacts/openbox.log 2>&1 & COUCH_ARTIFACTS=/artifacts/built-remote bun tests/linux/built-remote.ts; if [[ ${COUCH_TEST_BUILT_REMOTE:-} = 1 ]]; then exit 0; elif [[ ${COUCH_TEST_DIAGNOSTICS:-} = 1 ]]; then exec bun tests/linux/diagnostics.ts; elif [[ ${COUCH_TEST_CONNECTION:-} = 1 ]]; then COUCH_ADMIN_RECOVERY_CODE=0123456789abcdef0123456789abcdef bun tests/linux/connection-journey.ts; elif [[ -n "${COUCH_TEST_PROVIDERS:-}${COUCH_TEST_PROVIDER_CATALOGS:-}" ]]; then exec bun tests/linux/providers.ts; elif [[ ${COUCH_TEST_IPTV_PUBLIC_SAMPLE:-} = 1 ]]; then exec bun tests/linux/iptv-public.ts; else exec bun tests/linux/smoke.ts; fi'
