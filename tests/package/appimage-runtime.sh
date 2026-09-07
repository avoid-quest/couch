#!/usr/bin/env bash
set -euo pipefail
trap 'qualification_status=$?; if [ "$qualification_status" -ne 0 ]; then echo "Runtime qualification failed with status $qualification_status; see container.log" > /evidence/runtime-failed; fi' EXIT
export DEBIAN_FRONTEND=noninteractive
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > /evidence/base-packages.tsv
apt-get update
# OS-owned tools and hardware drivers remain separate from the application bundle.
apt-get install -y --no-install-recommends libgl1 va-driver-all ffmpeg ca-certificates fonts-dejavu-core libxdo3
install -m 755 /qualification/couch.AppImage /opt/couch.AppImage
cd /opt
./couch.AppImage --appimage-extract > /evidence/appimage-files.txt
# Exercise the actual artifact through the official extract-and-run path in Docker.
export APPIMAGE_EXTRACT_AND_RUN=1
export APPDIR=/opt/squashfs-root
export LD_LIBRARY_PATH=/opt/squashfs-root/usr/lib
ldd /opt/squashfs-root/usr/bin/couch > /evidence/native-linkage.txt
ldd /opt/squashfs-root/usr/bin/couch-server > /evidence/server-linkage.txt
if grep 'not found' /evidence/*-linkage.txt; then exit 1; fi
unset APPDIR LD_LIBRARY_PATH
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > /evidence/production-packages.tsv
for command in bun node npm cargo rustc cc gcc g++ make; do
  if command -v "$command"; then echo "Unexpected development command: $command"; exit 1; fi
done
if dpkg-query -W -f='${binary:Package}\n' | grep -E -- '(^build-essential$|-dev(:amd64)?$)'; then exit 1; fi
test -r /usr/lib/x86_64-linux-gnu/dri/iHD_drv_video.so
dpkg-query -W va-driver-all intel-media-va-driver > /evidence/va-drivers.txt
ffprobe -version > /evidence/ffprobe-version.txt

useradd -m -s /bin/bash qualifier
install -d -o qualifier -g qualifier -m 700 /home/qualifier/Videos
install -o qualifier -g qualifier -m 600 /qualification/media/sample.mp4 /home/qualifier/Videos/sample.mp4
install -d -o qualifier -g qualifier -m 700 /home/qualifier/legacy-data
install -o qualifier -g qualifier -m 600 /qualification/couch.sqlite /home/qualifier/legacy-data/couch.sqlite
install -o qualifier -g qualifier -m 600 /qualification/keep.txt /home/qualifier/legacy-data/keep.txt
sha256sum /home/qualifier/legacy-data/* > /evidence/data-before-upgrade.sha256
/opt/couch.AppImage --version > /evidence/native-build.json
LD_LIBRARY_PATH=/opt/squashfs-root/usr/lib /opt/squashfs-root/usr/bin/couch-server --version > /evidence/server-build.json
cmp /evidence/native-build.json /evidence/server-build.json
sha256sum -c /evidence/data-before-upgrade.sha256

# Display and automation fixtures are installed only after recording production closure.
apt-get install -y --no-install-recommends xvfb xauth dbus-x11 openbox webkit2gtk-driver pulseaudio libgl1-mesa-dri procps
dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' > /evidence/qualification-packages.tsv
chown qualifier:qualifier /evidence
touch /evidence/runtime-ready
exec runuser -u qualifier -- env HOME=/home/qualifier COUCH_DATA_DIR=/home/qualifier/legacy-data \
  COUCH_HOST=127.0.0.1 COUCH_PORT=44100 DISPLAY=:99 GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
  COUCH_BASIC_RENDERING=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  dbus-run-session -- bash /qualification/display.sh
