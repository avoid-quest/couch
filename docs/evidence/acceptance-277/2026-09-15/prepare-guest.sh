#!/bin/bash
# Preparatory run with a disposable signing key, not hosted acceptance.
# Run once as root on a new clone, after placing verified candidate inputs.
set -euo pipefail
profile=$1
cd /home/probe/couch-277
out=$PWD/receipts
mkdir "$out"
collect() {
    local dir=$out/$1
    mkdir "$dir"
    date -u --iso-8601=seconds > "$dir/time.txt"
    cat /etc/os-release > "$dir/os-release.txt"
    uname -srvm > "$dir/kernel.txt"
    dpkg --print-architecture > "$dir/architecture.txt"
    dpkg --audit > "$dir/package-audit.txt"
    dpkg-query -W -f='${binary:Package}\t${Version}\t${Installed-Size}\t${db:Status-Status}\n' | sort > "$dir/packages.tsv"
    apt-mark showmanual | sort > "$dir/manual-packages.txt"
    find /etc/apt -type f \( -name '*.sources' -o -name '*.list' \) -exec cat {} + > "$dir/apt-sources.txt"
    find /var/lib/apt/lists -name '*InRelease' -exec sha256sum {} + > "$dir/apt-release-hashes.txt"
    systemctl list-unit-files --no-pager --no-legend > "$dir/unit-files.txt"
    systemctl --failed --no-pager > "$dir/failed-units.txt"
    find /etc/lightdm /etc/systemd /etc/X11 /etc/polkit-1 /usr/share/lightdm /usr/lib/systemd/logind.conf.d -type f -exec sha256sum {} + 2>/dev/null | sort > "$dir/session-policy.tsv" || true
    df -B1 > "$dir/filesystems.txt"
    du -xs -B1 / > "$dir/root-disk.txt" 2> "$dir/root-disk.stderr" || true
    free -b > "$dir/memory.txt"
    ps -eo pid,ppid,user,comm,rss,pcpu > "$dir/processes.txt"
    lscpu > "$dir/cpu.txt"
    lspci -nnk > "$dir/pci.txt" 2>&1 || true
    for tool in bun node npm cargo rustc gcc make caddy ffprobe ffmpeg deno yt-dlp; do command -v "$tool" || true; done > "$dir/command-paths.txt"
}
collect before
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(dpkg --print-architecture) = amd64 ]] || exit 1
# The documented bootstrap and installer run without dependency repairs.
set +e
(apt-get update && apt-get install --yes minisign jq) > "$out/bootstrap.txt" 2>&1
bootstrap=$?
set -e
printf '%s\n' "$bootstrap" > "$out/bootstrap.exit"
if [[ $bootstrap != 0 ]]; then collect after; exit "$bootstrap"; fi
base64 --decode couch-updater.pub > couch-updater.minisign.pub
for file in public/*; do
    [[ $file != *.sig ]] || continue
    base64 --decode "$file.sig" > signature.minisig
    minisign -Vm "$file" -p couch-updater.minisign.pub -x signature.minisig >> "$out/signatures.txt" 2>&1
done
sha256sum public/* > "$out/assets.sha256"
mkdir couch-setup
tar -xzf public/couch-setup-0.1.0-preview.1.tar.gz -C couch-setup
case $profile in
    minimal) args=(--tv);;
    xfce) args=(--desktop-user probe);;
    *) exit 2;;
esac
set +e
./couch-setup/install-couch "${args[@]}" --appimage ./public/Couch_0.1.0-preview.1_amd64.AppImage --signature ./public/Couch_0.1.0-preview.1_amd64.AppImage.sig --public-key ./couch-updater.pub > "$out/installer.txt" 2>&1
result=$?
set -e
printf '%s\n' "$result" > "$out/installer.exit"
collect after
if [[ $profile = minimal ]]; then app=/var/lib/couch/application; else app=/home/probe/.local/lib/couch; fi
if [[ -d $app ]]; then
    find "$app" -maxdepth 1 -type f -exec sha256sum {} + > "$out/installed.sha256"
    stat -c '%U:%G %a %n' "$app" "$app"/* > "$out/installed-permissions.txt"
    du -s -B1 "$app" > "$out/application-disk.txt"
    cp "$app/build.json" "$out/installed-build.json" 2>/dev/null || true
fi
chmod -R a+rX "$out"
exit "$result"
