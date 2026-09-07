import { strict as assert } from "node:assert";
import { join } from "node:path";

export async function verifyPackageHelpers(directory: string, helpers: Record<string, { sha256: string }>) {
  for (const name of ["yt-dlp", "deno"]) {
    const bytes = await Bun.file(join(directory, name)).arrayBuffer();
    assert.equal(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), helpers[name]?.sha256, `${name} must retain the release helper hash after AppImage bundling`);
  }
}

if (import.meta.main) await verifyPackageHelpers("src-tauri/target/release/bundle/appimage/Couch.AppDir/usr/lib/Couch/tools", (await Bun.file("src-tauri/build-info.json").json()).helpers);
