#!/usr/bin/env bash
set -euo pipefail
# Run only in the coordinator-approved disposable container. No host ports.
umask 077
mkdir -p /work /artifacts/private /artifacts/public /tmp/origin-tools
apt-get update > /artifacts/private/apt.log 2>&1
apt-get install -y --no-install-recommends libnss3-tools libasound2t64 >> /artifacts/private/apt.log 2>&1
dpkg-query -W -f='${Package} ${Version}\n' libnss3 libnss3-tools libasound2t64 > /artifacts/public/package-versions.txt
tar -xzf /inputs/caddy.tar.gz -C /tmp/origin-tools caddy
unzip -q /inputs/chromium.zip -d /tmp/origin-tools
git clone --no-checkout /inputs/base.bundle /work > /artifacts/private/clone.log 2>&1
git -C /work checkout --detach d77af244cf6d1f6aab872e2fee0a11897284815f >> /artifacts/private/clone.log 2>&1
ln -s /inputs/node_modules /work/node_modules
cd /work
git rev-parse HEAD > /artifacts/public/source.txt
git status --porcelain > /artifacts/public/source-status.txt
bun scripts/build.ts > /artifacts/private/build.log 2>&1
cp src-tauri/build-info.json /artifacts/public/build-info.json
sha256sum src-tauri/binaries/couch-server-aarch64-unknown-linux-gnu > /artifacts/public/sidecar.sha256
find dist -type f -print0 | sort -z | xargs -0 sha256sum > /artifacts/public/frontend.sha256
cp src-tauri/binaries/couch-server-aarch64-unknown-linux-gnu /artifacts/private/couch-server
exec timeout --signal=TERM --kill-after=10 180 bun /source/tests/linux/origin.ts
