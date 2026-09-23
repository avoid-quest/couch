import { strict as assert } from "node:assert";
import { lstat, readdir, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

export const desktopTargets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
} as const;

export function desktopTarget(platform = process.platform, arch = process.arch) {
  const target = desktopTargets[`${platform}-${arch}` as keyof typeof desktopTargets];
  if (!target) throw new Error(`Unsupported desktop build target: ${platform}/${arch}`);
  return target;
}

export function payloadPaths(target: string, format: string) {
  if (target.endsWith("-apple-darwin") && format === "dmg") return { sidecar: "Contents/MacOS/couch-server", resources: "Contents/Resources" };
  if (target.endsWith("-pc-windows-msvc") && format === "nsis") return { sidecar: "couch-server.exe", resources: "" };
  if (target.endsWith("-unknown-linux-gnu") && ["deb", "appimage"].includes(format)) return { sidecar: "usr/bin/couch-server", resources: "usr/lib/Couch" };
  throw new Error(`Unsupported package target: ${target}/${format}`);
}

export type PayloadFile = { path: string; sha256: string; architecture?: string };
export type Payload = { target: string; format: string; enabledHelpers: string[]; native: { bundledLibraries: string[]; declaredHostPackages: string[] }; files: PayloadFile[] };
const helperNames = ["yt-dlp", "deno", "ffprobe"] as const;
export const isNativeLibrary = (path: string) => /\.(?:so(?:\.\d+)*|dylib|dll)$/i.test(path);
export function verifyBundledNativeLibraries(payload: Payload, packagePaths: string[]) {
  assert.deepEqual(packagePaths.filter(isNativeLibrary).sort(), payload.native.bundledLibraries, "Bundled native libraries differ from payload inventory");
}
const hash = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");

// Read the executable header, including universal Mach-O slices. A helper with
// an unrecognized format cannot silently satisfy a target's architecture check.
export async function binaryArchitectures(path: string): Promise<string[]> {
  const bytes = new Uint8Array(await Bun.file(path).slice(0, 4096).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (bytes.length < 64) return [];
  const magic = view.getUint32(0, false);
  if (magic === 0x7f454c46) return [{ 0x3e: "x86_64", 0xb7: "aarch64" }[view.getUint16(18, bytes[5] === 1)]].filter((value): value is string => !!value);
  if (magic === 0x4d5a9000 || (bytes[0] === 0x4d && bytes[1] === 0x5a)) {
    const offset = view.getUint32(0x3c, true);
    if (offset + 6 > bytes.length || view.getUint32(offset, true) !== 0x00004550) return [];
    return [{ 0x8664: "x86_64", 0xaa64: "aarch64" }[view.getUint16(offset + 4, true)]].filter((value): value is string => !!value);
  }
  const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
  if (little || magic === 0xfeedface || magic === 0xfeedfacf) return [{ 0x01000007: "x86_64", 0x0100000c: "aarch64" }[view.getUint32(4, little)]].filter((value): value is string => !!value);
  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    const swap = magic === 0xbebafeca;
    const count = view.getUint32(4, swap);
    if (count > 32 || 8 + count * 20 > bytes.length) return [];
    return Array.from({ length: count }, (_, index) => ({ 0x01000007: "x86_64", 0x0100000c: "aarch64" })[view.getUint32(8 + index * 20, swap)]).filter((value): value is string => !!value);
  }
  return [];
}

export async function createPayload(target: string, format: string, sidecar: string, resources: string, enabledHelpers: string[] = [...helperNames], declaredHostPackages: string[] = []): Promise<Payload> {
  const paths = payloadPaths(target, format);
  assert.ok(enabledHelpers.every(name => helperNames.includes(name as typeof helperNames[number])), "Unknown enabled helper");
  const files: PayloadFile[] = [];
  async function add(source: string, destination: string, executable = false) {
    const architecture = executable ? target.split("-")[0] : undefined;
    if (architecture) assert.ok((await binaryArchitectures(source)).includes(architecture), `Wrong architecture: ${source} must contain ${architecture}`);
    if (architecture && !target.includes("windows")) assert.ok((await stat(source)).mode & 0o111, `Not executable: ${source}`);
    files.push({ path: destination, sha256: await hash(source), ...(architecture ? { architecture } : {}) });
  }
  await add(sidecar, paths.sidecar, true);
  for (const name of enabledHelpers) await add(join(resources, "tools", name + (target.includes("windows") ? ".exe" : "")), posix.join(paths.resources, "tools", name + (target.includes("windows") ? ".exe" : "")), true);
  if (enabledHelpers.length) await add(join(resources, "tools.json"), posix.join(paths.resources, "tools.json"));
  await add(join(resources, "build-inputs.json"), posix.join(paths.resources, "build-inputs.json"));
  if (await Bun.file(join(resources, "build-packages.tsv")).exists()) await add(join(resources, "build-packages.tsv"), posix.join(paths.resources, "build-packages.tsv"));
  const notices = join(resources, "notices");
  async function walk(directory: string) {
    for (const name of await readdir(directory)) {
      const source = join(directory, name);
      if ((await stat(source)).isDirectory()) await walk(source);
      else {
        const name = relative(notices, source).split(sep).join("/");
        const destination = format === "deb" || format === "appimage" ? `usr/share/doc/couch/${name}` : posix.join(paths.resources, "notices", name);
        await add(source, destination);
      }
    }
  }
  await walk(notices);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { target, format, enabledHelpers, native: { bundledLibraries: files.filter(file => isNativeLibrary(file.path)).map(file => file.path), declaredHostPackages }, files };
}

export async function verifyPayload(root: string, payload: Payload, expectedTarget: string, expectedFormat: string, expectedHelpers: string[] = [...helperNames], expectedHostPackages: string[] = []) {
  assert.equal(payload.target, expectedTarget);
  assert.equal(payload.format, expectedFormat);
  assert.deepEqual(payload.enabledHelpers, expectedHelpers);
  assert.deepEqual(payload.native.declaredHostPackages, expectedHostPackages);
  assert.deepEqual(payload.native.bundledLibraries, payload.files.filter(file => isNativeLibrary(file.path)).map(file => file.path));
  const paths = payloadPaths(expectedTarget, expectedFormat);
  const binaries = [paths.sidecar, ...expectedHelpers.map(name => posix.join(paths.resources, "tools", name + (expectedTarget.includes("windows") ? ".exe" : "")))];
  const required = [...binaries, ...(expectedHelpers.length ? [posix.join(paths.resources, "tools.json")] : []), posix.join(paths.resources, "build-inputs.json"), ...(expectedFormat === "deb" ? [posix.join(paths.resources, "build-packages.tsv")] : [])];
  for (const path of required) assert.ok(payload.files.some(file => file.path === path), `Missing payload entry: ${path}`);
  assert.ok(payload.files.some(file => file.path.endsWith("notices/NOTICE") || file.path === "usr/share/doc/couch/NOTICE"), "Missing redistribution notice");
  const seen = new Set<string>();
  const architecture = expectedTarget.split("-")[0];
  for (const file of payload.files) {
    assert.ok(!file.path.startsWith("/") && !file.path.split("/").includes("..") && !seen.has(file.path), `Invalid payload path: ${file.path}`);
    seen.add(file.path);
    const source = join(root, file.path);
    const info = await lstat(source);
    assert.ok(info.isFile(), `Not a regular payload file: ${file.path}`);
    assert.equal(await hash(source), file.sha256, `Missing or changed payload file: ${file.path}`);
    if (binaries.includes(file.path) || isNativeLibrary(file.path)) assert.equal(file.architecture, architecture, `Missing architecture: ${file.path}`);
    if (binaries.includes(file.path) && !expectedTarget.includes("windows")) assert.ok(info.mode & 0o111, `Not executable: ${file.path}`);
    if (file.architecture) assert.ok((await binaryArchitectures(source)).includes(file.architecture), `Wrong architecture: ${file.path}`);
  }
  if (expectedHelpers.length) {
    const helpers = await Bun.file(join(root, paths.resources, "tools.json")).json();
    for (const name of expectedHelpers) {
      const path = posix.join(paths.resources, "tools", name + (expectedTarget.includes("windows") ? ".exe" : ""));
      assert.equal(payload.files.find(file => file.path === path)?.sha256, helpers[name]?.sha256, `Helper provenance mismatch: ${name}`);
    }
  }
}
