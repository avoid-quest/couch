#!/bin/bash
# Disposable real systemd/APT qualification. The tiny application is a lifecycle
# fixture, not native media or installed AppImage acceptance.
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
    cd "$(dirname "$0")/.."
    real=false
    extra=()
    if [[ ${1:-} = --appimage ]]; then
        [[ $# = 3 ]] || { echo 'Usage: test-appliance-systemd.sh --appimage ABS_APPIMAGE ABS_EVIDENCE' >&2; exit 2; }
        artifact=$(realpath "$2")
        mkdir -p "$3"
        evidence=$(realpath "$3")
        bun tests/package/installed.ts --prepare "$evidence"
        extra=(--network host -e COUCH_TEST_REAL_APPIMAGE=1 -v "$artifact:/fixture-input.AppImage:ro" -v "$evidence:/qualification")
        real=true
    fi
    name="couch-appliance-systemd-${GITHUB_RUN_ID:-local}-$$"
    trap 'result=$?; if [[ $result != 0 ]]; then docker exec "$name" journalctl -b --no-pager -n 150 || true; fi; docker rm -f "$name" >/dev/null 2>&1 || true; docker image rm "$name" >/dev/null 2>&1 || true' EXIT
    docker build -t "$name" - <<'DOCKER'
FROM ubuntu:24.04
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes && apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus git jq acl procps
CMD ["/sbin/init"]
DOCKER
    docker run -d --name "$name" "${extra[@]}" --privileged --cgroupns=host --tmpfs /run --tmpfs /run/lock -v /sys/fs/cgroup:/sys/fs/cgroup:rw -v "$PWD:/repo:ro" "$name"
    for attempt in {1..30}; do docker exec "$name" systemctl is-active dbus && break; sleep 1; done
    docker exec "$name" bash /repo/scripts/test-appliance-systemd.sh --inside
    if $real; then bun tests/package/installed.ts --verify "$evidence" "$name"; fi
    exit
fi
cd /repo
git config --global --add safe.directory /repo
mkdir -p /fixture /etc/couch /var/lib/couch-test-data
printf 'COUCH_DATA_DIR=/var/lib/couch-test-data\nGDK_RENDERING=image\nCOUCH_BASIC_RENDERING=1\n' > /etc/couch/appliance.env
if [[ ${COUCH_TEST_REAL_APPIMAGE:-} = 1 ]]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb xauth openbox xdotool webkit2gtk-driver dbus-x11
    printf 'COUCH_HOST=127.0.0.1\nCOUCH_PORT=44100\nDISPLAY=:99\nLIBGL_ALWAYS_SOFTWARE=1\nWEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1\n' >> /etc/couch/appliance.env
    cp /qualification/couch.sqlite /qualification/keep.txt /var/lib/couch-test-data/
    if [[ -f /qualification/appimage-update.json ]]; then install -o root -g root -m 0644 /qualification/appimage-update.json /etc/couch/appimage-update.json; fi
    Xvfb :99 -screen 0 1280x720x24 -ac -nolisten tcp > /tmp/xvfb.log 2>&1 &
fi
cp /etc/couch/appliance.env /fixture/config
[[ -f /var/lib/couch-test-data/keep.txt ]] || printf 'retained pairing\n' > /var/lib/couch-test-data/keep.txt
cp /usr/bin/sleep /fixture/couch
cat > /fixture/Couch.AppImage <<'APP'
#!/bin/sh
if [ "${1:-}" = --version ]; then
    printf '{"version":"0.1.1","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dataFormat":1}\n'
else
    exec /fixture/couch infinity
fi
APP
if [[ ${COUCH_TEST_REAL_APPIMAGE:-} = 1 ]]; then cp /fixture-input.AppImage /fixture/Couch.AppImage; fi
chmod 755 /fixture/Couch.AppImage
# This fixture has no physical display/audio. Retain the real production app
# unit, replacing only seat acquisition and its audio preconditions.
mkdir -p /etc/systemd/user/couch-tv.service.d
if [[ ${COUCH_TEST_REAL_APPIMAGE:-} != 1 ]]; then printf '[Service]\nExecStartPre=\n' > /etc/systemd/user/couch-tv.service.d/fixture.conf; fi
cat > /fixture/start-session <<'SESSION'
#!/bin/bash
set -eu
loginctl enable-linger couch-tv
uid=$(id -u couch-tv)
systemctl start "user@$uid.service"
if [[ -f /fixture-input.AppImage ]]; then
    runuser -u couch-tv -- env DISPLAY=:99 openbox > /tmp/openbox.log 2>&1 &
    runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user start pipewire-pulse.service wireplumber.service
    for attempt in {1..30}; do runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" pactl info >/dev/null 2>&1 && break; sleep 1; done
    runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" pactl load-module module-null-sink sink_name=couch_fixture
fi
runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user start couch-tv.service
SESSION
chmod 755 /fixture/start-session
mkdir -p /etc/systemd/system/lightdm.service.d
cat > /etc/systemd/system/lightdm.service.d/fixture.conf <<'UNIT'
[Unit]
Description=Fixture seat (no physical display)
[Service]
Type=oneshot
ExecStart=
ExecStartPre=
ExecStart=/fixture/start-session
RemainAfterExit=yes
Restart=no
UNIT
sh scripts/build-appliance.sh /fixture 0.1.1
bash install-couch /fixture/Couch.AppImage /fixture/couch-appliance_0.1.1_all.deb
cmp /fixture/config /etc/couch/appliance.env
if [[ ${COUCH_TEST_REAL_APPIMAGE:-} = 1 ]]; then
    for port in 44445 44447; do
        install -d -o couch-tv -g couch-tv -m 0700 "/var/lib/couch/browser-$port"
        runuser -u couch-tv -- env DISPLAY=:99 HOME="/var/lib/couch/browser-$port" WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WebKitWebDriver --port="$port" > "/tmp/browser-$port.log" 2>&1 &
    done
    echo 'Actual AppImage service installed; host consumer owns browser and recovery acceptance.'
    exit
fi
uid=$(id -u couch-tv)
service() { runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
service is-active couch-tv.service
before=$(service show couch-tv.service -p MainPID --value)
couch-session restart
after=$(service show couch-tv.service -p MainPID --value)
[[ $before != "$after" && $(pgrep -u couch-tv -x couch | wc -l) = 1 ]]
# Exercise the real systemd authorization and real fixed APT operation.
runtime_version=$(dpkg-query -W -f='${Version}' ffmpeg)
runuser -u couch-tv -- systemctl --no-ask-password start couch-runtime-repair.service
[[ $(dpkg-query -W -f='${Version}' ffmpeg) = "$runtime_version" ]]
[[ $(systemctl show couch-runtime-repair.service -p Result --value) = success ]]
if runuser -u couch-tv -- systemctl --no-ask-password stop couch-runtime-repair.service; then exit 1; fi
if runuser -u couch-tv -- systemctl --no-ask-password restart dbus.service; then exit 1; fi
# Real Polkit startup writes leave the current application and session alone.
startup_pid=$(service show couch-tv.service -p MainPID --value)
for mode in disable enable; do
    runuser -u couch-tv -- systemctl --no-ask-password start "couch-autostart@$mode.service"
    [[ $(systemctl show "couch-autostart@$mode.service" -p Result --value) = success ]]
    [[ $(service show couch-tv.service -p MainPID --value) = "$startup_pid" ]]
done
[[ $(stat -c '%U:%a' /etc/lightdm/lightdm.conf.d/90-couch-autostart.conf) = root:644 ]]
runuser -u couch-tv -- /usr/sbin/lightdm --show-config 2> /fixture/lightdm-config
grep -q 'autologin-user=couch-tv' /fixture/lightdm-config
if runuser -u couch-tv -- systemctl --no-ask-password stop couch-autostart@enable.service; then exit 1; fi
if runuser -u couch-tv -- systemctl --no-ask-password start couch-autostart@unexpected.service; then exit 1; fi
if runuser -u nobody -- systemctl --no-ask-password start couch-autostart@disable.service; then exit 1; fi
if runuser -u couch-tv -- /usr/lib/couch-appliance/set-autostart disable; then exit 1; fi
backup=/var/lib/couch/application/backups/fixture
mkdir -p "$backup"
cp /var/lib/couch/application/{Couch.AppImage,build.json} "$backup/"
(cd "$backup" && sha256sum Couch.AppImage > SHA256SUMS)
printf 'newer queue and progress\n' >> /var/lib/couch-test-data/keep.txt
cp /var/lib/couch-test-data/keep.txt /fixture/newer-data
couch-session stop
printf '#!/bin/sh\nexit 1\n' > /var/lib/couch/application/Couch.AppImage
service start couch-tv.service || true
for attempt in {1..40}; do [[ $(service show couch-tv.service -p ActiveState --value) = failed ]] && break; sleep 1; done
[[ $(service show couch-tv.service -p ActiveState --value) = failed ]]
couch-recover "$backup"
service is-active couch-tv.service
[[ $(pgrep -u couch-tv -x couch | wc -l) = 1 ]]
cmp /fixture/newer-data /var/lib/couch-test-data/keep.txt
echo 'PASS: real Ubuntu systemd/APT installation, single owner restart, fixed Polkit repair/startup, unchanged live session, unrelated privilege rejection, bounded failed starts and SSH recovery preserving newer data'
