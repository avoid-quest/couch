#!/bin/bash
# Run once as root on production Xfce clone 51B194AC-B25F-4C1C-AD73-0EF9B79B850D.
# Root must first confirm website and production public readiness.
# Arguments: trusted production-A manifest, NEW evidence directory.
# Downloads and verifies all public bytes in the VM. Never builds, repairs, reboots or changes login.
set -euo pipefail
umask 077
export LC_ALL=C
export DEBIAN_FRONTEND=noninteractive
version=0.1.0-preview.1
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
packages() { dpkg-query -W -f='${binary:Package}\t${Version}\t${Installed-Size}\t${db:Status-Status}\n' | sort; }
policy() {
    for path in /etc/lightdm /etc/systemd /etc/X11 /etc/polkit-1 /usr/share/lightdm /usr/lib/systemd/logind.conf.d; do
        if [[ -d $path ]]; then find "$path" -type f -exec sha256sum {} +; fi
    done | sort
}
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
    if [[ $stage = install-authenticated-desktop-profile && $result != 0 ]]; then
        printf 'installer_finished_at=%s\ninstaller_exit_status=%s\n' "$(utc)" "$result" >> "$evidence/installer-status.txt"
    fi
    if [[ $result != 0 ]]; then
        printf 'First attempt failed at %s, exit %s. No repair or retry was attempted.\n' "$stage" "$result" > "$evidence/FIRST_FAILURE.txt"
    fi
    packages > "$evidence/packages-after.tsv"
    printf 'packages_after_exit=%s\n' "$?" >> "$evidence/result.txt"
    apt-mark showmanual > "$evidence/manual-packages-after.txt"
    if [[ -f $evidence/packages-before.tsv ]]; then diff -u "$evidence/packages-before.tsv" "$evidence/packages-after.tsv" > "$evidence/packages.delta"; fi
    policy > "$evidence/session-policy-after.tsv"
    if [[ -f $evidence/session-policy-before.tsv ]]; then diff -u "$evidence/session-policy-before.tsv" "$evidence/session-policy-after.tsv" > "$evidence/session-policy.delta"; fi
    state > "$evidence/state-after.txt" 2>&1
    printf 'state_after_exit=%s\n' "$?" >> "$evidence/result.txt"
    printf 'gui_playback_update_acceptance=unrun\nmac_offline_condition=not_applicable_mac_hosted_vm\n' >> "$evidence/result.txt"
    sync -f "$evidence"
    exit "$result"
}
trap finish EXIT
printf 'collector_started_at=%s\nversion=%s\n' "$(utc)" "$version" > "$evidence/run.txt"
cp -- "$expected_manifest" "$evidence/expected-manifest.json"
sha256sum "$evidence/expected-manifest.json" > "$evidence/expected-manifest.sha256"
set_stage baseline
packages > "$evidence/packages-before.tsv"
apt-mark showmanual > "$evidence/manual-packages-before.txt"
state > "$evidence/state-before.txt"
policy > "$evidence/session-policy-before.tsv"
[[ $(wc -l < "$evidence/packages-before.tsv") = 1415 ]]
cmp /home/probe/couch-277-production-a/baseline/packages.tsv "$evidence/packages-before.tsv"
cmp /home/probe/couch-277-production-a/baseline/session-policy.tsv "$evidence/session-policy-before.tsv"
set_stage supported-target
. /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 && $(dpkg --print-architecture) = amd64 ]]
[[ -d /run/systemd/system ]]
for path in /etc/couch /var/lib/couch /var/lib/couch-installer /var/lib/couch-install-locks /usr/share/xsessions/couch.desktop /home/probe/.local/lib/couch; do
    [[ ! -e $path && ! -L $path ]] || { printf 'Fresh desktop baseline has an existing path: %s\n' "$path"; exit 1; }
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
    .schemaVersion == 1 and .version == $version and (.revision == "3f91c0564bbbeea04eef421977f2e67b17c8fb14") and
    (.publicKey | type == "string" and length > 0) and
    ((.files | keys | sort) == ($names | sort)) and
    all(.files[]; (.sha256 | test("^[a-f0-9]{64}$")) and (.bytes | type == "number" and . > 0 and . <= 2147483648 and . == floor))
' "$evidence/expected-manifest.json" > "$evidence/manifest-validation.log"
mkdir "$evidence/downloads" "$evidence/http"
download() {
    local filename=$1 url=$2
    set_stage "download-$filename"
    printf 'started_at=%s\nrequested_url=%s\n' "$(utc)" "$url" > "$evidence/http/$filename.txt"
    wget --server-response --max-redirect=10 --timeout=60 --tries=3 \
        --retry-on-http-error=429,503 --waitretry=60 \
        --output-file="$evidence/http/$filename.headers" \
        --output-document="$evidence/downloads/$filename.partial" "$url"
    # Wget records each request URL and response. Refuse an insecure redirect chain.
    awk '/^--.*--  / { url=$NF; if (url !~ /^https:\/\//) exit 1; final=url } END { if (final == "") exit 1; print "final_url=" final }' \
        "$evidence/http/$filename.headers" >> "$evidence/http/$filename.txt"
    awk '/^[[:space:]]*HTTP\// { status=$2 } END { print "http_status=" status; if (status != 200) exit 1 }' \
        "$evidence/http/$filename.headers" >> "$evidence/http/$filename.txt"
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
set_stage install-authenticated-desktop-profile
printf 'installer_started_at=%s\n' "$(utc)" > "$evidence/installer-status.txt"
"$evidence/couch-setup/install-couch" --desktop-user probe \
    --appimage "$evidence/downloads/Couch_${version}_amd64.AppImage" \
    --signature "$evidence/downloads/Couch_${version}_amd64.AppImage.sig" \
    --public-key "$evidence/downloads/couch-updater.pub" > "$evidence/installer.log" 2>&1
printf 'installer_finished_at=%s\ninstaller_exit_status=0\n' "$(utc)" >> "$evidence/installer-status.txt"
set_stage verify-installed-identity
cmp "$evidence/downloads/Couch_${version}_amd64.AppImage" /home/probe/.local/lib/couch/Couch.AppImage
cmp "$evidence/downloads/couch-updater.pub" /home/probe/.local/lib/couch/couch-updater.pub
cp /home/probe/.local/lib/couch/build.json "$evidence/installed-build.json"
jq -e --slurpfile expected "$evidence/expected-manifest.json" '
    .version == $expected[0].version and .revision == $expected[0].revision and
    .archiveSha256 == $expected[0].files["Couch_0.1.0-preview.1_amd64.AppImage"].sha256 and .packaged == true
' "$evidence/installed-build.json" > "$evidence/installed-identity.log"
[[ $(stat -c %U /home/probe/.local/lib/couch/Couch.AppImage) = probe ]]
set_stage verify-desktop-policy-preservation
policy > "$evidence/session-policy-after.tsv"
cmp "$evidence/session-policy-before.tsv" "$evidence/session-policy-after.tsv"
set_stage installation-complete
printf 'Installation and byte identity checks passed. No reboot, playback or update was requested.\n'
