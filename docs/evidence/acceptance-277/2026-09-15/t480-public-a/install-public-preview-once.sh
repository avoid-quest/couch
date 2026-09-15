#!/bin/bash
# Run once as root inside the existing durable T480 tmux session.
# Arguments: trusted hosted-ready manifest, NEW evidence directory, optional UTC epoch.
# Downloads and verifies public bytes on the T480. Never builds, repairs or reboots.
set -euo pipefail
umask 077
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive
version=0.1.0-preview.1
expected_manifest=${1:?Supply the trusted hosted-ready manifest.json}
evidence=${2:?Supply a new /var/tmp/couch-acceptance-277-* directory}
not_before=${3:-0}
[[ $# -le 3 && $EUID = 0 ]] || { echo 'Run as root with two or three arguments.' >&2; exit 2; }
[[ -f $expected_manifest && $expected_manifest = /* ]] || { echo 'Expected manifest must be an existing absolute file.' >&2; exit 2; }
[[ $evidence = /var/tmp/couch-acceptance-277-* && $evidence != *$'\n'* ]] || { echo 'Use the task evidence directory prefix.' >&2; exit 2; }
[[ $not_before =~ ^[0-9]+$ ]] || { echo 'Start epoch must be an integer.' >&2; exit 2; }
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
    printf 'state_after_exit=%s\n' "$?" >> "$evidence/result.txt"
    printf 'gui_playback_update_acceptance=unrun\nmac_offline_condition=requires_parent_observation\n' >> "$evidence/result.txt"
    sync -f "$evidence"
    exit "$result"
}
trap finish EXIT
printf 'collector_started_at=%s\nversion=%s\nnot_before_epoch=%s\n' "$(utc)" "$version" "$not_before" > "$evidence/run.txt"
cp -- "$expected_manifest" "$evidence/expected-manifest.json"
sha256sum "$evidence/expected-manifest.json" > "$evidence/expected-manifest.sha256"
set_stage baseline
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
command -v curl
set_stage awaiting-offline-window
now=$(date +%s)
if (( not_before > now )); then
    (( not_before - now <= 600 )) || { echo 'Start delay exceeds ten minutes.'; exit 2; }
    sleep "$((not_before - now))"
fi
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
    curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
        --connect-timeout 20 --max-time 900 --retry 2 --retry-max-time 240 \
        --dump-header "$evidence/http/$filename.headers" \
        --output "$evidence/downloads/$filename.partial" \
        --write-out 'http_status=%{http_code}\nfinal_url=%{url_effective}\nredirect_count=%{num_redirects}\nsize_download=%{size_download}\ntime_total=%{time_total}\n' \
        "$url" >> "$evidence/http/$filename.txt"
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
    .archiveSha256 == $expected[0].files["Couch_0.1.0-preview.1_amd64.AppImage"].sha256 and .packaged == true
' "$evidence/installed-build.json" > "$evidence/installed-identity.log"
[[ -f /var/lib/couch-installer/tv-setup.complete && ! -e /var/lib/couch-installer/tv-setup.pending ]]
set_stage installation-complete
printf 'Installation and byte identity checks passed. No reboot, playback or update was requested.\n'
