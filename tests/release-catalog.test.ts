import { afterEach, expect, spyOn, test } from "bun:test";
import { currentCatalog } from "../apps/web/src/release-catalog";
import fallback from "../apps/web/src/releases.json";

afterEach(() => { spyOn(globalThis, "fetch").mockRestore(); });

const release = (version: string, prerelease: boolean, names: string[]) => ({
  tag_name: `v${version}`, prerelease,
  assets: names.map(name => ({ name, browser_download_url: `https://github.com/avoid-quest/couch/releases/download/v${version}/${name}` })),
});

test("each channel resolves its own Mac architectures without confusing updater zips or Windows x64", async () => {
  const stable = release("1.0.0", false, ["Couch-1.0.0-arm64.dmg", "Couch-1.0.0-x64.dmg", "Couch-1.0.0-x64.zip", "Couch-1.0.0-x64.exe"]);
  const preview = release("1.1.0-preview.1", true, ["Couch-1.1.0-preview.1-arm64.dmg"]);
  spyOn(globalThis, "fetch").mockImplementation(async input => Response.json(String(input).endsWith("/latest") ? stable : [preview, stable]));
  const catalog = await currentCatalog();
  expect(catalog.stable.dmg?.filename).toBe("Couch-1.0.0-arm64.dmg");
  expect(catalog.stable["dmg-intel"]?.filename).toBe("Couch-1.0.0-x64.dmg");
  expect(catalog.stable.nsis?.filename).toBe("Couch-1.0.0-x64.exe");
  expect(catalog.preview.dmg?.version).toBe("1.1.0-preview.1");
  expect(catalog.preview["dmg-intel"]).toBeUndefined();
});

test("a preview-only release offers both Macs without inventing a stable release", async () => {
  const preview = release("1.0.0-preview.1", true, ["Couch-1.0.0-preview.1-x64.dmg", "Couch-1.0.0-preview.1-arm64.dmg"]);
  spyOn(globalThis, "fetch").mockImplementation(async input => String(input).endsWith("/latest") ? new Response(null, { status: 404 }) : Response.json([preview]));
  const catalog = await currentCatalog();
  expect(catalog.stable).toEqual({});
  expect(catalog.preview["dmg-intel"]?.version).toBe("1.0.0-preview.1");
  expect(catalog.preview.dmg?.version).toBe("1.0.0-preview.1");
});

test("GitHub failure retains the published fallback instead of constructing Intel download URLs", async () => {
  spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
  expect(await currentCatalog()).toEqual(fallback);
});
