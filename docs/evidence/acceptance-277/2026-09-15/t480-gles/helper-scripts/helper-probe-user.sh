#!/bin/bash
set -euo pipefail
out=/var/tmp/couch-acceptance-277-t480-helper-probe-user
[[ $EUID = 0 && ! -e $out ]]
umask 077
mkdir "$out"
exec >"$out/collector.log" 2>&1
uid=$(id -u couch-tv)
main=$(runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user show couch-tv.service -p MainPID --value)
exe=$(readlink "/proc/$main/exe")
[[ $exe = /tmp/.mount_*/usr/bin/couch ]]
appdir=${exe%/usr/bin/couch}
printf '%s\n' "$appdir" >"$out/mount.txt"
for helper in yt-dlp deno ffprobe; do
 runuser -u couch-tv -- test -x "$appdir/usr/lib/Couch/tools/$helper"
 runuser -u couch-tv -- sha256sum "$appdir/usr/lib/Couch/tools/$helper" >>"$out/helper-sha256.txt"
done
runuser -u couch-tv -- env LD_LIBRARY_PATH="$appdir/usr/lib" "$appdir/usr/lib/Couch/tools/yt-dlp" --version >"$out/yt-dlp-version.txt" 2>&1
runuser -u couch-tv -- env LD_LIBRARY_PATH="$appdir/usr/lib" "$appdir/usr/lib/Couch/tools/deno" --version >"$out/deno-version.txt" 2>&1
runuser -u couch-tv -- env LD_LIBRARY_PATH="$appdir/usr/lib" "$appdir/usr/lib/Couch/tools/ffprobe" -v error -show_format -show_streams -of json /tmp/couch-277-silent-fixture.wav >"$out/ffprobe.json" 2>"$out/ffprobe.stderr"
for pid in $(pgrep -u "$uid" -f 'couch|WebKit'); do
 [[ -r /proc/$pid/maps ]] || continue
 awk '$6 ~ /\/(libGL|libEGL|libGLES|libgbm|libdrm|iris_dri|libgallium)/ {print $6}' "/proc/$pid/maps" | sort -u >"$out/graphics-$pid.txt"
done
bash /tmp/couch-277-mute-runtime.sh >"$out/mute.txt"
date -u +%FT%TZ >"$out/finished-at.txt"
