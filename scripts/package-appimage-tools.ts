import { strict as assert } from "node:assert";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import inputs from "../packaging/inputs.json";

const [directory, mode] = process.argv.slice(2);
assert.ok(directory && (!mode || mode === "--check"), "Supply Tauri's tool cache directory and optionally --check");
const tools = { ...inputs.appimageTools, "runtime-x86_64": inputs.appimageRuntime };
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
await mkdir(directory, { recursive: true });
for (const [name, input] of Object.entries(tools)) {
  const path = join(directory, name);
  if (await Bun.file(path).exists() && sha256(new Uint8Array(await Bun.file(path).arrayBuffer())) === input.sha256) continue;
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
console.log(`Verified ${Object.keys(tools).length} pinned AppImage build tools`);
