#!/bin/bash
# Run only in a fresh disposable Debian 13 container, without build or GUI packages.
# docker run --rm -v "$PWD:/work:ro" -w /work debian:13-slim bash tests/package/host-graphics.sh
set -euo pipefail
[[ -f /.dockerenv ]] || exit 1
source /etc/os-release
[[ $ID = debian && $VERSION_ID = 13 ]] || exit 1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes --no-install-recommends python3
mapfile -t packages < <(python3 -c 'import json,sys; print(*json.load(open(sys.argv[1]))["common"], sep="\n")' "${1:-packaging/setup/files.json}")
apt-get install --yes --no-install-recommends "${packages[@]}"
# WebKit/libepoxy opens GLES at runtime, so ldd and the app's --version miss it.
env -u LD_LIBRARY_PATH -u LD_PRELOAD python3 - <<'PY'
import ctypes
import os

gles = ctypes.CDLL("libGLESv2.so.2", mode=os.RTLD_NOW)
assert gles.glGetString
print("PASS: declared host packages provide loadable GLESv2")
PY
