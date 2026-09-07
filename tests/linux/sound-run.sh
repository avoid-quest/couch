#!/bin/bash
set -euo pipefail
cp /source/package.json /source/bun.lock /work/
bun install --frozen-lockfile >/dev/null
cp -a /source/src /work/
cp -a /source/tests /work/
pulseaudio --start --exit-idle-time=-1 --log-target=file:/artifacts/pulse.log
pactl load-module module-null-sink sink_name=couch_test_hdmi sink_properties=device.description=Test_HDMI
pactl load-module module-null-sink sink_name=couch_test_analog sink_properties=device.description=Test_Analog
pactl set-default-sink couch_test_analog
pactl set-sink-volume couch_test_hdmi 63%
pactl --format=json list sinks > /artifacts/sinks.json
bun tests/linux/sound.ts
