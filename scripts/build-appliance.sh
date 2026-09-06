#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
revision=$(git rev-parse HEAD)
version="$(sed -n 's/^  "version": "\([^"]*\)",/\1/p' package.json)+appliance.$(git rev-parse --short=12 HEAD)"
version=${2:-$version}
dpkg --validate-version "$version"
destination=${1:-.artifacts/appliance}
mkdir -p "$destination"
destination=$(cd "$destination" && pwd)
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT HUP INT TERM
cp -R packaging/appliance/root/. "$staging/"
cp -R packaging/appliance/DEBIAN "$staging/DEBIAN"
sed "s/^Version: .*/Version: $version/" packaging/appliance/DEBIAN/control > "$staging/DEBIAN/control"
chmod 0755 "$staging/DEBIAN/postinst" "$staging/usr/lib/couch-appliance/session" "$staging/usr/lib/couch-appliance/initialize-audio" "$staging/usr/sbin/couch-session"
mkdir -p "$staging/usr/share/doc/couch-appliance"
cp packaging/NOTICE "$staging/usr/share/doc/couch-appliance/copyright"
printf '{"package":"couch-appliance","version":"%s","sourceCommit":"%s"}\n' "$version" "$revision" > "$staging/usr/share/doc/couch-appliance/build-info.json"
dpkg-deb --root-owner-group --build "$staging" "$destination/couch-appliance_${version}_all.deb"
