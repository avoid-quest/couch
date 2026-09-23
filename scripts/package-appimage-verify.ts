import { strict as assert } from "node:assert";
import { lstat, mkdtemp, readdir, readlink, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { binaryArchitectures, isNativeLibrary, verifyPayload } from "./desktop-payload";
import { verifyPackageHelpers } from "./package-verify-helpers";

const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const build = await Bun.file("src-tauri/build-info.json").json();
assert.equal(build.target, "x86_64-unknown-linux-gnu");
const directory = "src-tauri/target/release/bundle/appimage";
const names = await readdir(directory);
const images = names.filter(name => name.endsWith(".AppImage"));
assert.equal(images.length, 1, "Build exactly one AppImage");
assert.deepEqual(names.sort(), [images[0], `${images[0]}.sig`].sort(), "Only the AppImage and its updater signature may be bundled");
const archive = join(directory, images[0]!);
assert.ok((await stat(archive)).mode & 0o111, "The AppImage must be executable");
assert.deepEqual(await binaryArchitectures(archive), ["x86_64"]);
assert.ok((await Bun.file(`${archive}.sig`).text()).trim(), "Tauri must sign the update artifact");

const staging = await mkdtemp(join(tmpdir(), "couch-appimage-"));
try {
  const extraction = Bun.spawnSync([archive.startsWith("/") ? archive : join(process.cwd(), archive), "--appimage-extract"], { cwd: staging, stdout: "ignore", stderr: "inherit" });
  assert.equal(extraction.exitCode, 0, "Extract the AppImage without a FUSE mount");
  const root = join(staging, "squashfs-root");
  const files: { path: string; size: number; sha256: string }[] = [];
  const links: { path: string; target: string }[] = [];
  const libraries: { path: string; sha256: string; architecture: string }[] = [];
  async function inspect(directory: string) {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry);
      const name = relative(root, path).split(sep).join("/");
      assert.ok(!/(^|\/)(\.git|\.env(?:\..*)?|Cookies|Login Data|History)$|\.(sqlite3?|db|map)$/.test(name), `Private runtime material: ${name}`);
      const info = await lstat(path);
      if (info.isDirectory()) await inspect(path);
      else if (info.isSymbolicLink()) {
        const resolved = await realpath(path);
        assert.ok(resolved.startsWith(root + sep), `AppImage link leaves its own filesystem: ${name}`);
        links.push({ path: name, target: await readlink(path) });
      } else {
        assert.ok(info.isFile(), `Unexpected AppImage entry: ${name}`);
        const sha256 = await hash(path);
        files.push({ path: name, size: info.size, sha256 });
      }
      if (isNativeLibrary(name)) {
        const resolved = await realpath(path);
        assert.deepEqual(await binaryArchitectures(resolved), ["x86_64"], `Wrong library architecture: ${name}`);
        libraries.push({ path: name, sha256: await hash(resolved), architecture: "x86_64" });
      }
    }
  }
  await inspect(root);
  const paths = [...files, ...links];
  for (const name of ["AppRun", "usr/bin/couch", "usr/bin/couch-server", "usr/share/applications/Couch.desktop", "usr/share/doc/couch/NOTICE", "usr/share/doc/couch/native.txt", "usr/lib/Couch/release.json", "usr/lib/Couch/payload.json"]) {
    assert.ok(paths.some(file => file.path === name), `Missing AppImage entry: ${name}`);
  }
  for (const name of ["usr/sbin/couch-setup", "usr/lib/couch/package-update", "usr/lib/systemd/user/couch-tv.service"]) {
    assert.ok(!paths.some(file => file.path === name), `Debian TV component leaked into AppImage: ${name}`);
  }
  const release = await Bun.file(join(root, "usr/lib/Couch/release.json")).json();
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.revision, build.revision);
  assert.equal(release.version, build.version);
  assert.equal(release.target, build.target);
  assert.equal(release.packaged, true);
  assert.equal(release.dataFormat, build.dataFormat);
  assert.ok(release.readableDataFormats.includes(build.dataFormat), "The signed AppImage must read its current data format");
  assert.equal(release.packageFormat, "appimage");
  assert.equal(release.host.target, build.target);
  assert.equal(release.host.os, "linux");
  assert.deepEqual(release.host.packages, []);
  const inventory = await Bun.file(join(root, "usr/lib/Couch/payload.json")).text();
  assert.equal(new Bun.CryptoHasher("sha256").update(inventory).digest("hex"), release.payloadSha256);
  await verifyPayload(root, JSON.parse(inventory), build.target, "appimage", ["yt-dlp", "deno", "ffprobe"], []);
  await verifyPackageHelpers(join(root, "usr/lib/Couch/tools"), build.helpers);
  assert.ok(libraries.some(file => file.path.endsWith("/libmpv.so.2")), "Bundle the linked player library");
  for (const list of [files, links, libraries]) list.sort((a, b) => a.path.localeCompare(b.path));
  await Bun.write(".artifacts/appimage-inventory.json", JSON.stringify({ build, release, files, links, libraries, sha256: await hash(archive) }, null, 2) + "\n");
  console.log(`Verified ${archive}: ${files.length} files, ${libraries.length} native library paths and packaged helpers`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
