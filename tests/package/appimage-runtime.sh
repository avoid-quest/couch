#!/bin/bash
# Fresh disposable Debian 12 runtime. The AppImage uses extraction because Docker has no FUSE device.
set -euo pipefail
test -f /.dockerenv
test "${COUCH_APPIMAGE_FIXTURE:-}" = 1
test "$(dpkg --print-architecture)" = amd64
grep -qx 'VERSION_ID="12"' /etc/os-release
trap 'status=$?; if [ "$status" -ne 0 ]; then echo "$status" > /evidence/failed; fi' EXIT
for command in bun node cargo rustc gcc g++ make jq minisign; do
  if command -v "$command"; then echo "Unexpected development tool: $command" >&2; exit 1; fi
done
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl dbus-user-session fonts-dejavu-core \
  libgl1 libegl1 libgles2 libgl1-mesa-dri libnss3 libasound2 libfuse2 procps passwd squashfs-tools
useradd -m -s /bin/bash qualifier
install -d -o qualifier -g qualifier -m 700 /home/qualifier/client-data /home/qualifier/host-data /home/qualifier/tmp
chown qualifier:qualifier /evidence
mkdir -p /tmp/appimage
chown qualifier:qualifier /tmp/appimage
runuser -u qualifier -- unsquashfs -no-progress -o "$(cat /qualification/runtime-offset)" -d /tmp/appimage/squashfs-root /qualification/Couch.AppImage > /dev/null
launcher=/qualification/Couch.AppImage
if [ "${COUCH_APPIMAGE_EXTRACTED:-0}" = 1 ]; then launcher=/tmp/appimage/squashfs-root/AppRun; fi
runuser -u qualifier -- env HOME=/home/qualifier TMPDIR=/home/qualifier/tmp \
  APPIMAGE_EXTRACT_AND_RUN=1 "$launcher" --version > /evidence/native-build.json
/tmp/appimage/squashfs-root/usr/bin/couch-server --version > /evidence/server-build.json
cmp /evidence/native-build.json /evidence/server-build.json
test ! -e /tmp/appimage/squashfs-root/usr/sbin/couch-setup
test ! -e /tmp/appimage/squashfs-root/usr/lib/couch/package-update
appdir=/tmp/appimage/squashfs-root
library_path="$appdir/usr/lib:$appdir/usr/lib/x86_64-linux-gnu"
for binary in couch couch-server; do
  env LD_LIBRARY_PATH="$library_path" ldd "$appdir/usr/bin/$binary" > "/evidence/$binary-linkage.txt"
  ! grep -q 'not found' "/evidence/$binary-linkage.txt"
done
for binary in yt-dlp deno ffmpeg ffprobe; do
  env LD_LIBRARY_PATH="$library_path" ldd "$appdir/usr/lib/Couch/tools/$binary" > "/evidence/$binary-linkage.txt"
  ! grep -q 'not found' "/evidence/$binary-linkage.txt"
done
env LD_LIBRARY_PATH="$library_path" ldd "$appdir/usr/lib/libmpv.so.2" > /evidence/libmpv-linkage.txt
! grep -q 'not found' /evidence/libmpv-linkage.txt
grep -F "$appdir/usr/lib/libmpv.so.2" /evidence/couch-linkage.txt
grep -F "$appdir/usr/lib/libavformat.so." /evidence/ffprobe-linkage.txt
grep -F "$appdir/usr/lib/libavformat.so." /evidence/ffmpeg-linkage.txt
runuser -u qualifier -- env HOME=/home/qualifier LD_LIBRARY_PATH="$library_path" "$appdir/usr/lib/Couch/tools/yt-dlp" --ignore-config --no-plugin-dirs --version > /evidence/yt-dlp-version.txt
runuser -u qualifier -- env HOME=/home/qualifier LD_LIBRARY_PATH="$library_path" "$appdir/usr/lib/Couch/tools/deno" eval 'console.log(6 * 7)' > /evidence/deno-result.txt
grep -qx 42 /evidence/deno-result.txt
runuser -u qualifier -- env HOME=/home/qualifier LD_LIBRARY_PATH="$library_path" "$appdir/usr/lib/Couch/tools/ffprobe" -v error -show_format -show_streams /qualification/sample.mp4 > /evidence/ffprobe-media.txt
grep -q codec_name=h264 /evidence/ffprobe-media.txt
runuser -u qualifier -- env HOME=/home/qualifier LD_LIBRARY_PATH="$library_path" "$appdir/usr/lib/Couch/tools/ffmpeg" -v error -i /qualification/sample.mp4 -f null -
for command in bun node cargo rustc gcc g++ make; do
  if command -v "$command"; then echo "Unexpected development tool: $command" >&2; exit 1; fi
done

# The second packaged coordinator stands in for a separate playback computer.
runuser -u qualifier -- env HOME=/home/qualifier COUCH_DATA_DIR=/home/qualifier/host-data \
  COUCH_HOST=127.0.0.1 COUCH_PORT=44101 /tmp/appimage/squashfs-root/usr/bin/couch-server \
  > /evidence/host.log 2>&1 &
for attempt in $(seq 1 100); do
  if curl --silent --fail http://127.0.0.1:44101/api/connection > /evidence/host-connection.json; then break; fi
  sleep 0.1
done
test -s /evidence/host-connection.json

# Prove the AppImage renders its first view before WebDriver can supply WebKit.
apt-get install -y --no-install-recommends xvfb xauth openbox xdotool scrot tesseract-ocr tesseract-ocr-eng
if dpkg-query -W libwebkit2gtk-4.1-0 >/dev/null 2>&1; then echo 'WebKit came from the host' >&2; exit 1; fi
runuser -u qualifier -- env HOME=/home/qualifier TMPDIR=/home/qualifier/tmp \
  APPIMAGE_EXTRACT_AND_RUN=1 COUCH_APPIMAGE_LAUNCHER="$launcher" XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
  COUCH_BASIC_RENDERING=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  dbus-run-session -- bash -euo pipefail -c '
    export DISPLAY=:98
    Xvfb :98 -screen 0 1280x720x24 +extension GLX > /evidence/pre-driver-xvfb.log 2>&1 & xvfb_pid=$!
    trap '\''kill "${app_pid:-}" "${openbox_pid:-}" "$xvfb_pid" 2>/dev/null || true; pkill -TERM -u qualifier -x couch || true'\'' EXIT
    for attempt in $(seq 1 50); do [ ! -e /tmp/.X11-unix/X98 ] || break; sleep 0.1; done
    openbox > /evidence/pre-driver-openbox.log 2>&1 & openbox_pid=$!
    "$COUCH_APPIMAGE_LAUNCHER" > /evidence/pre-driver-app.log 2>&1 & app_pid=$!
    for attempt in $(seq 1 150); do
      if xdotool search --onlyvisible --name "^Couch$" > /evidence/pre-driver-window.txt; then
        xdotool windowmove --sync "$(head -1 /evidence/pre-driver-window.txt)" 0 0
        scrot -o /evidence/pre-driver.png
        tesseract /evidence/pre-driver.png stdout > /evidence/pre-driver-ocr.txt 2>/dev/null
        if grep -Eiq "Where.*play" /evidence/pre-driver-ocr.txt; then break; fi
      fi
      kill -0 "$app_pid"
      sleep 0.2
    done
    test -s /evidence/pre-driver-window.txt
    grep -Eiq "Where.*play" /evidence/pre-driver-ocr.txt
  '
for attempt in $(seq 1 50); do [ "$(pgrep -x couch-server | wc -l)" = 1 ] && break; sleep 0.1; done
test "$(pgrep -x couch-server | wc -l)" = 1

# WebDriver is only needed for the detailed Client journey below.
apt-get install -y --no-install-recommends webkit2gtk-driver pulseaudio pulseaudio-utils libgtk-3-bin python3-pil
exec runuser -u qualifier -- env HOME=/home/qualifier TMPDIR=/home/qualifier/tmp \
  APPIMAGE_EXTRACT_AND_RUN=1 COUCH_DATA_DIR=/home/qualifier/client-data DISPLAY=:99 \
  XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 COUCH_BASIC_RENDERING=1 \
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 dbus-run-session -- bash -euo pipefail -c '
    Xvfb :99 -screen 0 1280x720x24 +extension GLX > /evidence/xvfb.log 2>&1 &
    for attempt in $(seq 1 50); do [ ! -e /tmp/.X11-unix/X99 ] || break; sleep 0.1; done
    openbox > /evidence/openbox.log 2>&1 &
    pulseaudio --start --exit-idle-time=-1 --log-target=file:/evidence/pulse.log
    pactl load-module module-null-sink sink_name=qualification > /evidence/audio-sink.txt
    pactl set-default-sink qualification
    touch /evidence/ready
    exec /qualification/tauri-driver --port 44444 --native-port 44446 > /evidence/driver.log 2>&1
  '
