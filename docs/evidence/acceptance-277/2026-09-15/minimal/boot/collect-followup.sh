#!/bin/bash
set -u
out=/tmp/couch-277-boot-followup
mkdir "$out" || exit 1
capture() { local name=$1; shift; "$@" > "$out/$name.stdout" 2> "$out/$name.stderr"; printf '%s\n' "$?" > "$out/$name.exit"; }
capture date date -u --iso-8601=seconds
capture session loginctl show-session 4 -a
capture runtime-user loginctl show-user couch-tv -a
capture user-manager systemctl status user@102.service user-runtime-dir@102.service --no-pager -l
capture user-manager-journal journalctl -b -u user@102.service -u user-runtime-dir@102.service -u systemd-logind --no-pager -o short-iso
capture runtime-dir ls -ld /run/user/102 /run/user/102/bus /var/lib/couch
capture processes ps -eo pid,ppid,user,comm,rss,pcpu,etime
capture xsession-errors cat /var/lib/couch/.xsession-errors
capture lightdm-session-log cat /var/log/lightdm/lightdm.log
capture couch-session-file cat /usr/share/xsessions/couch.desktop
capture runtime-journal journalctl -b _UID=102 --no-pager -o short-iso
capture pam-systemd-version dpkg-query -W systemd libpam-systemd
capture pam-config cat /etc/pam.d/lightdm-autologin /etc/pam.d/common-session
capture runtime-processes pgrep -a -u couch-tv
chmod -R a+rX "$out"
