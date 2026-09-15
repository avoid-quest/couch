#!/bin/bash
set -eu
umask 077
out=/home/probe/couch-277-corrected-0.1.0-baseline
mkdir "$out"
date -u --iso-8601=seconds > "$out/time.txt"
cat /etc/os-release > "$out/os-release.txt"
uname -srvm > "$out/kernel.txt"
dpkg --print-architecture > "$out/architecture.txt"
dpkg --audit > "$out/package-audit.txt"
dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\t${Installed-Size}\t${db:Status-Status}\n' | sort > "$out/packages.tsv"
apt-mark showmanual | sort > "$out/manual-packages.txt"
find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -exec cat {} + > "$out/apt-sources.txt"
find /var/lib/apt/lists -name '*InRelease' -exec sha256sum {} + > "$out/apt-release-hashes.txt"
systemctl list-unit-files --no-pager --no-legend > "$out/unit-files.txt"
systemctl --failed --no-pager > "$out/failed-units.txt"
systemctl get-default > "$out/default-target.txt"
find /etc/lightdm /etc/systemd /etc/X11 /etc/polkit-1 /usr/share/lightdm /usr/lib/systemd/logind.conf.d -type f -exec sha256sum {} + 2>/dev/null | sort > "$out/session-policy.tsv" || true
find /etc/pam.d /etc/ssh/sshd_config.d /etc/sudoers.d -type f -exec sha256sum {} + > "$out/auth-policy.sha256"
sha256sum /etc/ssh/sshd_config /etc/sudoers >> "$out/auth-policy.sha256"
{ id probe; getent group sudo; /usr/sbin/sshd -T | awk '$1 ~ /^(permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|usepam|authenticationmethods)$/'; } > "$out/auth-policy.txt"
df -B1 > "$out/filesystems.txt"
free -b > "$out/memory.txt"
ps -eo pid,ppid,user,comm,rss,pcpu > "$out/processes.txt"
lscpu > "$out/cpu.txt"
lspci -nnk > "$out/pci.txt" 2>&1 || true
{ for file in /dev/fuse /dev/dri/* /dev/snd/*; do [ ! -e "$file" ] || stat -c '%F %a %U:%G %n' "$file"; done; } > "$out/devices.txt"
for tool in bun node npm cargo rustc gcc make caddy ffprobe ffmpeg deno yt-dlp; do command -v "$tool" || true; done > "$out/command-paths.txt"
journalctl -b -p warning --no-pager > "$out/boot-warnings.txt"
loginctl list-sessions --no-pager > "$out/sessions.txt"
{ cat /sys/module/apparmor/parameters/enabled; aa-status 2>&1 || true; cat /sys/kernel/security/lockdown 2>&1 || true; } > "$out/security.txt"
{ for path in /etc/couch /var/lib/couch /var/lib/couch-installer /var/lib/couch-install-locks /etc/X11/default-display-manager /usr/share/xsessions/couch.desktop /home/probe/.local/lib/couch; do if [ -e "$path" ]; then echo "EXISTS $path"; else echo "absent $path"; fi; done; if getent passwd couch-tv >/dev/null; then echo 'couch-tv=exists'; else echo 'couch-tv=absent'; fi; } > "$out/couch-absence.txt"
chown -R probe:probe "$out"
