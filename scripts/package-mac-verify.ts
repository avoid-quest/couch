import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import tauri from "../src-tauri/tauri.conf.json";
import { binaryArchitectures, verifyBundledNativeLibraries, verifyPayload } from "./desktop-payload";

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit" });
  assert.equal(result.exitCode, 0, command.join(" "));
  return result.stdout.toString().trim();
}
function codeSignature(path: string) {
  const result = Bun.spawnSync(["codesign", "-dv", "--verbose=2", path]);
  assert.equal(result.exitCode, 0, `Cannot read code signature: ${path}`);
  return result.stderr.toString();
}
const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const build = await Bun.file("src-tauri/build-info.json").json();
assert.equal(build.target, "aarch64-apple-darwin");
assert.equal(build.packaged, true);
assert.equal(build.clientOnly, true);
assert.equal(build.dirty, false, "Package a clean committed revision");
assert.equal(tauri.app.windows.length, 1, "Expected one bundled Couch window");
assert.equal(tauri.app.windows[0]?.create, false);
assert.equal(tauri.app.windows[0]?.decorations, true);
const dmg = `src-tauri/target/release/bundle/dmg/Couch_${build.version}_aarch64.dmg`;
const archive = `src-tauri/target/release/bundle/macos/Couch.app.tar.gz`;
const signature = `${archive}.sig`;
assert.ok(await Bun.file(dmg).exists(), "Missing DMG");
assert.ok(await Bun.file(archive).exists(), "Missing Mac updater archive");
assert.ok(await Bun.file(signature).exists(), "Missing independent Tauri updater signature");

const staging = await mkdtemp(join(tmpdir(), "couch-mac-package-"));
const mount = join(staging, "mounted");
let attached = false;
try {
  const config = await Bun.file(".artifacts/tauri-mac.conf.json").json();
  await Bun.write(join(staging, "updater.pub"), Buffer.from(config.plugins.updater.pubkey, "base64"));
  await Bun.write(join(staging, "updater.sig"), Buffer.from((await Bun.file(signature).text()).trim(), "base64"));
  run(["minisign", "-Vm", archive, "-p", join(staging, "updater.pub"), "-x", join(staging, "updater.sig")]);
  run(["hdiutil", "attach", "-quiet", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  attached = true;
  const app = join(mount, "Couch.app");
  run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app]);
  assert.deepEqual(JSON.parse(run([join(app, "Contents/MacOS/couch"), "--version"])), build, "Bundled native app has a different build identity");
  assert.equal(run(["plutil", "-extract", "CFBundleIdentifier", "raw", "-o", "-", join(app, "Contents/Info.plist")]), "quest.avoid.couch");
  assert.equal(run(["plutil", "-extract", "LSMinimumSystemVersion", "raw", "-o", "-", join(app, "Contents/Info.plist")]), "26.0");
  assert.match(codeSignature(app), /Signature=adhoc/);
  assert.match(codeSignature(join(app, "Contents/MacOS/couch-server")), /Signature=adhoc/);

  async function inspect(root: string) {
    const release = await Bun.file(join(root, "Contents/Resources/release.json")).json();
    assert.equal(release.schemaVersion, 1);
    assert.equal(release.revision, build.revision);
    assert.equal(release.version, build.version);
    assert.equal(release.packaged, true);
    assert.equal(release.clientOnly, true);
    assert.equal(release.dataFormat, build.dataFormat);
    assert.ok(release.readableDataFormats.includes(build.dataFormat));
    assert.equal(release.packageFormat, "dmg");
    assert.equal(release.host.target, build.target);
    const inventory = await Bun.file(join(root, "Contents/Resources/payload.json")).text();
    assert.equal(new Bun.CryptoHasher("sha256").update(inventory).digest("hex"), release.payloadSha256);
    const payload = JSON.parse(inventory);
    await verifyPayload(root, payload, build.target, "dmg", [], []);
    const files: string[] = [];
    async function walk(directory: string) {
      for (const name of await readdir(directory)) {
        const path = join(directory, name), info = await lstat(path);
        if (info.isDirectory()) await walk(path);
        else {
          assert.ok(info.isFile(), `Unexpected app entry: ${path}`);
          files.push(relative(root, path).replaceAll("\\", "/"));
        }
      }
    }
    await walk(root);
    verifyBundledNativeLibraries(payload, files);
    for (const name of ["couch", "couch-server"]) {
      const executable = join(root, "Contents/MacOS", name);
      assert.deepEqual(await binaryArchitectures(executable), ["aarch64"]);
      const dependencies = run(["otool", "-L", executable]).split("\n").slice(1).map(line => line.trim().split(" ")[0]);
      assert.ok(dependencies.every(path => path.startsWith("/usr/lib/") || path.startsWith("/System/Library/")), `${name} links an unbundled native library: ${dependencies.join(", ")}`);
    }
    assert.ok(!files.some(path => /(^|\/)(?:libmpv|ffprobe|yt-dlp|deno)(?:\.|$)/i.test(path)), "Client-only bundle contains Full media components");
    return { files: files.length, release };
  }
  const mounted = await inspect(app);
  const extracted = join(staging, "updater");
  await mkdir(extracted);
  run(["tar", "-xzf", archive, "-C", extracted]);
  assert.deepEqual(await readdir(extracted), ["Couch.app"], "Updater archive contains unexpected top-level files");
  const update = await inspect(join(extracted, "Couch.app"));
  assert.deepEqual(update.release, mounted.release, "DMG and updater archive carry different builds");
  await Bun.write(".artifacts/mac-inventory.json", JSON.stringify({ build, os: run(["sw_vers", "-productVersion"]), osBuild: run(["sw_vers", "-buildVersion"]), dmg: { path: dmg, sha256: await hash(dmg), bytes: Bun.file(dmg).size }, updater: { path: archive, sha256: await hash(archive), bytes: Bun.file(archive).size, signature: (await Bun.file(signature).text()).trim() }, files: mounted.files }, null, 2) + "\n");
  console.log(`Verified ${dmg}: ${mounted.files} app files, Apple Silicon closure, ad-hoc signature and signed updater archive`);
} finally {
  if (attached) run(["hdiutil", "detach", "-quiet", mount]);
  await rm(staging, { recursive: true, force: true });
}
