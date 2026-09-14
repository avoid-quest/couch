#!/bin/bash
# Destructive fixture: run only inside a disposable Debian container, never on a host.
set -euo pipefail
[[ -f /.dockerenv ]] || exit 1
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
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
export FIXTURE_LOG=$root/operations FIXTURE_MISSING=
printf '#!/bin/sh\nprintf "apt-get %%s\\n" "$*" >> "$FIXTURE_LOG"\n' > "$root/bin/apt-get"
printf '#!/bin/sh\nprintf "systemctl %%s\\n" "$*" >> "$FIXTURE_LOG"\n' > "$root/bin/systemctl"
cat > "$root/bin/dpkg-query" <<'QUERY'
#!/bin/sh
case "$*" in
 *pulseaudio*) echo installed;;
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
install_app() { bash "$setup/install-couch" --appimage "$root/Couch.AppImage" --signature "$root/Couch.AppImage.sig" --public-key "$root/key" "$@"; }
reject() { if install_app "$@" > "$root/failure" 2>&1; then cat "$root/failure"; exit 1; fi; }
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
: > "$FIXTURE_LOG"
install_app --desktop-user desktop
test "$before" = "$(sha256sum /etc/lightdm/lightdm.conf.d/99-administrator.conf)"
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
rm /etc/X11/default-display-manager
install_app --tv
test "$(stat -c %U /var/lib/couch/application/Couch.AppImage)" = couch-tv
grep -q pipewire-audio "$FIXTURE_LOG"
grep -q 'enable lightdm' "$FIXTURE_LOG"
printf '\n# administrator adjustment\n' >> /etc/couch/appliance.env
before=$(sha256sum /etc/couch/appliance.env)
: > "$FIXTURE_LOG"
install_app --tv
test "$before" = "$(sha256sum /etc/couch/appliance.env)"
! grep -q 'enable lightdm\|set-default' "$FIXTURE_LOG"
echo 'PASS: signatures, targets, missing packages/FUSE, desktop preservation, TV setup, repeat setup and separate user data'
