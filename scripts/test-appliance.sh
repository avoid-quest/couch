#!/bin/bash
# Disposable Ubuntu root fixture. Service starts/APT are doubles; files, accounts,
# companion packaging, hashes, permissions and recovery operations are real.
set -euo pipefail
[[ $EUID = 0 && ! -e /etc/couch/appliance.env ]] || { echo 'Use a clean disposable Ubuntu environment.' >&2; exit 1; }
cd "$(dirname "$0")/.."
fixture=$(mktemp -d)
chmod 0755 "$fixture"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/commands" /run/systemd/system /etc/X11 /var/lib/couch-test-data
printf 'pairing queue progress\n' > /var/lib/couch-test-data/keep.txt
printf '#!/bin/sh\nexit 42\n' > /usr/sbin/policy-rc.d
chmod 755 /usr/sbin/policy-rc.d
cp /usr/sbin/policy-rc.d "$fixture/policy"
# Preserve configured data and rendering settings while migrating.
mkdir -p /etc/couch
printf 'COUCH_DATA_DIR=/var/lib/couch-test-data\nGDK_RENDERING=image\nCOUCH_BASIC_RENDERING=1\n' > /etc/couch/appliance.env
cp /etc/couch/appliance.env "$fixture/config"
printf 'trusted-public-key\n' > "$fixture/couch.pub"
cat > "$fixture/Couch.AppImage" <<'APP'
#!/bin/sh
printf '{"version":"0.1.1","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dataFormat":1}\n'
APP
chmod 755 "$fixture/Couch.AppImage"
sh scripts/build-appliance.sh "$fixture" 0.1.1 >/dev/null
package="$fixture/couch-appliance_0.1.1_all.deb"
! dpkg-deb -f "$package" Depends | grep -Eq 'python|couch \('
! dpkg-deb -c "$package" | grep -Eq 'updater|couch-update$|\.py$'
cat > "$fixture/commands/systemctl" <<'COMMAND'
#!/bin/sh
case "$1" in is-active) exit 3;; esac
exit 0
COMMAND
cat > "$fixture/commands/apt-get" <<'COMMAND'
#!/bin/bash
set -eu
[[ ${FAIL_APT:-0} != 1 ]] || exit 73
[[ $1 = install ]] || exit 0
package=${!#}
cp /etc/couch/appliance.env "$FIXTURE/preserved-config"
dpkg-deb -x "$package" /
cp "$FIXTURE/preserved-config" /etc/couch/appliance.env
dpkg-deb -e "$package" "$FIXTURE/control"
sh "$FIXTURE/control/postinst" configure
COMMAND
printf '#!/bin/sh\nexit 0\n' > "$fixture/commands/udevadm"
chmod 755 "$fixture/commands/"*
export FIXTURE="$fixture" PATH="$fixture/commands:$PATH"
keyhash=$(sha256sum "$fixture/couch.pub" | cut -d ' ' -f1)
if bash install-couch "$fixture/Couch.AppImage" "$package" --release-key "$fixture/couch.pub" --release-key-sha256 "$(printf '0%.0s' {1..64})" --release-feed 'https://example.test/tauri/' 2> "$fixture/error"; then exit 1; fi
grep -q 'SHA256 mismatch' "$fixture/error"
if FAIL_APT=1 bash install-couch "$fixture/Couch.AppImage" "$package"; then exit 1; else [[ $? = 73 ]]; fi
cmp "$fixture/policy" /usr/sbin/policy-rc.d
cmp "$fixture/config" /etc/couch/appliance.env
bash install-couch "$fixture/Couch.AppImage" "$package" --release-key "$fixture/couch.pub" --release-key-sha256 "$keyhash" --release-feed 'https://example.test/tauri/'
lid_policy=/usr/lib/systemd/logind.conf.d/50-couch.conf
grep -qx 'HandleLidSwitchExternalPower=ignore' "$lid_policy"
grep -qx 'HandleLidSwitch=suspend' "$lid_policy"
grep -qx 'HandleLidSwitchDocked=ignore' "$lid_policy"
grep -qx 'IdleAction=ignore' "$lid_policy"
! grep -Eq '^Handle(Power|Suspend|Hibernate|Reboot)Key' "$lid_policy"
cmp "$fixture/config" /etc/couch/appliance.env
cmp "$fixture/policy" /usr/sbin/policy-rc.d
jq -e '.endpoint == "https://example.test/tauri/" and .pubkey == "trusted-public-key"' /etc/couch/appimage-update.json >/dev/null
[[ $(stat -c '%U:%a' /etc/couch/appimage-update.json) = root:644 ]]
[[ $(stat -c '%U:%a' /var/lib/couch/application/Couch.AppImage) = couch-tv:700 ]]
backup=/var/lib/couch/application/backups/fixture
mkdir -p "$backup"
cp /var/lib/couch/application/{Couch.AppImage,build.json} "$backup/"
(cd "$backup" && sha256sum Couch.AppImage > SHA256SUMS)
printf 'newer user write\n' >> /var/lib/couch-test-data/keep.txt
cp /var/lib/couch-test-data/keep.txt "$fixture/newer-data"
cp /usr/bin/sleep "$fixture/couch"
runuser -u couch-tv -- "$fixture/couch" 60 &
writer=$!
for attempt in {1..50}; do pgrep -u couch-tv -x couch >/dev/null && break; sleep 0.1; done
if couch-recover "$backup" 2> "$fixture/error"; then exit 1; fi
grep -q 'writer remains' "$fixture/error"
pkill -u couch-tv -x couch
wait "$writer" || true
couch-recover "$backup"
cmp "$fixture/newer-data" /var/lib/couch-test-data/keep.txt
failed=$(find /var/lib/couch-installer -maxdepth 1 -name 'failed-*' | head -1)
cmp "$fixture/newer-data" "$failed/data/keep.txt"
# Tauri moves the old archive away before writing its replacement. Recovery
# must still work if an interruption leaves no current AppImage to preserve.
mv /var/lib/couch/application/Couch.AppImage "$fixture/interrupted-current.AppImage"
couch-recover "$backup"
cmp "$backup/Couch.AppImage" /var/lib/couch/application/Couch.AppImage
cmp "$fixture/newer-data" /var/lib/couch-test-data/keep.txt
jq '.dataFormat = 2' "$backup/build.json" > "$fixture/incompatible"
cp "$fixture/incompatible" "$backup/build.json"
if couch-recover "$backup" 2> "$fixture/error"; then exit 1; fi
grep -q 'Incompatible data format' "$fixture/error"
printf 'corrupt\n' >> "$backup/Couch.AppImage"
if couch-recover "$backup" 2> "$fixture/error"; then exit 1; fi
grep -q 'checksum mismatch' "$fixture/error"
cmp "$fixture/newer-data" /var/lib/couch-test-data/keep.txt
mv /var/lib/couch/application /var/lib/couch/application-kept
ln -s /etc /var/lib/couch/application
permissions=$(stat -c '%U:%a' /etc)
if bash install-couch "$fixture/Couch.AppImage" "$package" 2> "$fixture/error"; then exit 1; fi
grep -q 'symbolic link' "$fixture/error"
[[ $(stat -c '%U:%a' /etc) = "$permissions" ]]
rm /var/lib/couch/application
mv /var/lib/couch/application-kept /var/lib/couch/application
# Startup writes are fixed, atomic, root-owned and retained by reinstall.
startup=/etc/lightdm/lightdm.conf.d/90-couch-autostart.conf
couch-session autostart disable
grep -qx 'autologin-user=' "$startup"
[[ $(stat -c '%U:%a' "$startup") = root:644 ]]
cp "$startup" "$fixture/startup"
# Upgrade the old AC-suspend vendor policy without changing local power choices.
sed -i 's/HandleLidSwitchExternalPower=ignore/HandleLidSwitchExternalPower=suspend/' "$lid_policy"
mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitchExternalPower=suspend\nHandlePowerKey=ignore\n' > /etc/systemd/logind.conf.d/90-local-power.conf
cp /etc/systemd/logind.conf.d/90-local-power.conf "$fixture/local-power"
bash install-couch "$fixture/Couch.AppImage" "$package"
grep -qx 'HandleLidSwitchExternalPower=ignore' "$lid_policy"
cmp "$fixture/local-power" /etc/systemd/logind.conf.d/90-local-power.conf
cmp "$fixture/newer-data" /var/lib/couch-test-data/keep.txt
cmp "$fixture/config" /etc/couch/appliance.env
# Let systemd resolve vendor/administrator precedence, including a vendor mask.
power_setting() { systemd-analyze cat-config systemd/logind.conf | awk -F= -v key="$1" '$1 == key { value=$2 } END { print value }'; }
[[ $(power_setting HandleLidSwitchExternalPower) = suspend ]]
[[ $(power_setting HandlePowerKey) = ignore ]]
rm /etc/systemd/logind.conf.d/90-local-power.conf
ln -s /dev/null /etc/systemd/logind.conf.d/50-couch.conf
bash install-couch "$fixture/Couch.AppImage" "$package"
[[ $(readlink /etc/systemd/logind.conf.d/50-couch.conf) = /dev/null ]]
[[ -z $(power_setting HandleLidSwitchExternalPower) ]]
rm /etc/systemd/logind.conf.d/50-couch.conf
[[ $(power_setting HandleLidSwitchExternalPower) = ignore ]]
[[ $(power_setting HandleLidSwitch) = suspend ]]
cmp "$startup" "$fixture/startup"
if /usr/lib/couch-appliance/set-autostart arbitrary; then exit 1; fi
if /usr/lib/couch-appliance/set-autostart enable extra; then exit 1; fi
if runuser -u couch-tv -- /usr/lib/couch-appliance/set-autostart enable; then exit 1; fi
cmp "$startup" "$fixture/startup"
rm "$startup"
ln -s "$fixture/newer-data" "$startup"
if /usr/lib/couch-appliance/set-autostart disable; then exit 1; fi
cmp "$fixture/newer-data" /var/lib/couch-test-data/keep.txt
rm "$startup"
mv /etc/lightdm/lightdm.conf.d /etc/lightdm/lightdm.conf.d-kept
ln -s "$fixture" /etc/lightdm/lightdm.conf.d
if /usr/lib/couch-appliance/set-autostart enable; then exit 1; fi
[[ ! -e "$fixture/90-couch-autostart.conf" ]]
rm /etc/lightdm/lightdm.conf.d
mv /etc/lightdm/lightdm.conf.d-kept /etc/lightdm/lightdm.conf.d
chmod o+w /etc/lightdm/lightdm.conf.d
if /usr/lib/couch-appliance/set-autostart enable; then exit 1; fi
chmod o-w /etc/lightdm/lightdm.conf.d
couch-session autostart enable
grep -qx 'autologin-user=couch-tv' "$startup"
echo 'PASS: AppImage migration, Tauri trust/hash, companion closure, AC/battery lid policy, administrator power overrides/masks, policy/profile/data preservation, compatible recovery, retained newer writes, corrupt/incompatible rejection'
