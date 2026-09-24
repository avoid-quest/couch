import { expect, test } from "bun:test";
import { catalog, currentCatalog, formats } from "./release-catalog";

test("handles an empty release source without inventing downloads", () => {
  expect(catalog({ stable: {}, preview: {} })).toEqual({ stable: {}, preview: {} });
});

test("keeps the signed Preview receipt as the fallback for all four installers", () => {
  const ready = catalog();
  for (const format of formats) {
    expect(ready.preview[format]?.version).toBe("0.2.0-preview.12");
    expect(ready.preview[format]?.url).toContain("Couch_0.2.0-preview.12_");
    expect(ready.preview[format]?.url).toEndWith("?channel=preview");
  }
  expect(ready.preview.dmg?.filename).toEndWith("_aarch64.dmg");
  expect(ready.preview.nsis?.filename).toEndWith("_x64-setup.exe");
  expect(ready.preview.appimage?.filename).toEndWith("_amd64.AppImage");
  expect(ready.preview.deb?.filename).toEndWith("_amd64.deb");
});

test("uses newer verified feeds per format and keeps Stable separate", async () => {
  const fetched = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("darwin-aarch64") && url.includes("channel=preview")) return Response.json({ version: "0.2.0-preview.13", url: "https://cdn.crabnebula.app/asset/mac-updater" });
    if (url.includes("linux-x86_64-appimage") && !url.includes("channel=preview")) return Response.json({ version: "0.1.2", url: "https://cdn.crabnebula.app/asset/stable-updater" });
    if (url.includes("windows-x86_64-nsis") && url.includes("channel=preview")) return Response.json({ version: "0.1.5-preview.7", url: "https://cdn.crabnebula.app/asset/old-updater" });
    return new Response(null, { status: 404 });
  };
  const ready = await currentCatalog(fetched);
  expect(ready.preview.dmg?.version).toBe("0.2.0-preview.13");
  expect(ready.preview.dmg?.url).toEndWith("Couch_0.2.0-preview.13_aarch64.dmg?channel=preview");
  expect(ready.preview.nsis?.version).toBe("0.2.0-preview.12");
  expect(ready.stable.appimage?.version).toBe("0.1.2");
  expect(ready.stable.appimage?.url).toEndWith("Couch_0.1.2_amd64.AppImage");
  expect(ready.stable.dmg).toBeUndefined();
});

test("rejects a feed version from the wrong channel", async () => {
  const fetched = async () => Response.json({ version: "0.3.0", url: "https://cdn.crabnebula.app/asset/wrong" });
  const ready = await currentCatalog(fetched);
  expect(ready.preview.dmg?.version).toBe("0.2.0-preview.12");
});
