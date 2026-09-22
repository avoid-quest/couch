#!/bin/bash
set -euo pipefail
apt-get update -qq
apt-get install -y --no-install-recommends xserver-xorg-core xserver-xorg-video-dummy x11-xserver-utils > /artifacts/xorg-install.log
tar -C /source --exclude=target --exclude=binaries -cf - package.json bun.lock bunfig.toml components.json tsconfig.json rust-toolchain.toml src src-tauri scripts packaging tests | tar -xf -
bun install --frozen-lockfile
bun run build
cargo build --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked display::tests
mkdir -p /work/bin
cp /cache/target/debug/couch /work/bin/
cp /cache/target/debug/couch-server /work/bin/couch-server
cat > /tmp/xorg.conf <<'CONF'
Section "Device"
 Identifier "Dummy"
 Driver "dummy"
 VideoRam 256000
EndSection
Section "Monitor"
 Identifier "Monitor"
 HorizSync 5.0-1000.0
 VertRefresh 5.0-200.0
 Modeline "1920x1080" 148.5 1920 2008 2052 2200 1080 1084 1089 1125
EndSection
Section "Screen"
 Identifier "Screen"
 Device "Dummy"
 Monitor "Monitor"
 DefaultDepth 24
 SubSection "Display"
  Depth 24
  Modes "1920x1080"
  Virtual 3840 1080
 EndSubSection
EndSection
CONF
Xorg :99 -config /tmp/xorg.conf -noreset -nolisten tcp > /artifacts/xorg.log 2>&1 &
export DISPLAY=:99 XDG_SESSION_TYPE=x11 COUCH_DATA_DIR=/work/display-data COUCH_ADMIN_RECOVERY_CODE=1234567890abcdef1234567890abcdef COUCH_TV_PRESENTATION=1
sleep 2
xrandr --query > /artifacts/outputs-before.txt
xrandr --addmode DUMMY1 1920x1080
xrandr --output DUMMY1 --mode 1920x1080 --right-of DUMMY0
xrandr --query > /artifacts/outputs-after.txt
dbus-run-session -- bash -c 'openbox >/artifacts/openbox.log 2>&1 & bun tests/linux/display.ts'
