import { strict as assert } from "node:assert";
import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const appdir = await realpath(resolve(process.argv[2] ?? "src-tauri/target/release/bundle/appimage/Couch.AppDir"));
const output = process.argv[3] ?? ".artifacts/appimage-inventory.json";
const sha256 = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
const files: { path: string; size?: number; sha256?: string; link?: string }[] = [];
const elf: string[] = [];
async function inventory(directory: string) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), info = await lstat(path);
    if (info.isSymbolicLink()) files.push({ path: relative(appdir, path), link: await readlink(path) });
    else if (info.isDirectory()) await inventory(path);
    else {
      files.push({ path: relative(appdir, path), size: info.size, sha256: await sha256(path) });
      if (Buffer.from(await Bun.file(path).slice(0, 4).arrayBuffer()).equals(Buffer.from([127, 69, 76, 70]))) elf.push(path);
    }
  }
}
await inventory(appdir);
for (const required of ["usr/bin/couch", "usr/bin/couch-server", "usr/lib/Couch/tools/ffprobe", "usr/lib/libmpv.so.2", "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess", "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess"]) assert.ok(files.some(file => file.path === required), `Missing ${required}`);
// ldd resolves the actual final library bytes. Device drivers and glibc stay with Debian.
const hostLibraries = /^(ld-linux-x86-64\.so\.2|lib(c|m|pthread|dl|rt|resolv|util)\.so\.[\d]+|lib(GL|EGL|GLX|GLdispatch|OpenGL|drm|gbm|vulkan).*\.so[.\d]*)$/;
const libraryPath = [join(appdir, "usr/lib"), join(appdir, "usr/lib/x86_64-linux-gnu")].join(":");
const linkage = [];
for (const path of elf) {
  const result = Bun.spawnSync(["ldd", path], { env: { ...process.env, LD_LIBRARY_PATH: libraryPath } });
  const lines = result.stdout.toString() + result.stderr.toString();
  assert.ok(!lines.includes("not found"), `Unresolved dependency in ${relative(appdir, path)}: ${lines}`);
  const libraries = [...lines.matchAll(/(?:=>\s+)?(\/[^\s]+)\s+\(/g)].map(match => match[1]!);
  for (const library of libraries) assert.ok(library.startsWith(appdir + "/") || hostLibraries.test(library.split("/").at(-1)!), `Unexpected host fallback: ${relative(appdir, path)} -> ${library}`);
  linkage.push({ path: relative(appdir, path), libraries: libraries.map(library => library.startsWith(appdir + "/") ? { owner: "Couch", path: relative(appdir, library) } : { owner: "Debian", path: library }) });
}
await Bun.write(output, JSON.stringify({ schemaVersion: 1, build: await Bun.file("src-tauri/build-info.json").json(), inputs: await Bun.file("src-tauri/resources/build-inputs.json").json(), dynamicComponents: ["libmpv.so.2", "WebKit processes and injected bundle", "GStreamer plugins and scanner", "GTK immodules and GdkPixbuf loaders", "NSS softoken", "ALSA plugins"], files, linkage }, null, 2) + "\n");
console.log(`Recorded ${files.length} files and ${elf.length} ELF dependency closures in ${output}`);
