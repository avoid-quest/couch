import { strict as assert } from "node:assert";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import inputs from "../packaging/inputs.json";

const [directory, mode] = process.argv.slice(2);
assert.ok(directory && (!mode || mode === "--check"), "Supply Tauri's tool cache directory and optionally --check");
const tools = { ...inputs.appimageTools, "runtime-x86_64": inputs.appimageRuntime };
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
function matches(name: string, bytes: Uint8Array, expected: string) {
  if (sha256(bytes) === expected) return true;
  // Tauri clears the AppImage magic in its cached linuxdeploy copy to run it
  // through extraction. Restore only those three bytes to check its source pin.
  if (name !== "linuxdeploy-x86_64.AppImage" || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0) return false;
  const source = bytes.slice();
  source.set([0x41, 0x49, 0x02], 8);
  return sha256(source) === expected;
}
await mkdir(directory, { recursive: true });
for (const [name, input] of Object.entries(tools)) {
  const path = join(directory, name);
  if (await Bun.file(path).exists() && matches(name, new Uint8Array(await Bun.file(path).arrayBuffer()), input.sha256)) continue;
  assert.notEqual(mode, "--check", `Tauri changed pinned AppImage tool ${name}`);
  const response = await fetch(input.url, { headers: { Accept: "application/octet-stream" }, signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, `Cannot download pinned AppImage tool ${name}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(sha256(bytes), input.sha256, `Pinned AppImage tool changed: ${name}`);
  const temporary = `${path}.tmp`;
  try {
    await Bun.write(temporary, bytes);
    await chmod(temporary, 0o755);
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
// Tauri's optional external output plugin cannot execute under the amd64
// emulator. An inert cache entry keeps Tauri from downloading its moving build;
// linuxdeploy then uses the output plugin bundled in our pinned linuxdeploy.
const optional = join(directory, "linuxdeploy-plugin-appimage.AppImage");
if (mode === "--check") {
  assert.equal((await stat(optional)).size, 0);
  assert.equal((await stat(optional)).mode & 0o111, 0);
} else {
  await Bun.write(optional, "");
  await chmod(optional, 0o644);
}
console.log(`Verified ${Object.keys(tools).length} pinned AppImage build tools`);
