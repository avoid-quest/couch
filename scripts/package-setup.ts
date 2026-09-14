import { strict as assert } from "node:assert";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import setup from "../packaging/setup/files.json";

// Only these public inputs enter the archives. Source/docs/evidence are never recursively exported.
const version = process.argv[2];
assert.match(version ?? "", /^\d+\.\d+\.\d+(?:-preview\.[1-9]\d*)?$/);
const output = resolve(process.argv[3] ?? ".artifacts/distribution");
const staging = join(output, "staging");
await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, "setup"), { recursive: true });
await mkdir(join(staging, "material"), { recursive: true });
for (const [source, target] of [
  ["install-couch", "install-couch"],
  ["packaging/appliance/root/usr/sbin/couch-recover", "couch-recover"],
  ["packaging/setup/files.json", "host-packages.json"],
  ["src-tauri/icons/128x128.png", "couch.png"],
  ["docs/install-couch.md", "README.md"],
]) await cp(source!, join(staging, "setup", target!));
for (const file of setup.files) {
  const destination = join(staging, "setup/tv", file);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await cp(join("packaging/appliance/root", file), destination);
}
for (const file of ["NOTICE", "bun-LICENSE.md", "yt-dlp-LICENSE", "yt-dlp-NOTICES.txt", "deno-LICENSE.md", "native.txt", "javascript.json"]) await cp(join("src-tauri/resources/notices", file), join(staging, "material", file));
// These generated directories contain only dependency notices and approved extractor source.
for (const directory of ["debian", "javascript", "streamingcommunity"]) await cp(join("src-tauri/resources/notices", directory), join(staging, "material", directory), { recursive: true });
for (const [directory, name] of [["setup", `couch-setup-${version}.tar.gz`], ["material", `couch-distribution-material-${version}.tar.gz`]]) {
  const tar = Bun.spawnSync(["tar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-cf", "-", "-C", join(staging, directory!), "."], { maxBuffer: 128 * 1024 * 1024 });
  assert.equal(tar.exitCode, 0, tar.stderr.toString());
  await Bun.write(join(output, name!), Bun.gzipSync(new Uint8Array(tar.stdout)));
}
await rm(staging, { recursive: true });
console.log(`Built allowlisted setup and dependency material in ${output}. Sign each archive with the pinned Tauri signer before distribution.`);
