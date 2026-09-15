#!/bin/bash
# Destructive shell fixture: disposable Debian container only, never the host.
set -euo pipefail
[[ -f /.dockerenv && ${COUCH_TV_FIXTURE:-} = 1 ]] || exit 1
root=$(mktemp -d)
trap '[[ -z ${socket_pid:-} ]] || kill "$socket_pid" 2>/dev/null || true; rm -rf "$root"' EXIT
templates=/usr/share/couch/tv
mkdir -p "$root/bin" "$templates" /run/systemd/system /usr/bin
mkdir -p /usr/lib/Couch/tools
printf '#!/bin/sh\nprintf '\''{"verified":true}\\n'\''\n' > /usr/lib/Couch/tools/deno
chmod +x /usr/lib/Couch/tools/deno
cp packaging/native/couch-setup /usr/sbin/couch-setup
chmod 0755 /usr/sbin/couch-setup
while read -r path; do
    mkdir -p "$templates/$(dirname "$path")"
    cp -p "packaging/appliance/root/$path" "$templates/$path"
done < <(jq -r '.files[]' packaging/setup/files.json)
sed -i 's|ExecStart=/var/lib/couch/application/Couch.AppImage|ExecStart=/usr/bin/couch|' "$templates/usr/lib/systemd/user/couch-tv.service"
jq -r '.files[]' packaging/setup/files.json > "$templates/files"
printf '%s\n' lightdm pipewire-audio openbox > "$templates/packages"
cp packaging/appliance/root/usr/sbin/couch-recover "$templates/couch-recover-appimage"
export FIXTURE_LOG=$root/operations FIXTURE_ACTIVE=$root/active FIXTURE_START_FAIL=0 FIXTURE_APT_FAIL=0
cat > "$root/bin/dpkg-query" <<'QUERY'
#!/bin/sh
printf installed
QUERY
cat > "$root/bin/apt-get" <<'APT'
#!/bin/bash
printf 'apt %s\n' "$*" >> "$FIXTURE_LOG"
[[ $FIXTURE_APT_FAIL != 1 ]] || exit 73
APT
cat > "$root/bin/systemctl" <<'SYSTEMCTL'
#!/bin/bash
printf 'systemctl %s\n' "$*" >> "$FIXTURE_LOG"
case "$*" in
    *'show couch-tv.service --property=MainPID --value') printf '123\n' ;;
    *'is-active'*) test -f "$FIXTURE_ACTIVE" ;;
    *'stop couch-tv.service') rm -f "$FIXTURE_ACTIVE" ;;
    *'start couch-tv.service')
        if [[ $FIXTURE_START_FAIL = 1 && -L /etc/systemd/user/couch-tv.service ]]; then exit 71; fi
        touch "$FIXTURE_ACTIVE" ;;
esac
SYSTEMCTL
cat > "$root/bin/runuser" <<'RUNUSER'
#!/bin/bash
# Preserve the controlled service environment across the real user boundary.
exec /usr/sbin/runuser "$@"
RUNUSER
cat > /usr/bin/couch <<'APP'
#!/bin/sh
printf '{"packaged":true,"dataFormat":1,"version":"0.1.1","revision":"native"}\n'
APP
chmod +x "$root/bin/"* /usr/bin/couch
chmod 0755 "$root"
touch "$FIXTURE_LOG"; chmod 0666 "$FIXTURE_LOG"
chmod 0777 "$root"
export PATH="$root/bin:$PATH"
setup() { /usr/sbin/couch-setup "$@"; }
reject() { if setup "$@" > "$root/failure" 2>&1; then cat "$root/failure"; exit 1; fi; }
# An ordinary package exposes only templates and the optional command.
test ! -e /etc/couch
test ! -e /etc/systemd/user/couch-tv.service
! getent passwd couch-tv
useradd -m -s /bin/bash desktop
runuser -u desktop -- mkdir -p /home/desktop/.local/{lib/couch,share/applications,share/quest.avoid.couch,bin}
printf retained > /home/desktop/.local/lib/couch/Couch.AppImage
printf pairing > /home/desktop/.local/share/quest.avoid.couch/couch.sqlite
printf mode > /home/desktop/.local/share/quest.avoid.couch/operating-mode.json
printf '[Desktop Entry]\nExec="/home/desktop/.local/lib/couch/Couch.AppImage"\n' > /home/desktop/.local/share/applications/couch.desktop
cp "$templates/couch-recover-appimage" /home/desktop/.local/bin/couch-recover
chown -R desktop:desktop /home/desktop/.local
setup --desktop-user desktop
test ! -e /home/desktop/.local/share/applications/couch.desktop
test -e /home/desktop/.local/share/applications/couch.desktop.appimage-retained
test -e /home/desktop/.local/bin/couch-recover.appimage-retained
test "$(cat /home/desktop/.local/share/quest.avoid.couch/couch.sqlite)" = pairing
test "$(cat /home/desktop/.local/lib/couch/Couch.AppImage)" = retained
test ! -s "$FIXTURE_LOG"
setup --desktop-user desktop
test ! -e /etc/couch
# Conflicts are rejected before APT, account creation or session activation.
mkdir -p /etc/X11
echo /usr/sbin/gdm3 > /etc/X11/default-display-manager
reject --tv
grep -q 'Another display manager' "$root/failure"
test ! -s "$FIXTURE_LOG"
! getent passwd couch-tv
rm /etc/X11/default-display-manager
FIXTURE_APT_FAIL=1 reject --tv
test -f /var/lib/couch-installer/native-tv/pending
test ! -e /var/lib/couch-installer/native-tv/complete
! getent passwd couch-tv
setup --tv
test "$(getent passwd couch-tv | cut -d: -f6)" = /var/lib/couch
test "$(id -Gn couch-tv)" = couch-tv
test "$(passwd -S couch-tv | awk '{print $2}')" = L
test -L /etc/systemd/user/couch-tv.service
grep -qx 'ExecStart=/usr/bin/couch' /etc/systemd/user/couch-tv.service
test -e /var/lib/couch-installer/native-tv/complete
test ! -e /var/lib/couch-installer/native-tv/pending
grep -q 'enable lightdm.service' "$FIXTURE_LOG"
grep -q 'set-default graphical.target' "$FIXTURE_LOG"
for command in /usr/lib/couch-appliance/{session,initialize-audio,set-autostart} /usr/sbin/couch-session; do test -x "$command"; done
# Repeat preserves edited configuration, masks and disabled boot policy.
rm /etc/couch/appliance.env
printf 'COUCH_DATA_DIR=/var/lib/couch/custom-data\n# administrator configuration\n' > /etc/couch/appliance.env
rm /etc/systemd/logind.conf.d/50-couch.conf
ln -s /dev/null /etc/systemd/logind.conf.d/50-couch.conf
printf '[Seat:seat0]\nautologin-user=\n' > /etc/lightdm/lightdm.conf.d/90-couch-autostart.conf
before=$(sha256sum /etc/couch/appliance.env /etc/lightdm/lightdm.conf.d/90-couch-autostart.conf)
: > "$FIXTURE_LOG"
setup --tv
test "$before" = "$(sha256sum /etc/couch/appliance.env /etc/lightdm/lightdm.conf.d/90-couch-autostart.conf)"
test "$(readlink /etc/systemd/logind.conf.d/50-couch.conf)" = /dev/null
! grep -q 'enable lightdm\|set-default\|restart' "$FIXTURE_LOG"
# Model a released AppImage setup with a running user service and retained identity.
rm /etc/systemd/user/couch-tv.service
rm -rf /var/lib/couch-installer/native-tv
mkdir -p /var/lib/couch-installer /usr/lib/systemd/user /var/lib/couch/application /var/lib/couch/custom-data
touch /var/lib/couch-installer/tv-setup.complete
cp packaging/appliance/root/usr/lib/systemd/user/couch-tv.service /usr/lib/systemd/user/couch-tv.service
cp /usr/bin/couch /var/lib/couch/application/Couch.AppImage
printf pairing > /var/lib/couch/custom-data/couch.sqlite
printf mode > /var/lib/couch/custom-data/operating-mode.json
chown -R couch-tv:couch-tv /var/lib/couch/application /var/lib/couch/custom-data
sha256sum /var/lib/couch/application/Couch.AppImage /var/lib/couch/custom-data/* > "$root/retained.sha256"
# A Unix socket is enough to model the bus admission; systemctl itself is a double.
mkdir -p "/run/user/$(id -u couch-tv)"
socat "UNIX-LISTEN:/run/user/$(id -u couch-tv)/bus" OPEN:/dev/null &
socket_pid=$!
for attempt in {1..50}; do [[ ! -S /run/user/$(id -u couch-tv)/bus ]] || break; sleep 0.1; done
touch "$FIXTURE_ACTIVE"; chmod 0666 "$FIXTURE_ACTIVE"
FIXTURE_START_FAIL=1 reject --tv
grep -q 'Native migration did not complete' "$root/failure"
test ! -e /etc/systemd/user/couch-tv.service
test -e "$FIXTURE_ACTIVE"
sha256sum -c "$root/retained.sha256"
setup --tv
grep -qx 'ExecStart=/usr/bin/couch' /etc/systemd/user/couch-tv.service
sha256sum -c "$root/retained.sha256"
test "$(cat /var/lib/couch-installer/native-tv/data/couch.sqlite)" = pairing
setup --tv --restore-appimage
test ! -e /etc/systemd/user/couch-tv.service
test -e "$FIXTURE_ACTIVE"
sha256sum -c "$root/retained.sha256"
setup --tv
printf changed >> /var/lib/couch/application/Couch.AppImage
reject --tv --restore-appimage
grep -q 'retained AppImage changed' "$root/failure"
test -L /etc/systemd/user/couch-tv.service
# Existing installation/recovery lock also excludes native migration.
flock /var/lib/couch-install-locks/tv.lock sleep 20 &
held=$!
sleep 0.2
reject --tv
grep -q 'Another Couch installation' "$root/failure"
kill "$held"; wait "$held" || true
echo 'PASS: inert package, desktop migration, optional TV setup, retry, administrator policy, retained AppImage, startup failure and locking'
