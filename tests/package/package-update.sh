#!/bin/bash
# Destructive shell fixture: disposable Debian container only, never the host.
set -euo pipefail
[[ -f /.dockerenv && ${COUCH_PACKAGE_UPDATE_FIXTURE:-} = 1 ]] || exit 1

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p /usr/lib/couch /usr/lib/systemd/system /usr/share/polkit-1/rules.d
cp packaging/native/package-update /usr/lib/couch/package-update
cp packaging/native/couch-package-update@.service /usr/lib/systemd/system/
cp packaging/native/50-couch-package-update.rules /usr/share/polkit-1/rules.d/
chmod 0755 /usr/lib/couch/package-update
command -v minisign >/dev/null || { apt-get update -qq && apt-get install -y -qq minisign; }

useradd -m couchtest
home=$(getent passwd couchtest | cut -d: -f6)
inbox=$home/.local/share/couch/updates
mkdir -p "$inbox" /usr/bin

# A disposable passphrase-free keypair stands in for the enrolled release key.
printf '\n\n' | minisign -G -p "$root/test.pub" -s "$root/test.key" 2>/dev/null
cp "$root/test.pub" /usr/lib/couch/couch-updater.pub

# A minimal real package: name, version and architecture are what the helper checks.
build() {
    local version=$1 directory=$2
    rm -f "$inbox/couch.deb" "$inbox/couch.deb.sig"
    mkdir -p "$directory/DEBIAN" "$directory/usr/share/couch"
    printf 'Package: couch\nVersion: %s\nArchitecture: amd64\nMaintainer: test <test@invalid>\nDescription: fixture package\n' "$version" > "$directory/DEBIAN/control"
    printf fixture > "$directory/usr/share/couch/fixture"
    head -c 1M /dev/urandom > "$directory/usr/share/couch/pad"
    dpkg-deb -b --root-owner-group "$directory" "$inbox/couch.deb" >/dev/null
}
sign() { printf '\n' | minisign -S -s "$root/test.key" -x "$inbox/couch.deb.sig" -m "$inbox/couch.deb" 2>/dev/null; }
stage() {
    build "$1" "$root/pkg"
    sign
    chown couchtest:couchtest "$inbox/couch.deb" "$inbox/couch.deb.sig"
}
# The real dpkg stands in for apt's dependency resolution.
apt-get() { [[ $1 = install ]] && dpkg -i "${@: -1}" >/dev/null || { echo "unexpected apt call: $*" >&2; return 64; }; }

update() { /usr/lib/couch/package-update "$@"; }
reject() {
    local message=$1
    if update "${@:2}" > "$root/failure" 2>&1; then cat "$root/failure"; exit 1; fi
    grep -q "$message" "$root/failure" || { echo "Missing '$message' in:"; cat "$root/failure"; exit 1; }
}

# Today's live release is 0.1.2 stable. A signed 0.1.3 upgrade installs and
# writes a root-owned receipt the app can read.
stage 0.1.2
update couchtest >/dev/null
grep -q 'outcome=installed' "/var/lib/couch-package-update/couchtest/receipt"
grep -q 'version=0.1.2' "/var/lib/couch-package-update/couchtest/receipt"
[[ $(dpkg-query -W -f='${Version}' couch) = 0.1.2 ]]
[[ $(stat -c %U "/var/lib/couch-package-update/couchtest/receipt") = root ]]

# Native releases carry final versions only; Preview is a channel, never a
# -preview.N suffix, and the root boundary enforces that too.
build 0.1.3-preview.1 "$root/pkg"
sign
chown couchtest:couchtest "$inbox/couch.deb" "$inbox/couch.deb.sig"
reject 'not a supported release version' couchtest

stage 0.1.3
update couchtest >/dev/null
grep -q 'outcome=installed' "/var/lib/couch-package-update/couchtest/receipt"
grep -q 'version=0.1.3' "/var/lib/couch-package-update/couchtest/receipt"
[[ $(dpkg-query -W -f='${Version}' couch) = 0.1.3 ]]
[[ $(stat -c %U "/var/lib/couch-package-update/couchtest/receipt") = root ]]

# A downgrade back to 0.1.2 is rejected even with a valid signature.
build 0.1.2 "$root/pkg"
sign
chown couchtest:couchtest "$inbox/couch.deb" "$inbox/couch.deb.sig"
reject 'not newer' couchtest
grep -q 'outcome=failed' "/var/lib/couch-package-update/couchtest/receipt"

# Tampered staged bytes fail the signature and never install.
build 0.1.3 "$root/pkg"
sign
chown couchtest:couchtest "$inbox/couch.deb" "$inbox/couch.deb.sig"
printf x >> "$inbox/couch.deb"
reject 'Signature verification failed' couchtest
[[ $(dpkg-query -W -f='${Version}' couch) = 0.1.3 ]]

# Inbox files owned by another account are refused before staging.
build 0.1.3 "$root/pkg"
sign
reject 'is not owned by' couchtest
chown couchtest:couchtest "$inbox/couch.deb"

# A symlinked package path is refused.
build 0.1.3 "$root/pkg"
sign
mv "$inbox/couch.deb" "$root/real.deb"
ln -s "$root/real.deb" "$inbox/couch.deb"
chown -h couchtest "$inbox/couch.deb"
reject 'Missing or invalid inbox file' couchtest
rm "$inbox/couch.deb" && cp "$root/real.deb" "$inbox/couch.deb" && chown couchtest:couchtest "$inbox/couch.deb"

# An unknown account instance fails without touching anything.
reject 'Unknown account' nobody-here

echo "package-update fixture: passed"
