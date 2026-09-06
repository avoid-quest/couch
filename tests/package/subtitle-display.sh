#!/usr/bin/env bash
set -euo pipefail
# Test fixture only. The application and its coordinator remain package owned.
Xvfb :99 -screen 0 1600x1000x24 +extension GLX > /evidence/xvfb.log 2>&1 &
for attempt in $(seq 1 50); do [ ! -e /tmp/.X11-unix/X99 ] || break; sleep 0.1; done
openbox > /evidence/openbox.log 2>&1 &
pulseaudio --start --exit-idle-time=-1 --log-target=file:/evidence/pulseaudio.log
pactl load-module module-null-sink sink_name=subtitles > /evidence/audio-sink.txt
pactl set-default-sink subtitles
socat TCP-LISTEN:45344,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:45444 &
socat TCP-LISTEN:45345,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:45445 &
GDK_DPI_SCALE=1.5 WebKitWebDriver --port=45445 > /evidence/browser-driver.log 2>&1 &
exec /evidence/tauri-driver --port=45444 --native-port=45446 > /evidence/native-driver.log 2>&1
