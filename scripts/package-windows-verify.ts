import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { binaryArchitectures, verifyBundledNativeLibraries, verifyPayload } from "./desktop-payload";
import { publicKey } from "./hosted-policy";
import tauri from "../src-tauri/tauri.conf.json";

const target = "x86_64-pc-windows-msvc";
const directory = `src-tauri/target/${target}/release/bundle/nsis`;
const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
// Reviewed Windows 11 system imports. Fail when a new toolchain/runtime DLL
// appears until it is bundled or added here with a reason.
const systemDlls = new Set([
  "advapi32.dll", "api-ms-win-core-synch-l1-2-0.dll", "api-ms-win-crt-convert-l1-1-0.dll",
  "api-ms-win-crt-heap-l1-1-0.dll", "api-ms-win-crt-locale-l1-1-0.dll", "api-ms-win-crt-math-l1-1-0.dll",
  "api-ms-win-crt-runtime-l1-1-0.dll", "api-ms-win-crt-stdio-l1-1-0.dll", "api-ms-win-crt-string-l1-1-0.dll",
  "api-ms-win-core-path-l1-1-0.dll", "api-ms-win-core-winrt-error-l1-1-1.dll", "api-ms-win-core-winrt-l1-1-0.dll",
  "api-ms-win-crt-environment-l1-1-0.dll", "api-ms-win-crt-filesystem-l1-1-0.dll", "api-ms-win-crt-multibyte-l1-1-0.dll",
  "api-ms-win-crt-private-l1-1-0.dll", "api-ms-win-crt-time-l1-1-0.dll", "api-ms-win-crt-utility-l1-1-0.dll",
  "avicap32.dll", "avrt.dll", "bcrypt.dll", "bcryptprimitives.dll", "bluetoothapis.dll", "bthprops.cpl", "combase.dll", "comctl32.dll",
  "crypt32.dll", "d2d1.dll", "dbghelp.dll", "dwmapi.dll", "dwrite.dll", "gdi32.dll", "imm32.dll",
  "iphlpapi.dll", "kernel32.dll", "msvcrt.dll", "ncrypt.dll", "normaliz.dll", "ntdll.dll", "ole32.dll",
  "oleaut32.dll", "opengl32.dll", "propsys.dll", "psapi.dll", "rstrtmgr.dll", "secur32.dll", "setupapi.dll",
  "shcore.dll", "shell32.dll", "shlwapi.dll", "user32.dll", "userenv.dll", "uxtheme.dll",
  "version.dll", "winmm.dll", "wldap32.dll", "ws2_32.dll", "wsock32.dll",
  // The qualified target's graphics driver supplies this loader; libmpv imports it even with D3D11 selected.
  "vulkan-1.dll",
]);

function run(command: string[], env = process.env) {
  const result = Bun.spawnSync(command, { stderr: "inherit", maxBuffer: 256 * 1024 * 1024, env });
  assert.equal(result.exitCode, 0, command.join(" "));
  return result.stdout;
}

function peImports(path: string) {
  const output = run(["llvm-readobj", "--coff-imports", path]).toString();
  const names = [...output.matchAll(/^  Name: (.+)$/gm)].map(match => match[1]!.toLowerCase());
  assert.ok(names.length, `No PE imports found: ${path}`);
  for (const name of names) assert.ok(name === "bthprops.cpl" || /^[a-z0-9_.+-]+\.dll$/.test(name), `Invalid PE import: ${name}`);
  return [...new Set(names)].sort();
}

const config = await Bun.file(".artifacts/tauri-windows.conf.json").json();
assert.equal(tauri.identifier, "quest.avoid.couch");
assert.deepEqual(config.bundle.targets, ["nsis"]);
assert.equal(config.bundle.windows.nsis.installMode, "currentUser");
assert.equal(config.bundle.windows.webviewInstallMode.type, "downloadBootstrapper");
assert.equal(config.bundle.createUpdaterArtifacts, "v1Compatible");
assert.equal(config.plugins.updater.windows.installMode, "passive");
assert.deepEqual(config.plugins.updater.endpoints, ["https://cdn.crabnebula.app/update/avoid-quest/couch/windows-x86_64-nsis/{{current_version}}"]);
const publicKeyText = Buffer.from(publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), "base64").toString("utf8");
assert.equal(config.plugins.updater.pubkey, process.env.COUCH_UPDATER_PUBLIC_KEY?.trim());

const names = await readdir(directory);
const installers = names.filter(name => name.endsWith("-setup.exe"));
const archives = names.filter(name => name.endsWith(".nsis.zip"));
assert.equal(installers.length, 1, "Build exactly one NSIS installer");
assert.equal(archives.length, 1, "Tauri must generate one NSIS updater ZIP");
const installer = join(directory, installers[0]!);
const archive = join(directory, archives[0]!);
assert.deepEqual(await binaryArchitectures(installer), ["i686"], "NSIS uses its standard 32-bit installer stub");
const releaseSource = "src-tauri/resources/release.json";
const release = await Bun.file(releaseSource).json();
const build = await Bun.file("src-tauri/build-info.json").json();
assert.equal(build.clientOnly, false);
assert.equal(release.version, tauri.version);
assert.equal(release.revision, build.revision);
assert.equal(release.revision, run(["git", "rev-parse", "HEAD"]).toString().trim());
assert.match(release.revision, /^[a-f0-9]{40}$/);
assert.equal(release.dirty, false);
assert.equal(release.target, target);
assert.equal(release.packageFormat, "nsis");
assert.equal(release.schemaVersion, 1);
assert.equal(release.dataFormat, 1);
assert.deepEqual(release.readableDataFormats, [1]);
assert.equal(release.packaged, true);
assert.equal(release.clientOnly, false);
assert.deepEqual(release.host, { target, os: "windows", architecture: "x64", packages: [] });
assert.deepEqual(Object.keys(release.helpers).sort(), ["deno", "ffmpeg", "ffprobe", "yt-dlp"]);

// Tauri's compatible ZIP carries the installer. Add Couch's signed manifest so
// the desktop updater can check target and data format before replacement.
await rm(archive);
run(["zip", "-q", "-j", archive, installer, releaseSource]);
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY ?? "";
const signingEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: existsSync(privateKey) ? await Bun.file(privateKey).text() : privateKey };
for (const file of [installer, archive]) run([process.execPath, Bun.resolveSync("@tauri-apps/cli/tauri.js", import.meta.dir), "signer", "sign", file], signingEnv);

const scratch = await mkdtemp(join(tmpdir(), "couch-nsis-"));
try {
  const entries = run(["unzip", "-Z1", archive]).toString().trim().split("\n").sort();
  assert.deepEqual(entries, [basename(installer), "release.json"].sort());
  assert.equal(new Bun.CryptoHasher("sha256").update(run(["unzip", "-p", archive, basename(installer)])).digest("hex"), await hash(installer));
  assert.equal(run(["unzip", "-p", archive, "release.json"]).toString(), await Bun.file(releaseSource).text());
  await Bun.write(join(scratch, "updater.pub"), publicKeyText);
  for (const file of [installer, archive]) {
    await Bun.write(join(scratch, "updater.sig"), Buffer.from((await Bun.file(`${file}.sig`).text()).trim(), "base64"));
    run(["minisign", "-V", "-q", "-p", join(scratch, "updater.pub"), "-m", file, "-x", join(scratch, "updater.sig")]);
  }

  const installed = join(scratch, "installed");
  run(["7zz", "x", "-y", `-o${installed}`, installer]);
  const files: string[] = [];
  async function inspect(folder: string) {
    for (const name of await readdir(folder)) {
      const path = join(folder, name);
      const info = await stat(path);
      if (info.isDirectory()) await inspect(path);
      else if (info.isFile()) files.push(relative(installed, path).replaceAll("\\", "/"));
    }
  }
  await inspect(installed);
  assert.ok(files.includes("couch.exe"), "Missing native application");
  assert.deepEqual(await binaryArchitectures(join(installed, "couch.exe")), ["x86_64"]);
  assert.ok(files.includes("couch-server.exe"), "Missing Bun coordinator");
  // NSIS extracts its own plugins only while installing; they are not app DLLs.
  const bundledDlls = files.filter(file => file.toLowerCase().endsWith(".dll") && !file.startsWith("$PLUGINSDIR/"));
  for (const file of bundledDlls) assert.ok(!systemDlls.has(basename(file).toLowerCase()), `Bundled DLL shadows Windows: ${file}`);
  const imports = Object.fromEntries<string[]>(["couch.exe", "couch-server.exe", "tools/yt-dlp.exe", "tools/deno.exe", "tools/ffmpeg.exe", "tools/ffprobe.exe", ...bundledDlls].map(file => [file, peImports(join(installed, file))]));
  for (const [file, names] of Object.entries(imports)) {
    const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    const available = new Set([...systemDlls, ...bundledDlls.filter(dll => dll.startsWith(folder) && !dll.slice(folder.length).includes("/")).map(dll => basename(dll).toLowerCase())]);
    assert.deepEqual(names.filter(name => !available.has(name)), [], `Unresolved PE imports in ${file}`);
  }
  const appBytes = Buffer.from(await Bun.file(join(installed, "couch.exe")).arrayBuffer());
  assert.ok(appBytes.includes(Buffer.from(tauri.identifier)), "Bundled app identifier changed");
  assert.ok(appBytes.includes(Buffer.from('"clientOnly":false')), "Native app must embed the Full build identity");
  for (const file of ["couch.exe", "couch-server.exe"]) assert.ok(Buffer.from(await Bun.file(join(installed, file)).arrayBuffer()).includes(Buffer.from(release.revision)), `Bundled ${file} build revision changed`);
  assert.ok(!files.some(file => /(^|\/)(\.git|\.env(?:\..*)?|Cookies|Login Data|History)$|\.(sqlite3?|db|map)$/.test(file)), "Private runtime material in installer");
  const installedRelease = await Bun.file(join(installed, "release.json")).json();
  assert.deepEqual(installedRelease, release);
  const inventory = await Bun.file(join(installed, "payload.json")).text();
  assert.equal(new Bun.CryptoHasher("sha256").update(inventory).digest("hex"), release.payloadSha256);
  const payload = JSON.parse(inventory);
  await verifyPayload(installed, payload, target, "nsis");
  verifyBundledNativeLibraries(payload, files.filter(file => !file.startsWith("$PLUGINSDIR/")));
  await Bun.write(".artifacts/windows-inventory.json", JSON.stringify({ revision: release.revision, version: release.version, clientOnly: release.clientOnly, identifier: tauri.identifier, target, installMode: config.bundle.windows.nsis.installMode, webviewInstallMode: config.bundle.windows.webviewInstallMode.type, feed: config.plugins.updater.endpoints[0], installer: { name: basename(installer), bytes: (await stat(installer)).size, sha256: await hash(installer) }, update: { name: basename(archive), bytes: (await stat(archive)).size, sha256: await hash(archive) }, imports, files: files.sort() }, null, 2) + "\n");
  console.log(`Verified ${installer}: ${files.length} files, x64 identity, payload and signed update`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
