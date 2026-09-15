#!/bin/bash
# Run only in a disposable Debian 13 amd64 container with /qualification mounted read-only.
set -euo pipefail
test -f /.dockerenv
test "${COUCH_DEB_FIXTURE:-}" = 1
test "$(dpkg --print-architecture)" = amd64
grep -qx 'VERSION_ID="13"' /etc/os-release
export DEBIAN_FRONTEND=noninteractive
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "$status" > /evidence/failed; fi' EXIT
dpkg-query -W -f='${Package}\t${Version}\n' > /evidence/base-packages.tsv
apt-get update
apt-get install -y --no-install-recommends /qualification/couch.deb
dpkg-query -W -f='${Package}\t${Version}\n' > /evidence/production-packages.tsv
dpkg-query -W -f='${Depends}\n' couch > /evidence/depends.txt
dpkg-query -L couch > /evidence/package-files.txt
for command in jq minisign fusermount fusermount3 bun node cargo rustc gcc g++ make; do
  if command -v "$command"; then echo "Unexpected install prerequisite: $command" >&2; exit 1; fi
done
for binary in /usr/bin/couch /usr/bin/couch-server /usr/lib/Couch/tools/*; do
  ldd "$binary" > "/evidence/$(basename "$binary")-linkage.txt"
done
if grep 'not found' /evidence/*-linkage.txt; then exit 1; fi
/usr/bin/couch --version > /evidence/native-build.json
/usr/bin/couch-server --version > /evidence/server-build.json
cmp /evidence/native-build.json /evidence/server-build.json
/usr/lib/Couch/tools/yt-dlp --version > /evidence/yt-dlp-version.txt
/usr/lib/Couch/tools/deno eval 'console.log(6 * 7)' > /evidence/deno-result.txt
grep -qx 42 /evidence/deno-result.txt
/usr/lib/Couch/tools/ffprobe -v error -show_format -show_streams /qualification/sample.mp4 > /evidence/ffprobe-media.txt
sha256sum /usr/lib/Couch/tools/* > /evidence/helper-hashes.txt
test -x /usr/bin/couch
grep -qx 'Exec=couch' /usr/share/applications/Couch.desktop
test ! -e /etc/couch
test ! -e /usr/lib/systemd/user/couch-tv.service
! getent passwd couch-tv
useradd -m -s /bin/bash qualifier
install -d -o qualifier -g qualifier -m 700 /home/qualifier/couch-data /home/qualifier/Videos
install -o qualifier -g qualifier /qualification/sample.mp4 /home/qualifier/Videos/sample.mp4
echo 'Data belongs to the user' > /home/qualifier/couch-data/keep.txt
chown qualifier:qualifier /home/qualifier/couch-data/keep.txt
sha256sum /home/qualifier/couch-data/keep.txt > /evidence/user-data.sha256
apt-get install -y --reinstall --no-install-recommends /qualification/couch.deb
sha256sum -c /evidence/user-data.sha256
dpkg --verify couch
# These tools are test instrumentation, installed after recording Couch's dependency closure.
apt-get install -y --no-install-recommends xvfb xauth openbox xdotool webkit2gtk-driver pulseaudio procps ffmpeg curl libgtk-3-bin
dpkg-query -W -f='${Package}\t${Version}\n' > /evidence/test-packages.tsv
chown qualifier:qualifier /evidence
exec runuser -u qualifier -- env HOME=/home/qualifier COUCH_DATA_DIR=/home/qualifier/couch-data \
  COUCH_HOST=127.0.0.1 COUCH_PORT=44100 DISPLAY=:99 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 \
  LIBGL_ALWAYS_SOFTWARE=1 COUCH_BASIC_RENDERING=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  dbus-run-session -- bash -euo pipefail -c '
    Xvfb :99 -screen 0 1280x720x24 +extension GLX > /evidence/xvfb.log 2>&1 &
    for attempt in $(seq 1 50); do [ ! -e /tmp/.X11-unix/X99 ] || break; sleep 0.1; done
    openbox > /evidence/openbox.log 2>&1 &
    pulseaudio --start --exit-idle-time=-1 --log-target=file:/evidence/pulse.log
    pactl load-module module-null-sink sink_name=qualification > /evidence/audio-sink.txt
    pactl set-default-sink qualification
    touch /evidence/ready
    exec /qualification/tauri-driver --port 44444 --native-port 44446 > /evidence/driver.log 2>&1
  '
