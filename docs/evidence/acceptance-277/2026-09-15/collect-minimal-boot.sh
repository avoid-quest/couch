#!/bin/bash
# Read-only first-boot observations; writes only this new evidence directory.
set -u
out=/tmp/couch-277-first-boot
mkdir "$out" || exit 1
tv_uid=$(id -u couch-tv)
tv_systemctl=(runuser -u couch-tv -- env HOME=/var/lib/couch XDG_RUNTIME_DIR=/run/user/"$tv_uid" DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"$tv_uid"/bus systemctl --user)
capture() {
    local name=$1
    shift
    "$@" > "$out/$name.stdout" 2> "$out/$name.stderr"
    printf '%s\n' "$?" > "$out/$name.exit"
}
capture date date -u --iso-8601=seconds
capture uptime uptime
capture boot-id cat /proc/sys/kernel/random/boot_id
capture kernel uname -srvm
capture sessions loginctl list-sessions --no-pager
capture users loginctl list-users --no-pager
capture failed-system-units systemctl --failed --no-pager
capture lightdm-status systemctl status lightdm --no-pager -l
capture lightdm-properties systemctl show lightdm -p ActiveState -p SubState -p Result -p MainPID -p NRestarts
capture runtime-identity id couch-tv
capture couch-unit "${tv_systemctl[@]}" cat couch-tv.service
capture couch-status "${tv_systemctl[@]}" status couch-tv.service --no-pager -l
capture couch-properties "${tv_systemctl[@]}" show couch-tv.service -p ActiveState -p SubState -p Result -p MainPID -p NRestarts -p ExecMainCode -p ExecMainStatus -p ControlGroup -p MemoryCurrent -p CPUUsageNSec -p ActiveEnterTimestamp -p ExecMainStartTimestamp
capture user-units "${tv_systemctl[@]}" --failed --no-pager
capture audio-units "${tv_systemctl[@]}" status pipewire.service pipewire-pulse.service wireplumber.service --no-pager -l
capture lightdm-journal journalctl -b -u lightdm --no-pager -o short-iso
capture couch-journal journalctl -b _SYSTEMD_USER_UNIT=couch-tv.service --no-pager -o short-iso
capture runtime-journal journalctl -b _UID="$tv_uid" --no-pager -o short-iso
capture session-journal journalctl -b -t couch-session --no-pager -o short-iso
capture boot-warnings journalctl -b -p warning --no-pager -o short-iso
capture processes ps -eo pid,ppid,user,comm,rss,pcpu,etime
capture memory free -b
capture listening-sockets ss -lntp
capture app-processes bash -c 'for pid in $(pgrep -u "$1" -x "couch|couch-server|Couch.AppImage"); do printf "PID=%s\n" "$pid"; readlink /proc/"$pid"/exe; tr "\0" " " < /proc/"$pid"/cmdline; printf "\n"; cat /proc/"$pid"/cgroup; done' _ "$tv_uid"
if pgrep -u "$tv_uid" -x 'couch|couch-server' > "$out/initial-couch-pids.txt"; then
    printf 'Couch process present; unattended samples requested for at least 300 seconds. No GUI observation establishes idle state.\n' > "$out/sample-scope.txt"
    for sample in 0 1 2 3 4 5; do
        mkdir "$out/sample-$sample"
        date -u --iso-8601=seconds > "$out/sample-$sample/date.txt"
        cat /proc/uptime > "$out/sample-$sample/uptime.txt"
        ps -eo pid,ppid,user,comm,rss,pcpu,etime > "$out/sample-$sample/processes.txt"
        free -b > "$out/sample-$sample/memory.txt"
        "${tv_systemctl[@]}" show couch-tv.service -p ActiveState -p SubState -p Result -p MainPID -p NRestarts -p MemoryCurrent -p CPUUsageNSec > "$out/sample-$sample/unit.txt" 2>&1
        printf 'Collected minimal boot sample %s\n' "$sample"
        if [[ $sample != 5 ]]; then sleep 60; fi
    done
else
    printf 'Unrun: no couch or couch-server process for the runtime account at first collection.\n' > "$out/sample-scope.txt"
fi
capture final-couch-journal journalctl -b _SYSTEMD_USER_UNIT=couch-tv.service --no-pager -o short-iso
capture final-couch-properties "${tv_systemctl[@]}" show couch-tv.service -p ActiveState -p SubState -p Result -p MainPID -p NRestarts -p ExecMainCode -p ExecMainStatus
capture finished-date date -u --iso-8601=seconds
chmod -R a+rX "$out"
printf 'Minimal first-boot collection complete\n'
