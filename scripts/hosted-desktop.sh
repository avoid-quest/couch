#!/bin/bash
# Docker host orchestration, shared by Actions and the temporary Mac builder.
set -euo pipefail
builder=${1:?Supply the task-owned Debian builder container}
output=$(realpath "${2:?Supply the qualification evidence directory}")
fixture="couch-native-deb-${GITHUB_RUN_ID:-local}-$$"
mkdir -p "$output/qualification" "$output/evidence"
trap 'docker logs "$fixture" > "$output/runtime.log" 2>&1 || true; docker rm -f "$fixture" > /dev/null 2>&1 || true' EXIT
docker exec -w /work "$builder" cargo install tauri-driver --version 2.0.6 --locked
docker exec -w /work "$builder" ffmpeg -v error -y -f lavfi -i testsrc2=size=640x360:rate=24 -f lavfi -i sine=frequency=440 -t 15 -c:v libx264 -pix_fmt yuv420p -c:a aac /tmp/couch-sample.mp4
version=$(docker exec -w /work "$builder" bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
docker cp "$builder:/work/.artifacts/hosted-release/public/Couch_${version}_amd64.deb" "$output/qualification/couch.deb"
docker cp "$builder:/root/.cargo/bin/tauri-driver" "$output/qualification/tauri-driver"
docker cp "$builder:/tmp/couch-sample.mp4" "$output/qualification/sample.mp4"
cp tests/package/debian-runtime.sh "$output/qualification/runtime.sh"
image=$(bun -p '(await Bun.file("packaging/inputs.json").json()).debianImage')
docker run -d --name "$fixture" --init --platform linux/amd64 --cpus 2 --memory 4g --shm-size 1g \
  -v "$output/qualification:/qualification:ro" -v "$output/evidence:/evidence" -e COUCH_DEB_FIXTURE=1 \
  "$image" bash /qualification/runtime.sh > /dev/null
for attempt in $(seq 1 180); do
  if [ -f "$output/evidence/ready" ]; then break; fi
  test ! -f "$output/evidence/failed"
  test "$(docker inspect -f '{{.State.Running}}' "$fixture")" = true
  sleep 2
done
test -f "$output/evidence/ready"
bun tests/package/debian-desktop.ts "$fixture" "$output/evidence"
