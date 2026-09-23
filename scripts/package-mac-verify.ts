import { strict as assert } from "node:assert";
import { lstat, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import tauri from "../src-tauri/tauri.conf.json";
import { binaryArchitectures, verifyBundledNativeLibraries, verifyPayload } from "./desktop-payload";

function run(command: string[]) {
  const result = Bun.spawnSync(command);
  assert.equal(result.exitCode, 0, `${command.join(" ")}\n${result.stderr.toString()}`);
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
assert.equal(build.clientOnly, false);
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
const isolatedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("DYLD_")));
isolatedEnvironment.PATH = "/usr/bin:/bin";
function runIsolated(command: string[]) {
  const result = Bun.spawnSync(command, { cwd: staging, env: isolatedEnvironment });
  assert.equal(result.exitCode, 0, `${command[0]} cannot run without developer paths: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
let attached = false;
let failure: unknown;
try {
  const config = await Bun.file(".artifacts/tauri-mac.conf.json").json();
  await Bun.write(join(staging, "updater.pub"), Buffer.from(config.plugins.updater.pubkey, "base64"));
  await Bun.write(join(staging, "updater.sig"), Buffer.from((await Bun.file(signature).text()).trim(), "base64"));
  run(["minisign", "-Vm", archive, "-p", join(staging, "updater.pub"), "-x", join(staging, "updater.sig")]);
  run(["hdiutil", "attach", "-quiet", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  attached = true;
  const app = join(mount, "Couch.app");
  run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app]);
  assert.deepEqual(JSON.parse(runIsolated([join(app, "Contents/MacOS/couch"), "--version"])), build, "Bundled native app has a different build identity");
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
    assert.equal(release.clientOnly, false);
    assert.equal(release.dataFormat, build.dataFormat);
    assert.ok(release.readableDataFormats.includes(build.dataFormat));
    assert.equal(release.packageFormat, "dmg");
    assert.equal(release.host.target, build.target);
    const inventory = await Bun.file(join(root, "Contents/Resources/payload.json")).text();
    assert.equal(new Bun.CryptoHasher("sha256").update(inventory).digest("hex"), release.payloadSha256);
    const payload = JSON.parse(inventory);
    await verifyPayload(root, payload, build.target, "dmg", ["yt-dlp", "deno", "ffprobe"], []);
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
    files.sort();
    verifyBundledNativeLibraries(payload, files);
    assert.ok(run(["otool", "-l", join(root, "Contents/MacOS/couch")]).includes("path @executable_path/../Frameworks"), "The app cannot resolve bundled libmpv");
    for (const path of ["Contents/MacOS/couch", "Contents/MacOS/couch-server", ...["mpv", "yt-dlp", "deno", "ffprobe"].map(name => `Contents/Resources/tools/${name}`), ...payload.native.bundledLibraries]) {
      const executable = join(root, path);
      assert.ok((await binaryArchitectures(executable)).includes("aarch64"), `Wrong Mac architecture: ${path}`);
      assert.match(codeSignature(executable), /Signature=adhoc/, `Unsigned nested code: ${path}`);
      run(["codesign", "--verify", "--strict", executable]);
      for (const dependency of run(["otool", "-L", executable]).split("\n").filter(line => line.startsWith("\t")).map(line => line.trim().split(" ")[0])) {
        if (dependency.startsWith("/usr/lib/") || dependency.startsWith("/System/Library/")) continue;
        const bundled = dependency.startsWith("@rpath/") ? join(root, "Contents/Frameworks", dependency.slice(7))
          : dependency.startsWith("@loader_path/") ? resolve(dirname(executable), dependency.slice(13))
          : dependency.startsWith("@executable_path/") ? resolve(dirname(executable), dependency.slice(17)) : "";
        assert.ok(bundled.startsWith(`${root}/`) && await Bun.file(bundled).exists(), `Unbundled native dependency: ${path} -> ${dependency}`);
      }
    }
    assert.ok(payload.native.bundledLibraries.includes("Contents/Frameworks/libmpv.2.dylib"));
    const info = await Bun.file(join(root, "Contents/Resources/mac-native.json")).json();
    assert.equal(info.libraries.length, payload.native.bundledLibraries.length);
    const inputs = await Bun.file(join(root, "Contents/Resources/build-inputs.json")).json();
    assert.equal(inputs.macNativeSha256, await hash(join(root, "Contents/Resources/mac-native.json")));
    const sources = await Bun.file(join(root, "Contents/Resources/notices/macos-native/sources.json")).json();
    assert.deepEqual(sources, info.formulas);
    for (const formula of info.formulas) assert.ok(files.some(path => path.startsWith(`Contents/Resources/notices/macos-native/${formula.name}/`)), `Missing native license: ${formula.name}`);
    assert.ok(runIsolated([join(root, "Contents/Resources/tools/mpv"), "--no-config", "--version"]), "mpv cannot run from the mounted bundle");
    for (const name of ["yt-dlp", "deno", "ffprobe"]) assert.ok(runIsolated([join(root, "Contents/Resources/tools", name), ...(name === "ffprobe" ? ["-version"] : ["--version"])]), `${name} cannot run from the mounted bundle`);
    const hashes: { path: string; sha256: string }[] = [];
    for (const path of files) hashes.push({ path, sha256: await hash(join(root, path)) });
    return { files: hashes, release };
  }
  const mounted = await inspect(app);
  const extracted = join(staging, "updater");
  await mkdir(extracted);
  run(["tar", "-xzf", archive, "-C", extracted]);
  assert.deepEqual(await readdir(extracted), ["Couch.app"], "Updater archive contains unexpected top-level files");
  const updateApp = join(extracted, "Couch.app");
  run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", updateApp]);
  assert.match(codeSignature(updateApp), /Signature=adhoc/);
  assert.match(codeSignature(join(updateApp, "Contents/MacOS/couch-server")), /Signature=adhoc/);
  const update = await inspect(updateApp);
  assert.deepEqual(update.release, mounted.release, "DMG and updater archive carry different builds");
  assert.deepEqual(update.files, mounted.files, "DMG and updater archive contain different app bytes");
  await Bun.write(".artifacts/mac-inventory.json", JSON.stringify({ build, os: run(["sw_vers", "-productVersion"]), osBuild: run(["sw_vers", "-buildVersion"]), dmg: { path: dmg, sha256: await hash(dmg), bytes: Bun.file(dmg).size }, updater: { path: archive, sha256: await hash(archive), bytes: Bun.file(archive).size, signature: (await Bun.file(signature).text()).trim() }, files: mounted.files.length }, null, 2) + "\n");
  console.log(`Verified ${dmg}: ${mounted.files.length} matching app files, Apple Silicon closure, ad-hoc signatures and signed updater archive`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  const detach = attached ? Bun.spawnSync(["hdiutil", "detach", "-force", "-quiet", mount]) : null;
  if (!detach || detach.exitCode === 0) await rm(staging, { recursive: true, force: true });
  else if (!failure) throw new Error(`Cannot detach verified DMG: ${detach.stderr.toString()}`);
}
