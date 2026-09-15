#!/bin/bash
set -euo pipefail
out=/var/tmp/couch-acceptance-277-t480-external-helper
[[ $EUID = 0 && ! -e $out ]]
umask 077
mkdir "$out"
exec >"$out/collector.log" 2>&1
uid=$(id -u couch-tv)
main=$(runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user show couch-tv.service -p MainPID --value)
exe=$(readlink "/proc/$main/exe")
[[ $exe = /tmp/.mount_*/usr/bin/couch ]]
appdir=${exe%/usr/bin/couch}
bash /tmp/couch-277-mute-runtime.sh >"$out/mute-before.txt"
date -u +%FT%TZ >"$out/started-at.txt"
set +e
timeout --kill-after=5s 25s runuser -u couch-tv -- env LD_LIBRARY_PATH="$appdir/usr/lib" "$appdir/usr/lib/Couch/tools/ffprobe" -v error -rw_timeout 10000000 -analyzeduration 2000000 -probesize 256000 -show_entries stream=codec_name,codec_type,sample_rate,channels -of json https://radio.syg.ma/audio.mp3 >"$out/ffprobe-stream.json" 2>"$out/ffprobe.stderr"
code=$?
set -e
printf 'exit=%s\nfinished_at=%s\n' "$code" "$(date -u +%FT%TZ)" >"$out/result.txt"
bash /tmp/couch-277-mute-runtime.sh >"$out/mute-after.txt"
