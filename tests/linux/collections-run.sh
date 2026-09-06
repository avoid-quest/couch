#!/usr/bin/env bash
set -euo pipefail

tar -C /source --exclude=target --exclude=binaries -cf - package.json bun.lock bunfig.toml components.json tsconfig.json src src-tauri scripts packaging tests/linux | tar -xf -
bun install --frozen-lockfile
bun run desktop:build --debug --no-bundle
mkdir -p /work/bin /artifacts
cp /cache/target/debug/couch /cache/target/debug/couch-server /work/bin/
sha256sum /work/bin/* > /artifacts/binaries.sha256
find src src-tauri scripts tests/linux -type f -not -path "*/binaries/*" -print0 | sort -z | xargs -0 sha256sum > /artifacts/sources.sha256
{ bun --version; rustc --version; pkg-config --modversion webkit2gtk-4.1 mpv; } > /artifacts/versions.txt
pulseaudio --start --exit-idle-time=-1 --log-target=file:/artifacts/pulseaudio.log
pactl load-module module-null-sink sink_name=couch > /artifacts/pulseaudio-module.txt
pactl set-default-sink couch
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24 +extension GLX' bash -c 'openbox > /artifacts/openbox.log 2>&1 & exec bun tests/linux/collections.ts'
