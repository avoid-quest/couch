#!/bin/bash
# Destructive fixture: run only inside a disposable Debian container, never on a host.
set -euo pipefail
[[ -f /.dockerenv ]] || exit 1
root=$(mktemp -d)
trap '[[ -z ${paused:-} ]] || kill "$paused" 2>/dev/null || true; rm -rf "$root"' EXIT
setup=$root/setup
mkdir -p "$setup/tv" "$root/bin" /run/systemd/system /usr/share/xsessions
cp install-couch "$setup/"
cp packaging/setup/files.json "$setup/host-packages.json"
cp packaging/appliance/root/usr/sbin/couch-recover "$setup/"
cp src-tauri/icons/128x128.png "$setup/couch.png"
while read -r path; do mkdir -p "$setup/tv/$(dirname "$path")"; cp -p "packaging/appliance/root/$path" "$setup/tv/$path"; done < <(jq -r '.files[]' packaging/setup/files.json)
cp /etc/os-release "$root/os-release"
minisign -G -W -p "$root/key.pub" -s "$root/key.sec" >/dev/null
base64 -w0 "$root/key.pub" > "$root/key"
cat > "$root/Couch.AppImage" <<'APP'
#!/bin/sh
printf '%s\n' '{"packaged":true,"version":"0.1.0-preview.1","target":"x86_64-unknown-linux-gnu","dataFormat":1,"revision":"1111111111111111111111111111111111111111","helpers":{"ffprobe":{},"yt-dlp":{},"deno":{}}}'
APP
chmod 0755 "$root/Couch.AppImage"
minisign -Sm "$root/Couch.AppImage" -s "$root/key.sec"
base64 -w0 "$root/Couch.AppImage.minisig" > "$root/Couch.AppImage.sig"
chmod 0755 "$root"
useradd -m -s /bin/bash desktop
printf '[Desktop Entry]\nName=Fixture X11\n' > /usr/share/xsessions/fixture.desktop
# Keep the fixture from doing any real package or service work.
export FIXTURE_LOG=$root/operations FIXTURE_MISSING= FIXTURE_APT_FAIL=0
cat > "$root/bin/apt-get" <<'APT'
#!/bin/bash
printf 'apt-get %s\n' "$*" >> "$FIXTURE_LOG"
if [[ " $* " = *' lightdm '* ]]; then
    printf /usr/sbin/lightdm > /etc/X11/default-display-manager
    [[ $FIXTURE_APT_FAIL != 1 ]] || exit 73
fi
APT
printf '#!/bin/sh\nprintf "systemctl %%s\\n" "$*" >> "$FIXTURE_LOG"\n' > "$root/bin/systemctl"
cat > "$root/bin/dpkg-query" <<'QUERY'
#!/bin/sh
case "$*" in
 *pulseaudio*) printf installed;;
 *pipewire-pulse*) exit 1;;
 *) if [ "${!#}" = "$FIXTURE_MISSING" ]; then exit 1; fi; printf installed;;
esac
QUERY
# bash is required only by this test double's last-argument expansion.
sed -i '1c#!/bin/bash' "$root/bin/dpkg-query"
for command in fusermount3 xrandr xset pactl dbus-send bwrap xdg-dbus-proxy; do printf '#!/bin/sh\nexit 0\n' > "$root/bin/$command"; done
cat > "$root/bin/runuser" <<'RUNUSER'
#!/bin/bash
# Docker's device cgroup denies FUSE even when its mode permits access.
# Model successful host access after the separate missing-device check.
if [[ "$*" = *"test -r /dev/fuse" || "$*" = *"test -w /dev/fuse" ]]; then exit 0; fi
exec /usr/sbin/runuser "$@"
RUNUSER
chmod +x "$root/bin/"*
export PATH="$root/bin:$PATH"
installer_args=(--appimage "$root/Couch.AppImage" --signature "$root/Couch.AppImage.sig" --public-key "$root/key")
install_app() { bash "$setup/install-couch" "${installer_args[@]}" "$@"; }
reject() { if install_app "$@" > "$root/failure" 2>&1; then cat "$root/failure"; exit 1; fi; }
interrupt_setup() {
    local boundary=$1
    if bash -c 'boundary=$1; shift; set -T; trap '\''if [[ $BASH_COMMAND = "$boundary" ]]; then echo "fixture interruption" >&2; kill -KILL $$; fi'\'' DEBUG; source "$@"' \
        "$setup/install-couch" "$boundary" "$setup/install-couch" "${installer_args[@]}" --tv > "$root/failure" 2>&1; then exit 1; fi
    grep -q 'fixture interruption' "$root/failure"
    test -f /var/lib/couch-installer/tv-setup.pending
    test ! -e /var/lib/couch-installer/tv-setup.complete
}
# Pause real setup/recovery shells after locking, without production test hooks.
mkdir -m 0777 "$root/pause"
pause_operation() {
    local user=$1 script=$2 boundary=$3
    shift 3
    rm -f "$root/pause/ready" "$root/pause/resume"
    mkfifo -m 0666 "$root/pause/resume"
    runuser -u "$user" -- bash -c 'boundary=$1; signal=$2; shift 2; set -T; trap '\''if [[ $BASH_COMMAND = "$boundary" ]]; then touch "$signal/ready"; read -r < "$signal/resume"; fi'\'' DEBUG; source "$@"' \
        "$script" "$boundary" "$root/pause" "$script" "$@" > "$root/paused-operation" 2>&1 &
    paused=$!
    for attempt in {1..100}; do [[ ! -e $root/pause/ready ]] || return 0; sleep 0.1; done
    cat "$root/paused-operation"
    exit 1
}
resume_operation() { echo resume > "$root/pause/resume"; wait "$paused"; paused=; }
# Unsupported distro and architecture fail before even creating the installer lock.
rm -f /run/couch-install.lock
printf 'ID=ubuntu\nVERSION_ID="24.04"\n' > /etc/os-release
reject --desktop-user desktop
grep -q 'Debian 13 x86_64/X11' "$root/failure"
test ! -e /run/couch-install.lock && test ! -e "$FIXTURE_LOG"
cp "$root/os-release" /etc/os-release
printf '#!/bin/sh\necho arm64\n' > "$root/bin/dpkg"; chmod +x "$root/bin/dpkg"
reject --desktop-user desktop
test ! -e /run/couch-install.lock && test ! -e "$FIXTURE_LOG"
rm "$root/bin/dpkg"
# Real verifier rejects changed bytes before APT or target account creation.
printf 'corruption\n' >> "$root/Couch.AppImage"
reject --tv
test ! -e "$FIXTURE_LOG" && ! getent passwd couch-tv
sed -i '$d' "$root/Couch.AppImage"
# A missing declared package and missing FUSE device cannot become success.
FIXTURE_MISSING=fuse3; export FIXTURE_MISSING
reject --desktop-user desktop
grep -q 'package fuse3 is missing' "$root/failure"
FIXTURE_MISSING=; export FIXTURE_MISSING
reject --desktop-user desktop
grep -q 'FUSE device' "$root/failure"
mknod /dev/fuse c 10 229; chmod 0666 /dev/fuse
# Desktop preserves login/system policy and an installed audio service.
mkdir -p /etc/lightdm/lightdm.conf.d
printf 'administrator-policy\n' > /etc/lightdm/lightdm.conf.d/99-administrator.conf
before=$(sha256sum /etc/lightdm/lightdm.conf.d/99-administrator.conf)
mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitchExternalPower=suspend\nHandlePowerKey=ignore\n' > /etc/systemd/logind.conf.d/90-local-power.conf
power_before=$(sha256sum /etc/systemd/logind.conf.d/90-local-power.conf)
lid_policy=/usr/lib/systemd/logind.conf.d/50-couch.conf
test ! -e "$lid_policy"
: > "$FIXTURE_LOG"
install_app --desktop-user desktop
test "$before" = "$(sha256sum /etc/lightdm/lightdm.conf.d/99-administrator.conf)"
test "$power_before" = "$(sha256sum /etc/systemd/logind.conf.d/90-local-power.conf)"
test ! -e "$lid_policy"
! grep -q systemctl "$FIXTURE_LOG"
! grep -q pipewire-audio "$FIXTURE_LOG"
test "$(stat -c %U /home/desktop/.local/lib/couch/Couch.AppImage)" = desktop
runuser -u desktop -- mkdir -p /home/desktop/.local/share/quest.avoid.couch
printf retained > /home/desktop/.local/share/quest.avoid.couch/sentinel
install_app --desktop-user desktop
test "$(cat /home/desktop/.local/share/quest.avoid.couch/sentinel)" = retained
# Minimal TV setup is explicit, and refuses existing display-manager policy.
mkdir -p /etc/X11
printf /usr/sbin/gdm3 > /etc/X11/default-display-manager
reject --tv
grep -q 'Another display manager' "$root/failure"
printf /usr/sbin/lightdm > /etc/X11/default-display-manager
reject --tv
grep -q 'LightDM already has a desktop policy' "$root/failure"
rm /etc/X11/default-display-manager
# APT can leave a configured display manager before any managed files exist.
FIXTURE_APT_FAIL=1 reject --tv
test -f /var/lib/couch-installer/tv-setup.pending
test ! -e /var/lib/couch-installer/tv-files.sha256
test ! -e /var/lib/couch-installer/tv-setup.complete
test "$(cat /etc/X11/default-display-manager)" = /usr/sbin/lightdm
# Copying the file ledger does not complete boot setup. Both boundaries resume.
interrupt_setup 'systemctl enable lightdm.service'
test "$(stat -c %U /var/lib/couch/application/Couch.AppImage)" = couch-tv
grep -q pipewire-audio "$FIXTURE_LOG"
printf '\n# administrator adjustment\n' >> /etc/couch/appliance.env
before=$(sha256sum /etc/couch/appliance.env)
: > "$FIXTURE_LOG"
interrupt_setup 'systemctl set-default graphical.target'
test "$before" = "$(sha256sum /etc/couch/appliance.env)"
grep -q 'enable lightdm' "$FIXTURE_LOG"
! grep -q set-default "$FIXTURE_LOG"
install_app --tv
test -f /var/lib/couch-installer/tv-setup.complete
test ! -e /var/lib/couch-installer/tv-setup.pending
grep -q 'set-default graphical.target' "$FIXTURE_LOG"
grep -qx 'HandleLidSwitchExternalPower=ignore' "$lid_policy"
grep -qx 'HandleLidSwitch=suspend' "$lid_policy"
grep -qx 'HandleLidSwitchDocked=ignore' "$lid_policy"
grep -qx 'IdleAction=ignore' "$lid_policy"
! grep -Eq '^Handle(Power|Suspend|Hibernate|Reboot)Key' "$lid_policy"
test "$power_before" = "$(sha256sum /etc/systemd/logind.conf.d/90-local-power.conf)"
power_setting() { systemd-analyze cat-config systemd/logind.conf | awk -F= -v key="$1" '$1 == key { value=$2 } END { print value }'; }
test "$(power_setting HandleLidSwitchExternalPower)" = suspend
rm /etc/systemd/logind.conf.d/90-local-power.conf
ln -s /dev/null /etc/systemd/logind.conf.d/50-couch.conf
: > "$FIXTURE_LOG"
install_app --tv
test "$before" = "$(sha256sum /etc/couch/appliance.env)"
! grep -q 'enable lightdm\|set-default' "$FIXTURE_LOG"
! grep -q 'restart\|kill' "$FIXTURE_LOG"
test "$(readlink /etc/systemd/logind.conf.d/50-couch.conf)" = /dev/null
test -z "$(power_setting HandleLidSwitchExternalPower)"
rm /etc/systemd/logind.conf.d/50-couch.conf
test "$(power_setting HandleLidSwitchExternalPower)" = ignore
# The same recovery command works without root and retains newer data.
runuser -u desktop -- mkdir -p /home/desktop/retained
cp /home/desktop/.local/lib/couch/{Couch.AppImage,Couch.AppImage.sig,build.json} /home/desktop/retained/
(cd /home/desktop/retained && sha256sum Couch.AppImage > SHA256SUMS)
chown -R desktop:desktop /home/desktop/retained
# Root setup and unprivileged recovery contend on the same persistent inode.
desktop_lock=/var/lib/couch-install-locks/desktop-$(id -u desktop).lock
test "$(stat -c '%U:%a' "$desktop_lock")" = desktop:400
runuser -u desktop -- test ! -w /var/lib/couch-install-locks
runuser -u couch-tv -- test ! -r "$desktop_lock"
runuser -u desktop -- test ! -r /var/lib/couch-install-locks/tv.lock
pause_operation root "$setup/install-couch" 'apt-get update' "${installer_args[@]}" --desktop-user desktop
if runuser -u desktop -- /home/desktop/.local/bin/couch-recover /home/desktop/retained > "$root/recovery-failure" 2>&1; then exit 1; fi
grep -q 'Another installation or recovery' "$root/recovery-failure"
resume_operation
pause_operation desktop /home/desktop/.local/bin/couch-recover 'mkdir -p "$state"' /home/desktop/retained
if runuser -u desktop -- env XDG_STATE_HOME=/home/desktop/other-state /home/desktop/.local/bin/couch-recover /home/desktop/retained > "$root/recovery-failure" 2>&1; then exit 1; fi
grep -q 'Another installation or recovery' "$root/recovery-failure"
test ! -e /home/desktop/other-state
inode=$(stat -c %i "$desktop_lock")
reject --desktop-user desktop
grep -q 'Another Couch installation or recovery' "$root/failure"
test "$inode" = "$(stat -c %i "$desktop_lock")"
resume_operation
# TV recovery uses the same lock as root TV setup, before stopping the session.
mkdir -p /var/lib/couch/.local/share/quest.avoid.couch
printf '#!/bin/sh\nprintf "couch-session %%s\\n" "$*" >> "$FIXTURE_LOG"\n' > "$root/bin/couch-session"
chmod +x "$root/bin/couch-session"
pause_operation root "$setup/install-couch" 'apt-get update' "${installer_args[@]}" --tv
if /usr/sbin/couch-recover /home/desktop/retained > "$root/recovery-failure" 2>&1; then exit 1; fi
grep -q 'Another installation or recovery' "$root/recovery-failure"
! grep -q couch-session "$FIXTURE_LOG"
resume_operation
pause_operation root /usr/sbin/couch-recover 'mkdir -p "$state"' /home/desktop/retained
reject --tv
grep -q 'Another Couch installation or recovery' "$root/failure"
resume_operation
runuser -u desktop -- /home/desktop/.local/bin/couch-recover /home/desktop/retained
test "$(cat /home/desktop/.local/share/quest.avoid.couch/sentinel)" = retained
jq '.dataFormat = 2' /home/desktop/retained/build.json > "$root/incompatible"
cp "$root/incompatible" /home/desktop/retained/build.json
if runuser -u desktop -- /home/desktop/.local/bin/couch-recover /home/desktop/retained > "$root/recovery-failure" 2>&1; then exit 1; fi
grep -q 'Incompatible data format' "$root/recovery-failure"
echo 'PASS: desktop recovery preserves current data and rejects an incompatible retained app'
echo 'PASS: desktop and TV setup/recovery contention, interrupted TV boot setup and administrator power policy'
echo 'PASS: signatures, targets, missing packages/FUSE, desktop preservation, TV setup, repeat setup and separate user data'
