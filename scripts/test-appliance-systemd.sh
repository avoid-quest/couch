#!/bin/bash
# Disposable real systemd/APT qualification. The tiny application is a lifecycle
# fixture, not native media or installed AppImage acceptance.
set -euo pipefail
if [[ ${1:-} != --inside ]]; then
    cd "$(dirname "$0")/.."
    name="couch-appliance-systemd-${GITHUB_RUN_ID:-local}-$$"
    trap 'result=$?; if [[ $result != 0 ]]; then docker exec "$name" journalctl -b --no-pager -n 150 || true; fi; docker rm -f "$name" >/dev/null 2>&1 || true; docker image rm "$name" >/dev/null 2>&1 || true' EXIT
    docker build -t "$name" - <<'DOCKER'
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv dbus git jq acl procps
CMD ["/sbin/init"]
DOCKER
    docker run -d --name "$name" --privileged --cgroupns=host --tmpfs /run --tmpfs /run/lock -v /sys/fs/cgroup:/sys/fs/cgroup:rw -v "$PWD:/repo:ro" "$name"
    for attempt in {1..30}; do docker exec "$name" systemctl is-active dbus && break; sleep 1; done
    docker exec "$name" bash /repo/scripts/test-appliance-systemd.sh --inside
    exit
fi
cd /repo
git config --global --add safe.directory /repo
mkdir -p /fixture /etc/couch /var/lib/couch-test-data
printf 'COUCH_DATA_DIR=/var/lib/couch-test-data\nGDK_RENDERING=image\nCOUCH_BASIC_RENDERING=1\n' > /etc/couch/appliance.env
cp /etc/couch/appliance.env /fixture/config
printf 'retained pairing\n' > /var/lib/couch-test-data/keep.txt
cp /usr/bin/sleep /fixture/couch
cat > /fixture/Couch.AppImage <<'APP'
#!/bin/sh
if [ "${1:-}" = --version ]; then
    printf '{"version":"0.1.1","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","dataFormat":1}\n'
else
    exec /fixture/couch infinity
fi
APP
chmod 755 /fixture/Couch.AppImage
# This fixture has no physical display/audio. Retain the real production app
# unit, replacing only seat acquisition and its audio preconditions.
mkdir -p /etc/systemd/user/couch-tv.service.d
printf '[Service]\nExecStartPre=\n' > /etc/systemd/user/couch-tv.service.d/fixture.conf
cat > /fixture/start-session <<'SESSION'
#!/bin/bash
set -eu
loginctl enable-linger couch-tv
uid=$(id -u couch-tv)
systemctl start "user@$uid.service"
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
uid=$(id -u couch-tv)
service() { runuser -u couch-tv -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" systemctl --user "$@"; }
service is-active couch-tv.service
before=$(service show couch-tv.service -p MainPID --value)
couch-session restart
after=$(service show couch-tv.service -p MainPID --value)
[[ $before != "$after" && $(pgrep -u couch-tv -x couch | wc -l) = 1 ]]
# Exercise the real systemd authorization and real fixed APT operation.
runuser -u couch-tv -- systemctl --no-ask-password start couch-runtime-repair.service
[[ $(systemctl show couch-runtime-repair.service -p Result --value) = success ]]
if runuser -u couch-tv -- systemctl --no-ask-password stop couch-runtime-repair.service; then exit 1; fi
if runuser -u couch-tv -- systemctl --no-ask-password restart dbus.service; then exit 1; fi
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
echo 'PASS: real Ubuntu systemd/APT installation, single owner restart, fixed Polkit repair, unrelated privilege rejection, bounded failed starts and SSH recovery preserving newer data'
