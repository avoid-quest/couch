import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")("AppImage ELF inventory", () => {
  let directory: string;
  const script = join(import.meta.dir, "package-inventory.ts");
  const binaries = new Map<string, Uint8Array>();
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "couch-inventory-"));
    const source = join(directory, "fixture.c");
    await Bun.write(source, "int main(void) { return 0; }\n");
    for (const [name, flags] of [["dynamic", []], ["static", ["-static"]], ["static-pie", ["-static-pie"]], ["shared", ["-shared", "-nostdlib"]]] as const) {
      const path = join(directory, name);
      const result = Bun.spawnSync(["cc", ...flags, source, "-o", path]);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      binaries.set(name, new Uint8Array(await Bun.file(path).arrayBuffer()));
    }
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  async function fixture(bytes: Uint8Array) {
    const root = await mkdtemp(join(directory, "app-"));
    for (const path of ["usr/bin/couch-server", "usr/lib/Couch/tools/ffprobe", "usr/lib/libmpv.so.2", "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess", "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess"]) await Bun.write(join(root, "AppDir", path), "fixture");
    await Bun.write(join(root, "AppDir/usr/bin/couch"), bytes);
    await chmod(join(root, "AppDir/usr/bin/couch"), 0o755);
    await Bun.write(join(root, "src-tauri/build-info.json"), "{}");
    await Bun.write(join(root, "src-tauri/resources/build-inputs.json"), "{}");
    return root;
  }
  function inventory(root: string, path = process.env.PATH) {
    return Bun.spawnSync([process.execPath, script, join(root, "AppDir"), join(root, "inventory.json")], { cwd: root, env: { ...process.env, PATH: path } });
  }
  async function override(root: string, command: string, body: string) {
    const path = join(root, "commands", command);
    await Bun.write(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return `${join(root, "commands")}:${process.env.PATH}`;
  }
  async function rejects(root: string, message: string, path?: string) {
    const result = inventory(root, path);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(message);
    expect(await Bun.file(join(root, "inventory.json")).exists()).toBe(false);
  }

  for (const name of ["dynamic", "static", "static-pie", "shared"]) test(`inventories a valid ${name} ELF`, async () => {
    const root = await fixture(binaries.get(name)!);
    const result = inventory(root);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const { linkage } = await Bun.file(join(root, "inventory.json")).json();
    expect(linkage).toHaveLength(1);
    if (name === "dynamic") expect(linkage[0].libraries.length).toBeGreaterThan(0);
    else expect(linkage[0].libraries).toEqual([]);
  });

  test("rejects ELF magic without a valid header", async () => {
    await rejects(await fixture(new Uint8Array([127, 69, 76, 70])), "readelf failed");
  });
  test("rejects a truncated static executable", async () => {
    await rejects(await fixture(binaries.get("static")!.slice(0, 100)), "readelf failed");
  });
  test("rejects an incompatible ELF machine", async () => {
    const bytes = binaries.get("static")!.slice();
    new DataView(bytes.buffer).setUint16(18, 183, true); // EM_AARCH64
    await rejects(await fixture(bytes), "Cannot confirm dependency-free ELF");
  });
  test("rejects an ldd failure for a dynamic executable", async () => {
    const root = await fixture(binaries.get("dynamic")!);
    await rejects(root, "Cannot confirm dependency-free ELF", await override(root, "ldd", "echo 'not a dynamic executable' >&2\nexit 1"));
  });
  test("rejects unexpected ldd failures even for a static executable", async () => {
    const root = await fixture(binaries.get("static")!);
    await rejects(root, "ldd failed", await override(root, "ldd", "echo 'inspection failed' >&2\nexit 2"));
  });
  test("rejects successful ldd calls without dependency information", async () => {
    const root = await fixture(binaries.get("dynamic")!);
    await rejects(root, "No dependency information", await override(root, "ldd", "exit 0"));
  });
  test("rejects a failed static inspection", async () => {
    const root = await fixture(binaries.get("static")!);
    await rejects(root, "readelf failed", await override(root, "readelf", "echo 'inspection failed' >&2\nexit 1"));
  });
  test("rejects unresolved dependencies", async () => {
    const root = await fixture(binaries.get("dynamic")!);
    const result = Bun.spawnSync(["patchelf", "--add-needed", "libcouch-missing-fixture.so", join(root, "AppDir/usr/bin/couch")]);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    await rejects(root, "Unresolved dependency");
  });
});
