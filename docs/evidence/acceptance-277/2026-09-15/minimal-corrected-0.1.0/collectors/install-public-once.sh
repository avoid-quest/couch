#!/bin/bash
# Run once as root on the fresh minimal corrected-release clone only.
# Arguments: final trusted published manifest, NEW evidence directory. Parent supplies both.
# Downloads public bytes, runs unchanged --tv installer, then starts LightDM once. No reboot or playback.
set -euo pipefail
umask 077
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive
version=0.1.0
expected_manifest=${1:?Supply the trusted hosted-ready manifest.json}
evidence=${2:?Supply a new /var/tmp/couch-acceptance-277-* directory}
[[ $# = 2 && $EUID = 0 ]] || { echo 'Run as root with two arguments.' >&2; exit 2; }
[[ -f $expected_manifest && $expected_manifest = /* ]] || { echo 'Expected manifest must be an existing absolute file.' >&2; exit 2; }
[[ $evidence = /var/tmp/couch-acceptance-277-* && $evidence != *$'\n'* ]] || { echo 'Use the task evidence directory prefix.' >&2; exit 2; }
[[ ! -e $evidence && ! -L $evidence ]] || { echo 'Evidence directory exists. Preserve the first attempt; do not rerun.' >&2; exit 2; }
mkdir -m 0700 -- "$evidence"
exec >> "$evidence/collector.log" 2>&1
stage=initialization
utc() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
set_stage() { stage=$1; printf '%s\t%s\n' "$(utc)" "$stage" >> "$evidence/stages.tsv"; }
packages() { dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\t${Installed-Size}\t${db:Status-Status}\n' | sort; }
state() {
    printf 'observed_at=%s\n' "$(utc)"
    cat /etc/os-release
    uname -srmo
    free -h
    df -hT / /var/tmp
    systemctl get-default
    systemctl is-system-running || true
    systemctl list-unit-files --state=enabled --type=service --no-legend --no-pager
    systemctl list-units --state=running --type=service --no-legend --no-pager
    systemctl list-units --state=failed --no-legend --no-pager
    for path in /etc/couch /var/lib/couch /var/lib/couch-installer /var/lib/couch-install-locks /etc/X11/default-display-manager /usr/share/xsessions/couch.desktop; do
        if [[ -e $path || -L $path ]]; then stat -c '%F %a %U:%G %n' "$path"; else printf 'absent %s\n' "$path"; fi
    done
    if getent passwd couch-tv >/dev/null; then printf 'couch-tv=exists\n'; else printf 'couch-tv=absent\n'; fi
    for path in /sys/class/net/*; do printf '%s state=' "${path##*/}"; cat "$path/operstate"; done
    ip -o route show default | awk '{for(i=1;i<=NF;i++) if($i=="dev") print "default_route_interface=" $(i+1)}'
    ps -eo comm= | awk 'tolower($0) ~ /couch|lightdm|xorg|pipewire|wireplumber/ {print}'
}
finish() {
    result=$?
    trap - EXIT
    set +e
    printf 'finished_at=%s\nexit_status=%s\nlast_stage=%s\n' "$(utc)" "$result" "$stage" > "$evidence/result.txt"
    if [[ $stage = install-authenticated-tv-profile && $result != 0 ]]; then
        printf 'installer_finished_at=%s\ninstaller_exit_status=%s\n' "$(utc)" "$result" >> "$evidence/installer-status.txt"
    fi
    if [[ $result != 0 ]]; then
        printf 'First attempt failed at %s, exit %s. No repair or retry was attempted.\n' "$stage" "$result" > "$evidence/FIRST_FAILURE.txt"
    fi
    packages > "$evidence/packages-after.tsv"
    printf 'packages_after_exit=%s\n' "$?" >> "$evidence/result.txt"
    apt-mark showmanual > "$evidence/manual-packages-after.txt"
    if [[ -f $evidence/packages-before.tsv ]]; then diff -u "$evidence/packages-before.tsv" "$evidence/packages-after.tsv" > "$evidence/packages.delta"; fi
    state > "$evidence/state-after.txt" 2>&1
    journalctl -b -u lightdm --no-pager > "$evidence/lightdm-journal.txt" 2>&1
    if getent passwd couch-tv >/dev/null; then journalctl -b _UID="$(id -u couch-tv)" --no-pager > "$evidence/runtime-journal.txt" 2>&1; fi
    printf 'state_after_exit=%s\n' "$?" >> "$evidence/result.txt"
    printf 'gui_playback_update_acceptance=unrun\nmac_offline_condition=not_claimed\nreboot_acceptance=not_claimed\n' >> "$evidence/result.txt"
    sync -f "$evidence"
    exit "$result"
}
trap finish EXIT
printf 'collector_started_at=%s\nversion=%s\n' "$(utc)" "$version" > "$evidence/run.txt"
cp -- "$expected_manifest" "$evidence/expected-manifest.json"
sha256sum "$evidence/expected-manifest.json" > "$evidence/expected-manifest.sha256"
set_stage baseline
find /etc/pam.d /etc/ssh/sshd_config.d /etc/sudoers.d -type f | sort > "$evidence/auth-policy-files.txt"
sha256sum /etc/ssh/sshd_config /etc/sudoers > "$evidence/admin-auth-before.sha256"
cp "$evidence/admin-auth-before.sha256" "$evidence/auth-policy-before.sha256"
while read -r path; do sha256sum "$path"; done < "$evidence/auth-policy-files.txt" >> "$evidence/auth-policy-before.sha256"
packages > "$evidence/packages-before.tsv"
apt-mark showmanual > "$evidence/manual-packages-before.txt"
state > "$evidence/state-before.txt"
set_stage supported-target
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(dpkg --print-architecture) = amd64 ]]
[[ -d /run/systemd/system ]]
for path in /etc/couch /var/lib/couch /var/lib/couch-installer /var/lib/couch-install-locks /etc/X11/default-display-manager /usr/share/xsessions/couch.desktop; do
    [[ ! -e $path && ! -L $path ]] || { printf 'Fresh TV baseline has an existing path: %s\n' "$path"; exit 1; }
done
if getent passwd couch-tv >/dev/null; then echo 'The Couch runtime account already exists.'; exit 1; fi
command -v wget
printf 'acceptance_operations_started_at=%s\n' "$(utc)" >> "$evidence/run.txt"
set_stage bootstrap-apt-update
apt-get update > "$evidence/bootstrap-apt-update.log" 2>&1
set_stage bootstrap-install-verifiers
apt-get install --yes minisign jq > "$evidence/bootstrap-install.log" 2>&1
files=("Couch_${version}_amd64.AppImage" "Couch_${version}_amd64.AppImage.sig" "couch-setup-${version}.tar.gz" "couch-setup-${version}.tar.gz.sig" "couch-distribution-material-${version}.tar.gz" "couch-distribution-material-${version}.tar.gz.sig")
set_stage expected-manifest-validation
names=$(jq -n --args '$ARGS.positional' "${files[@]}")
jq -e --arg version "$version" --argjson names "$names" '
    .schemaVersion == 1 and .version == $version and (.revision | test("^[a-f0-9]{40}$")) and
    (.publicKey | type == "string" and length > 0) and
    ((.files | keys | sort) == ($names | sort)) and
    all(.files[]; (.sha256 | test("^[a-f0-9]{64}$")) and (.bytes | type == "number" and . > 0 and . <= 2147483648 and . == floor))
' "$evidence/expected-manifest.json" > "$evidence/manifest-validation.log"
mkdir "$evidence/downloads" "$evidence/http"
download() {
    local filename=$1 url=$2
    set_stage "download-$filename"
    printf 'started_at=%s\nrequested_url=%s\n' "$(utc)" "$url" > "$evidence/http/$filename.txt"
    wget --https-only --server-response --timeout=120 --tries=1 --max-redirect=20 \
        --output-document="$evidence/downloads/$filename.partial" "$url" \
        > "$evidence/http/$filename.stdout" 2> "$evidence/http/$filename.headers"
    printf 'finished_at=%s\n' "$(utc)" >> "$evidence/http/$filename.txt"
    mv -- "$evidence/downloads/$filename.partial" "$evidence/downloads/$filename"
}
download couch-updater.pub 'https://couch.avoid.quest/couch-updater.pub'
for filename in "${files[@]}"; do
    download "$filename" "https://cdn.crabnebula.app/download/avoid-quest/couch/latest/$filename?channel=preview"
done
set_stage verify-enrolled-key
[[ $(cat "$evidence/downloads/couch-updater.pub") = "$(jq -r .publicKey "$evidence/expected-manifest.json")" ]]
sha256sum "$evidence/downloads/couch-updater.pub" > "$evidence/public-key.sha256"
set_stage verify-six-file-identities
jq -r '.files | to_entries[] | "\(.value.sha256)  \(.key)"' "$evidence/expected-manifest.json" > "$evidence/expected-files.sha256"
(cd "$evidence/downloads" && sha256sum --check "$evidence/expected-files.sha256") > "$evidence/file-hashes.log"
for filename in "${files[@]}"; do
    [[ $(stat -c %s "$evidence/downloads/$filename") = "$(jq -r --arg name "$filename" '.files[$name].bytes' "$evidence/expected-manifest.json")" ]]
done
set_stage verify-public-signatures
base64 --decode "$evidence/downloads/couch-updater.pub" > "$evidence/downloads/couch-updater.minisign.pub"
for filename in "Couch_${version}_amd64.AppImage" "couch-setup-${version}.tar.gz" "couch-distribution-material-${version}.tar.gz"; do
    [[ $(cat "$evidence/downloads/$filename.sig") = "$(jq -r --arg name "$filename" '.files[$name].signature' "$evidence/expected-manifest.json")" ]]
    base64 --decode "$evidence/downloads/$filename.sig" > "$evidence/downloads/$filename.minisig"
    minisign -Vm "$evidence/downloads/$filename" -p "$evidence/downloads/couch-updater.minisign.pub" \
        -x "$evidence/downloads/$filename.minisig" >> "$evidence/signature-verification.log" 2>&1
done
set_stage extract-authenticated-setup
tar -tzf "$evidence/downloads/couch-setup-${version}.tar.gz" > "$evidence/setup-archive-contents.txt"
mkdir "$evidence/couch-setup"
tar -xzf "$evidence/downloads/couch-setup-${version}.tar.gz" -C "$evidence/couch-setup"
set_stage install-authenticated-tv-profile
printf 'installer_started_at=%s\n' "$(utc)" > "$evidence/installer-status.txt"
"$evidence/couch-setup/install-couch" --tv \
    --appimage "$evidence/downloads/Couch_${version}_amd64.AppImage" \
    --signature "$evidence/downloads/Couch_${version}_amd64.AppImage.sig" \
    --public-key "$evidence/downloads/couch-updater.pub" > "$evidence/installer.log" 2>&1
printf 'installer_finished_at=%s\ninstaller_exit_status=0\n' "$(utc)" >> "$evidence/installer-status.txt"
set_stage verify-installed-identity
cmp "$evidence/downloads/Couch_${version}_amd64.AppImage" /var/lib/couch/application/Couch.AppImage
cmp "$evidence/downloads/couch-updater.pub" /var/lib/couch/application/couch-updater.pub
cp /var/lib/couch/application/build.json "$evidence/installed-build.json"
jq -e --slurpfile expected "$evidence/expected-manifest.json" '
    .version == $expected[0].version and .revision == $expected[0].revision and
    .archiveSha256 == $expected[0].files["Couch_0.1.0_amd64.AppImage"].sha256 and .packaged == true
' "$evidence/installed-build.json" > "$evidence/installed-identity.log"
[[ -f /var/lib/couch-installer/tv-setup.complete && ! -e /var/lib/couch-installer/tv-setup.pending ]]
sha256sum /var/lib/couch/application/Couch.AppImage > "$evidence/installed-appimage.sha256"
set_stage installed-policy-and-modes
for path in /usr/lib/couch-appliance/{session,initialize-audio,set-autostart} /usr/sbin/couch-session; do
    stat -c '%a %U:%G %n' "$path" >> "$evidence/installed-entrypoint-modes.txt"
    runuser -u couch-tv -- test -x "$path"
done
passwd -S couch-tv > "$evidence/runtime-account-status.txt"
getent passwd couch-tv | cut -d: -f1,3,4,6,7 > "$evidence/runtime-account.txt"
sha256sum /etc/ssh/sshd_config /etc/sudoers > "$evidence/admin-auth-after.sha256"
cp "$evidence/admin-auth-after.sha256" "$evidence/auth-policy-after.sha256"
while read -r path; do sha256sum "$path"; done < "$evidence/auth-policy-files.txt" >> "$evidence/auth-policy-after.sha256"
cmp "$evidence/admin-auth-before.sha256" "$evidence/admin-auth-after.sha256"
dpkg-query -W -f='${binary:Package}\t${db:Status-Status}\n' 2>/dev/null | awk '$2 == "installed" && $1 ~ /^(task-.*desktop|xfce4|gnome-shell|plasma-desktop|cinnamon|mate-desktop-environment|lxde|lxqt)(:|$)/' > "$evidence/full-desktop-packages.txt"
[[ ! -s $evidence/full-desktop-packages.txt ]]
set_stage start-lightdm-once
printf 'lightdm_start_requested_at=%s\n' "$(utc)" > "$evidence/session-start.txt"
systemctl start lightdm
uid=$(id -u couch-tv)
mute_sinks() {
    local sink
    runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" pactl list short sinks > "$evidence/audio-sinks.txt" 2> "$evidence/audio-sinks.stderr" || return 0
    while read -r sink; do
        runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" pactl set-sink-mute "$sink" 1
        runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" pactl get-sink-mute "$sink"
    done < <(awk '{print $1}' "$evidence/audio-sinks.txt") > "$evidence/audio-mute.txt"
}
service() { runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
for attempt in {1..90}; do
    mute_sinks
    service show couch-tv.service -p ActiveState -p SubState -p MainPID -p Result -p NRestarts > "$evidence/runtime-status.txt" 2> "$evidence/runtime-status.stderr" || true
    if grep -q '^NRestarts=[1-9]' "$evidence/runtime-status.txt" || grep -q '^Result=signal$' "$evidence/runtime-status.txt"; then echo 'First native session failed; preserve this clone without repair.'; exit 1; fi
    if grep -q '^ActiveState=active$' "$evidence/runtime-status.txt" && grep -q '^SubState=running$' "$evidence/runtime-status.txt"; then break; fi
    sleep 2
done
grep -q '^ActiveState=active$' "$evidence/runtime-status.txt"
sleep 15
mute_sinks
service show couch-tv.service -p ActiveState -p SubState -p MainPID -p Result -p NRestarts > "$evidence/runtime-status-followup.txt"
grep -q '^ActiveState=active$' "$evidence/runtime-status-followup.txt"
grep -q '^NRestarts=0$' "$evidence/runtime-status-followup.txt"
systemctl status lightdm --no-pager > "$evidence/lightdm-status.txt"
loginctl list-sessions --no-pager > "$evidence/sessions-after.txt"
ps -eo pid,ppid,user,comm,rss,pcpu > "$evidence/processes-after.txt"
set_stage installation-and-session-observation-complete
printf 'Installation and byte identity checks passed. LightDM start was requested once. No reboot, playback or update was requested.\n' 
