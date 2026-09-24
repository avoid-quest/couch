#!/bin/bash
# Docker host orchestration, shared by Actions and the temporary Mac builder.
set -euo pipefail
builder=${1:?Supply the task-owned Debian builder container}
output=$(realpath "${2:?Supply the qualification evidence directory}")
format=${3:-deb}
builder_workdir=${COUCH_BUILDER_WORKDIR:-/work}
case "$format" in deb|appimage) ;; *) echo 'Choose deb or appimage' >&2; exit 1 ;; esac
fixture="couch-native-${format}-${GITHUB_RUN_ID:-local}-$$"
mkdir -p "$output/qualification" "$output/evidence"
trap 'docker logs "$fixture" > "$output/runtime.log" 2>&1 || true; docker rm -f "$fixture" > /dev/null 2>&1 || true' EXIT
docker exec -w "$builder_workdir" "$builder" bash -lc 'cargo install --list | grep -qx "tauri-driver v2.0.6:" || cargo install tauri-driver --version 2.0.6 --locked'
version=$(docker exec -w "$builder_workdir" "$builder" bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
docker cp "$builder:/root/.cargo/bin/tauri-driver" "$output/qualification/tauri-driver"
if [ "$format" = deb ]; then
  docker exec -w "$builder_workdir" "$builder" ffmpeg -v error -y -f lavfi -i testsrc2=size=640x360:rate=24 -f lavfi -i sine=frequency=440 -t 15 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/couch-sample.mp4
  docker cp "$builder:$builder_workdir/.artifacts/hosted-release/public/Couch_${version}_amd64.deb" "$output/qualification/couch.deb"
  docker cp "$builder:/tmp/couch-sample.mp4" "$output/qualification/sample.mp4"
  cp tests/package/debian-runtime.sh "$output/qualification/runtime.sh"
else
  docker exec -w "$builder_workdir" "$builder" ffmpeg -v error -y -f lavfi -i color=c=red:size=640x360:rate=24 -f lavfi -i sine=frequency=440 -t 15 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/couch-appimage-sample.mp4
  docker cp "$builder:$builder_workdir/.artifacts/hosted-release/public/Couch_${version}_amd64.AppImage" "$output/qualification/Couch.AppImage"
  docker exec "$builder" stat -c %s /root/.cache/tauri/runtime-x86_64 > "$output/qualification/runtime-offset"
  docker cp "$builder:/tmp/couch-appimage-sample.mp4" "$output/qualification/sample.mp4"
  cp tests/package/appimage-runtime.sh "$output/qualification/runtime.sh"
fi
fixture_env=COUCH_DEB_FIXTURE=1
if [ "$format" = appimage ]; then fixture_env=COUCH_APPIMAGE_FIXTURE=1; fi
launcher_env=COUCH_APPIMAGE_EXTRACTED=0
if [ "$format" = appimage ] && [ "$(uname -m)" != x86_64 ]; then launcher_env=COUCH_APPIMAGE_EXTRACTED=1; fi
if [ "$format" = appimage ]; then
  image=$(bun -p '(await Bun.file("packaging/inputs.json").json()).appimageImage')
else
  image=$(bun -p '(await Bun.file("packaging/inputs.json").json()).debianImage')
fi
docker run -d --name "$fixture" --init --platform linux/amd64 --cpus 2 --memory 4g --shm-size 1g \
  -v "$output/qualification:/qualification:ro" -v "$output/evidence:/evidence" -e "$fixture_env" -e "$launcher_env" \
  "$image" bash /qualification/runtime.sh > /dev/null
for attempt in $(seq 1 180); do
  if [ -f "$output/evidence/ready" ]; then break; fi
  test ! -f "$output/evidence/failed"
  test "$(docker inspect -f '{{.State.Running}}' "$fixture")" = true
  sleep 2
done
test -f "$output/evidence/ready"
docker exec "$fixture" chmod 0777 /evidence
if [ "$format" = deb ]; then bun tests/package/debian-desktop.ts "$fixture" "$output/evidence"; else bun tests/package/appimage-desktop.ts "$fixture" "$output/evidence"; fi
