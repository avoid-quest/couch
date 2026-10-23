import { expect, test } from "bun:test";
import { createReleaseHistory, releaseNoteItems } from "../src/server/release-notes";
import { compareUpdateVersions } from "../src/shared/releases";

test("generated release notes lead with changes, without installation or contributor boilerplate", () => {
  expect(releaseNoteItems(`## Installing on macOS
* Run a command first
\`\`\`sh
xattr ...
\`\`\`
## What's Changed
* Keep **sound** playing by @author in https://github.com/avoid-quest/couch/pull/841
* [Share a screen](https://example.com) &amp; sound
## New Contributors
* @someone made their first contribution
**Full Changelog**: https://github.com/avoid-quest/couch/compare/v0.3.0...v0.4.0`)).toEqual(["Keep sound playing", "Share a screen & sound"]);
});

test("release comparison orders stable after previews and compares preview numbers numerically", () => {
  expect(["0.4.0-preview.2", "0.3.1", "0.4.0", "0.4.0-preview.11"].sort(compareUpdateVersions))
    .toEqual(["0.3.1", "0.4.0-preview.2", "0.4.0-preview.11", "0.4.0"]);
  expect(compareUpdateVersions("0.4.0", "0.4.0")).toBe(0);
});

test("release history shares requests across channels, excludes drafts and retains exact release links", async () => {
  let calls = 0;
  const release = (tag_name: string, draft = false) => ({ tag_name, draft, published_at: "2026-10-23T10:18:22Z", body: "## What's Changed\n* Fix playback" });
  const history = createReleaseHistory((async () => {
    calls++;
    return Response.json([release("v0.4.0-preview.1"), release("v0.3.1"), release("v0.5.0", true), release("garbled")]);
  }) as typeof fetch);
  const [stable, preview] = await Promise.all([history("latest", 1), history("preview", 1)]);
  expect(stable.releases.map(item => item.version)).toEqual(["0.3.1"]);
  expect(preview.releases).toEqual([{ version: "0.4.0-preview.1", publishedAt: "2026-10-23T10:18:22Z", url: "https://github.com/avoid-quest/couch/releases/tag/v0.4.0-preview.1", items: ["Fix playback"] }]);
  expect(preview.more).toBe(false);
  await history("preview", 1);
  expect(calls).toBe(1);
});

test("a filtered empty page can still lead to more releases, and failed reads can be retried", async () => {
  let calls = 0;
  const history = createReleaseHistory((async () => {
    if (++calls === 1) return new Response(null, { status: 503 });
    return Response.json(Array.from({ length: 30 }, (_, i) => ({ tag_name: `v0.4.0-preview.${i + 1}`, published_at: "2026-10-23", body: "" })));
  }) as typeof fetch);
  await expect(history("latest", 1)).rejects.toThrow("Couldn't load");
  expect(await history("latest", 1)).toEqual({ releases: [], more: true });
});
