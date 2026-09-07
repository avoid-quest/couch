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
echo 'PASS: AppImage migration, Tauri trust/hash, companion closure, policy/profile/data preservation, compatible recovery, retained newer writes, corrupt/incompatible rejection'
