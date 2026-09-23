import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binaryArchitectures, createPayload, desktopTarget, isNativeLibrary, payloadPaths, verifyBundledNativeLibraries, verifyPayload } from "./desktop-payload";

function executable(target: string) {
  const bytes = Buffer.alloc(128);
  const machine = target.startsWith("aarch64") ? 0xaa64 : 0x8664;
  if (target.includes("linux")) {
    bytes.write("\x7fELF", 0, "binary");
    bytes[5] = 1;
    bytes.writeUInt16LE(machine === 0xaa64 ? 0xb7 : 0x3e, 18);
  } else if (target.includes("apple")) {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(machine === 0xaa64 ? 0x0100000c : 0x01000007, 4);
  } else {
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 0x3c);
    bytes.write("PE\0\0", 64);
    bytes.writeUInt16LE(machine, 68);
  }
  return bytes;
}

for (const [target, format] of [
  ["x86_64-unknown-linux-gnu", "deb"],
  ["aarch64-apple-darwin", "dmg"],
  ["x86_64-pc-windows-msvc", "nsis"],
] as const) test(`${format} payload checks installed paths, required files and architecture`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-payload-"));
  const resources = join(directory, "staged"), paths = payloadPaths(target, format);
  const suffix = format === "nsis" ? ".exe" : "";
  const sidecar = join(directory, `couch-server${suffix}`);
  async function write(path: string, bytes: string | Uint8Array) {
    await mkdir(join(path, ".."), { recursive: true });
    await Bun.write(path, bytes);
  }
  try {
    await write(sidecar, executable(target));
    await chmod(sidecar, 0o755);
    const helpers: Record<string, { sha256: string }> = {};
    for (const name of ["yt-dlp", "deno", "ffprobe"]) {
      const binary = executable(target);
      await write(join(resources, "tools", name + suffix), binary);
      await chmod(join(resources, "tools", name + suffix), 0o755);
      helpers[name] = { sha256: new Bun.CryptoHasher("sha256").update(binary).digest("hex") };
    }
    await write(join(resources, "tools.json"), JSON.stringify(helpers));
    for (const name of ["build-inputs.json", "build-packages.tsv"]) await write(join(resources, name), "{}\n");
    await write(join(resources, "notices", "NOTICE"), "Couch notices\n");
    const hostPackages = format === "deb" ? ["libmpv2"] : [];
    const payload = await createPayload(target, format, sidecar, resources, ["yt-dlp", "deno", "ffprobe"], hostPackages);
    expect(payload.native).toEqual({ bundledLibraries: [], declaredHostPackages: hostPackages });
    if (format === "deb") expect(() => verifyBundledNativeLibraries(payload, payload.files.map(file => file.path).concat("usr/lib/Couch/libmpv.so.2"))).toThrow("Bundled native libraries differ");
    if (format === "nsis") expect(payload.files.map(file => file.path)).toEqual(expect.arrayContaining([
      "couch-server.exe", "tools/deno.exe", "tools.json", "build-inputs.json", "notices/NOTICE",
    ]));
    if (format === "nsis") expect(payload.files.some(file => file.path.startsWith("resources/"))).toBe(false);
    const installed = join(directory, "installed");
    const verify = (candidate = payload) => verifyPayload(installed, candidate, target, format, ["yt-dlp", "deno", "ffprobe"], hostPackages);
    for (const file of payload.files) {
      const source = file.path === paths.sidecar ? sidecar : file.path.includes("tools/") ? join(resources, "tools", file.path.split("/").at(-1)!) : file.path.endsWith("/NOTICE") ? join(resources, "notices", "NOTICE") : join(resources, file.path.split("/").at(-1)!);
      const path = join(installed, file.path);
      await write(path, new Uint8Array(await Bun.file(source).arrayBuffer()));
      if (file.architecture) await chmod(path, 0o755);
    }
    await verify();
    if (format === "deb") await expect(verifyPayload(installed, payload, target, format)).rejects.toThrow();
    const missingArch = structuredClone(payload);
    delete missingArch.files.find(file => file.path === paths.sidecar)!.architecture;
    await expect(verify(missingArch)).rejects.toThrow("Missing architecture");
    await rm(join(installed, paths.sidecar));
    await expect(verify()).rejects.toThrow();
    await write(join(installed, paths.sidecar), executable(target));
    await chmod(join(installed, paths.sidecar), 0o755);
    await rm(join(installed, paths.resources, "tools", `deno${suffix}`));
    await expect(verify()).rejects.toThrow();
    await write(join(installed, paths.resources, "tools", `deno${suffix}`), executable(target));
    await chmod(join(installed, paths.resources, "tools", `deno${suffix}`), 0o755);
    const wrong = target.startsWith("aarch64") ? target.replace("aarch64", "x86_64") : target.replace("x86_64", "aarch64");
    await write(sidecar, executable(wrong));
    await expect(createPayload(target, format, sidecar, resources)).rejects.toThrow("Wrong architecture");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("build target selection includes Windows and rejects unsupported targets", () => {
  expect(desktopTarget("win32", "x64")).toBe("x86_64-pc-windows-msvc");
  expect(() => desktopTarget("win32", "arm64")).toThrow("Unsupported desktop build target");
});

test("native library paths cover shared objects on each desktop target", () => {
  for (const path of ["usr/lib/Couch/libmpv.so.2", "Contents/Frameworks/libmpv.dylib", "libmpv.dll"]) expect(isNativeLibrary(path)).toBe(true);
  expect(isNativeLibrary("usr/bin/couch-server")).toBe(false);
});

test("32-bit NSIS stub is distinct from the required x64 application", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-nsis-stub-"));
  try {
    const path = join(directory, "setup.exe"), bytes = executable("x86_64-pc-windows-msvc");
    bytes.writeUInt16LE(0x014c, 68);
    await Bun.write(path, bytes);
    expect(await binaryArchitectures(path)).toEqual(["i686"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Client-only payload records the coordinator without claiming local media helpers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-client-payload-"));
  const target = "aarch64-apple-darwin", format = "dmg";
  try {
    const resources = join(directory, "staged"), installed = join(directory, "installed");
    await mkdir(join(resources, "notices"), { recursive: true });
    await Bun.write(join(resources, "build-inputs.json"), "{}\n");
    await Bun.write(join(resources, "notices", "NOTICE"), "Couch notices\n");
    const sidecar = join(directory, "couch-server");
    await Bun.write(sidecar, executable(target));
    await chmod(sidecar, 0o755);
    const payload = await createPayload(target, format, sidecar, resources, []);
    expect(payload.enabledHelpers).toEqual([]);
    expect(payload.files.map(file => file.path)).not.toContain("Contents/Resources/tools.json");
    for (const file of payload.files) {
      const source = file.path.endsWith("/couch-server") ? sidecar : file.path.endsWith("/NOTICE") ? join(resources, "notices", "NOTICE") : join(resources, "build-inputs.json");
      const path = join(installed, file.path);
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, Bun.file(source));
      if (file.architecture) await chmod(path, 0o755);
    }
    await verifyPayload(installed, payload, target, format, []);
    await expect(verifyPayload(installed, payload, target, format)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
