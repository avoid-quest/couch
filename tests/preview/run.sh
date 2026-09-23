#!/usr/bin/env bash
set -euo pipefail

# Keep Linux output away from the Mac checkout and reuse the acceptance-test cache.
tar -C /source --exclude=target --exclude=binaries -cf - \
  package.json bun.lock bunfig.toml components.json tsconfig.json vite.config.ts src src-tauri scripts packaging vendor tests/linux/fixtures.ts tests/linux/video-library-fixture.ts | tar -xf -
bun install --frozen-lockfile
bun run desktop:build --debug --no-bundle
mkdir -p /work/bin
cp /cache/target/debug/couch /cache/target/debug/couch-server /work/bin/
bun tests/linux/fixtures.ts
if [[ "${COUCH_PREVIEW_MEDIA:-}" == 1 ]]; then bun scripts/preview-media.ts; fi

mkdir -p /root/.config
export COUCH_TV_PRESENTATION=1
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=couch >/dev/null
pactl set-default-sink couch
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' \
  bash -euc '
    openbox >/tmp/openbox.log 2>&1 &
    x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet >/tmp/x11vnc.log 2>&1 &
    websockify --web=/usr/share/novnc --auth-plugin ExpectOrigin --auth-source "http://127.0.0.1:6080 http://localhost:6080" 0.0.0.0:6080 127.0.0.1:5900 >/tmp/novnc.log 2>&1 &
    exec /work/bin/couch
  '
