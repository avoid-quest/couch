#!/bin/sh
set -eu
export LC_ALL=C
printf '\n=== observation time UTC ===\n'
date -u '+%Y-%m-%dT%H:%M:%SZ'
printf '\n=== os ===\n'
cat /etc/os-release
cat /etc/debian_version
uname -srmo
printf '\n=== access ===\n'
id -u
id -Gn
if sudo -n true 2>/dev/null; then printf 'sudo_noninteractive=available\n'; else printf 'sudo_noninteractive=unavailable\n'; fi
printf '\n=== cpu ===\n'
lscpu | sed -n -E '/^(Architecture|CPU op-mode|Address sizes|Byte Order|CPU\(s\)|On-line CPU|Vendor ID|Model name|CPU family|Model:|Thread|Core|Socket|Stepping|CPU max MHz|CPU min MHz|Virtualization|Hypervisor vendor|Virtualization type|L[123].*cache|NUMA node\(s\))/p'
printf '\n=== pci graphics audio network ===\n'
if command -v lspci >/dev/null 2>&1; then lspci -nnk | sed -n '/VGA compatible controller/,+3p;/3D controller/,+3p;/Display controller/,+3p;/Audio device/,+3p;/Ethernet controller/,+3p;/Network controller/,+3p'; fi
printf '\n=== memory ===\n'
free -h
printf '\n=== disk ===\n'
lsblk -e7 -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,ROTA
findmnt -rn -o TARGET,FSTYPE,OPTIONS /
df -hT / /home /tmp
printf '\n=== boot and session ===\n'
systemctl get-default
systemctl is-system-running || true
if test -d /sys/firmware/efi; then printf 'boot_mode=UEFI\n'; else printf 'boot_mode=legacy\n'; fi
printf '\n=== services enabled ===\n'
systemctl list-unit-files --state=enabled --type=service --no-legend --no-pager
printf '\n=== services running ===\n'
systemctl list-units --state=running --type=service --no-legend --no-pager
printf '\n=== services failed ===\n'
systemctl list-units --state=failed --no-legend --no-pager
printf '\n=== interfaces without addresses ===\n'
for path in /sys/class/net/*; do
  iface=${path##*/}
  printf '%s state=' "$iface"
  cat "$path/operstate"
done
printf '\n=== default-route interface only ===\n'
ip -o route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev") print "default_route_interface=" $(i+1)}'
printf '\n=== graphical and package prerequisites ===\n'
for executable in X Xorg startx xinit xfce4-session lightdm xrandr glxinfo minisign jq curl wget ffprobe ffmpeg; do
  if command -v "$executable" >/dev/null 2>&1; then printf '%s=' "$executable"; command -v "$executable"; else printf '%s=absent\n' "$executable"; fi
done
printf '\n=== Couch installation paths ===\n'
for path in /opt/couch /usr/local/bin/couch /usr/local/bin/couch-update /usr/local/bin/couch-recover /usr/local/bin/install-couch /etc/couch /var/lib/couch /home/couch/.local/share/quest.avoid.couch /home/couch/.config/quest.avoid.couch /home/couch/.local/bin/couch /home/couch/.local/bin/couch-recover /home/couch/.local/lib/couch /home/couch/.local/share/applications/couch.desktop /var/lib/couch-installer /var/lib/couch-install-locks /usr/lib/couch-appliance /usr/share/xsessions/couch.desktop /usr/share/lightdm/lightdm.conf.d/50-couch.conf /etc/X11/default-display-manager; do
  if test -e "$path" || test -L "$path"; then stat -c '%F %a %U:%G %n' "$path"; else printf 'absent %s\n' "$path"; fi
done
printf '\n=== Couch unit files and processes ===\n'
systemctl list-unit-files --no-legend --no-pager '*couch*' || true
ps -eo comm= | awk 'tolower($0) ~ /couch/ {print}'
printf '\n=== FUSE ===\n'
if test -e /dev/fuse; then stat -c '%F %a %U:%G %n' /dev/fuse; else printf '/dev/fuse=absent\n'; fi
printf '\n=== apt package count ===\n'
dpkg-query -W -f='${db:Status-Status}\n' | awk '$0=="installed"{n++} END{print n}'

printf '\n=== existing X11 sessions ===\n'
for path in /usr/share/xsessions/*.desktop; do if test -f "$path"; then printf '%s\n' "$path"; fi; done
printf '\n=== Couch runtime account ===\n'
if getent passwd couch-tv >/dev/null; then printf 'couch-tv=exists\n'; else printf 'couch-tv=absent\n'; fi
