#!/usr/bin/env bash
set -euo pipefail
Xvfb :99 -screen 0 1280x720x24 +extension GLX > /evidence/xvfb.log 2>&1 &
for attempt in $(seq 1 50); do [ ! -e /tmp/.X11-unix/X99 ] || break; sleep 0.1; done
openbox > /evidence/openbox.log 2>&1 &
pulseaudio --start --exit-idle-time=-1 --log-target=file:/evidence/pulseaudio.log
pactl load-module module-null-sink sink_name=qualification > /evidence/audio-sink.txt
pactl set-default-sink qualification
WebKitWebDriver --port=44445 > /evidence/browser-driver.log 2>&1 &
exec /qualification/tauri-driver --port 44444 --native-port 44446 > /evidence/native-driver.log 2>&1
