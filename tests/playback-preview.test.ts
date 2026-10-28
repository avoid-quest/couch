import { expect, test } from "bun:test";
import fixture from "./fixtures/youtube-storyboard.json";
import { createPreviewImages, playbackPreviewResponse, previewImageLimit, youtubePreview } from "../src/server/playback-preview";
import { previewSheet } from "../src/shared/playback-preview";
import { parseMedia } from "../src/server/web-media";

// Shape captured with yt-dlp 2026.10.26 from vWLJeqLPfSU; signed queries replaced.
const source = () => youtubePreview(structuredClone(fixture))!;
const request = (sheet?: string, signal?: AbortSignal) => new Request(`https://couch.test/api/playback-preview?playbackId=one${sheet === undefined ? "" : `&sheet=${sheet}`}`, { signal });
const paired = () => {};

test("real YouTube metadata maps intervals and the partial last sheet", () => {
  const preview = source();
  expect(preview).toMatchObject({ width: 160, height: 90, columns: 5, rows: 5, interval: 4.95, duration: 693, sheets: 6 });
  expect([0, 123.74, 123.75, 618.75, 693, 1000].map(time => previewSheet(preview, time))).toEqual([0, 0, 1, 5, 5, 5]);
  const media = { ...fixture, url: "https://video.example/movie.mp4", protocol: "https", vcodec: "avc1" };
  expect(parseMedia(media, "").preview?.sheets).toBe(6);
  expect(parseMedia({ ...media, vcodec: "none" }, "").preview).toBeUndefined();
  expect(parseMedia({ ...media, formats: [] }, "").source).toBe(media.url);
});

test("missing, live, malformed, oversized, foreign and expired storyboards are optional", () => {
  for (const change of [{ formats: undefined }, { extractor: "vimeo" }, { is_live: true }, { duration: NaN }, { duration: 86401 }]) expect(youtubePreview({ ...fixture, ...change })).toBeUndefined();
  for (const change of [{ width: -1 }, { height: Infinity }, { columns: 1000 }, { fps: 0 }, { fps: Infinity }, { fragments: [] }]) expect(youtubePreview({ ...fixture, formats: [{ ...fixture.formats[0], ...change }] })).toBeUndefined();
  for (const url of ["http://127.0.0.1/private", "https://i.ytimg.com.evil.test/sb/vWLJeqLPfSU/x", "https://user:pass@i.ytimg.com/sb/vWLJeqLPfSU/x", "https://i.ytimg.com/sb/another/x", "https://i.ytimg.com/sb/vWLJeqLPfSU/x?expire=1"]) {
    const bad = structuredClone(fixture); bad.formats[0]!.fragments[0]!.url = url;
    expect(youtubePreview(bad)).toBeUndefined();
  }
  const candidates = structuredClone(fixture);
  candidates.formats.unshift({ ...candidates.formats[0]!, width: 320 });
  expect(youtubePreview(candidates)?.width).toBe(160);
});

test("authorized metadata hides upstream URLs; missing and stale sources do no image work", async () => {
  const response = await playbackPreviewResponse(request(), async () => source(), paired);
  expect(await response.json()).toEqual({ width: 160, height: 90, columns: 5, rows: 5, interval: 4.95, duration: 693, sheets: 6 });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await playbackPreviewResponse(request(), async () => undefined, paired)).status).toBe(204);
  let read = false;
  const denied = () => { throw new Error("No permission"); };
  expect((await playbackPreviewResponse(request("0"), async () => { read = true; return source(); }, denied)).status).toBe(404);
  expect(read).toBe(false);
  expect((await playbackPreviewResponse(request("99"), async () => source(), paired)).status).toBe(404);
  expect((await playbackPreviewResponse(request("0"), async () => ({ ...source(), expiresAt: 1 }), paired)).status).toBe(204);
});

test("late source/image responses cannot outlive identity, authority or cancellation", async () => {
  for (const phase of ["metadata", "image"]) {
    let allowed = true;
    const authorize = () => { if (!allowed) throw new Error("Playback changed or permission revoked"); };
    const response = await playbackPreviewResponse(request(phase === "image" ? "0" : undefined), async () => { if (phase === "metadata") allowed = false; return source(); }, authorize,
      async () => { allowed = false; return { type: "image/webp", bytes: new Uint8Array([1]) }; });
    expect(response.status).toBe(404);
  }
  const controller = new AbortController(); controller.abort();
  expect((await playbackPreviewResponse(request("0", controller.signal), async () => source(), paired)).status).toBe(404);
});

test("images load on demand, deduplicate, enforce byte/type limits and cancel obsolete work", async () => {
  let calls = 0;
  const read = createPreviewImages((async () => { calls++; return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/webp" } }); }) as typeof fetch);
  const a = await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(a.status).toBe(200); expect(a.headers.get("content-type")).toBe("image/webp");
  await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(calls).toBe(1);
  for (const [type, size] of [["image/svg+xml", 2], ["image/jpeg", previewImageLimit + 1]] as const) {
    const read = createPreviewImages((async () => new Response(new Uint8Array(size), { headers: { "content-type": type } })) as typeof fetch);
    expect((await playbackPreviewResponse(request("0"), async () => source(), paired, read)).status).not.toBe(200);
  }
  let upstream!: AbortSignal;
  const cancel = createPreviewImages((async (_url, options) => {
    upstream = options!.signal!;
    await new Promise((_, reject) => upstream.addEventListener("abort", () => reject(upstream.reason), { once: true }));
    throw new Error();
  }) as typeof fetch);
  const controller = new AbortController();
  const pending = playbackPreviewResponse(request("0", controller.signal), async () => source(), paired, cancel);
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  expect((await pending).status).toBe(404); expect(upstream.aborted).toBe(true);
});
