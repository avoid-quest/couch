import { expect, test } from "bun:test";
import { publicFiles } from "../../../scripts/hosted-policy";
import { catalog, currentCatalog, fillDownloads, formats, type Catalog } from "./release-catalog";

// A fixed fallback, so these tests don't change when the published snapshot advances.
const asset = (id: string) => `https://cdn.crabnebula.app/asset/${id}`;
const base: Catalog = { stable: {}, preview: Object.fromEntries(formats.map(format => [format, { version: "0.2.0-preview.13", filename: publicFiles("0.2.0-preview.13", format)[0]!, url: asset(format) }])) };

test("handles an empty release source without inventing downloads", () => {
  expect(catalog({ stable: {}, preview: {} })).toEqual({ stable: {}, preview: {} });
});

test("keeps a signed fallback download for every installer", () => {
  const ready = catalog();
  for (const format of formats) {
    const item = ready.preview[format] ?? ready.stable[format];
    expect(item?.filename).toBe(publicFiles(item!.version, format)[0]!);
    expect(item?.url).toStartWith("https://cdn.crabnebula.app/asset/");
  }
});

test("uses newer verified feeds per format and keeps Stable separate", async () => {
  const fetched = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("darwin-aarch64") && url.includes("channel=preview")) return Response.json({ version: "0.2.0-preview.14", url: asset("mac-updater") });
    if (url.includes("linux-x86_64-appimage") && !url.includes("channel=preview")) return Response.json({ version: "0.1.2", url: asset("stable-updater") });
    if (url.includes("windows-x86_64-nsis") && url.includes("channel=preview")) return Response.json({ version: "0.1.5-preview.7", url: asset("old-updater") });
    return new Response(null, { status: 404 });
  };
  const ready = await currentCatalog(fetched, base);
  expect(ready.preview.dmg?.version).toBe("0.2.0-preview.14");
  expect(ready.preview.dmg?.url).toEndWith("Couch_0.2.0-preview.14_aarch64.dmg?channel=preview");
  expect(ready.preview.nsis).toEqual(base.preview.nsis);
  expect(ready.stable.appimage?.version).toBe("0.1.2");
  expect(ready.stable.appimage?.url).toEndWith("Couch_0.1.2_amd64.AppImage");
  expect(ready.stable.dmg).toBeUndefined();
});

test("an unavailable feed keeps the old immutable download after latest advances", async () => {
  const ready = await currentCatalog(async () => new Response(null, { status: 404 }), base);
  expect(ready.preview.dmg).toEqual(base.preview.dmg);
});

test("rejects a feed version from the wrong channel", async () => {
  const ready = await currentCatalog(async () => Response.json({ version: "0.3.0", url: asset("wrong") }), base);
  expect(ready.preview.dmg?.version).toBe("0.2.0-preview.13");
});

test("fills the download page with the current releases", async () => {
  const page = `
    <section data-channel="stable" hidden><li data-format="appimage" hidden><span data-version></span><a data-download></a></li><li data-format="dmg"></li></section>
    <section data-channel="preview"><li data-format="deb"><span data-version>old</span><a data-download href="old"></a></li></section>
    <p id="no-releases"></p><details id="tv" hidden><code id="deb-command">old</code></details>`;
  const current: Catalog = { stable: { appimage: { version: "0.1.2", filename: "Couch_0.1.2_amd64.AppImage", url: asset("stable") } }, preview: { deb: { version: "0.2.0-preview.19", filename: "Couch_0.2.0-preview.19_amd64.deb", url: asset("deb") } } };
  const html = await fillDownloads(new Response(page), current).text();
  expect(html).toContain(`<section data-channel="stable"><li data-format="appimage"><span data-version>0.1.2</span><a data-download href="${asset("stable")}">`);
  expect(html).toContain(`<li data-format="dmg" hidden="">`);
  expect(html).toContain(`<span data-version>0.2.0-preview.19</span><a data-download href="${asset("deb")}">`);
  expect(html).toContain(`<p id="no-releases" hidden="">`);
  expect(html).toContain(`<code id="deb-command">sudo apt install ./Couch_0.2.0-preview.19_amd64.deb</code>`);
  expect(html).toContain(`<details id="tv"><code`);
});
