import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fixture from "./fixtures/youtube-storyboard.json";
import { createPreviewImages, playbackPreviewResponse, previewImageLimit, storyboardPreview } from "../src/server/playback-preview";
import { previewAt, type PlaybackPreview } from "../src/shared/playback-preview";
import { parseMedia } from "../src/server/web-media";

const source = () => storyboardPreview(structuredClone(fixture))!;
const request = (image?: string, signal?: AbortSignal) => new Request(`https://couch.test/api/playback-preview?playbackId=one${image === undefined ? "" : `&image=${image}`}`, { signal });
const paired = () => {};
const sheet = readFileSync(new URL("./fixtures/preview-sheet.png", import.meta.url));
const picture = () => new Response(sheet, { headers: { "content-type": "image/png" } });

test("storyboards are a source capability; YouTube and Twitch partial sheets retain their frame timing", () => {
  const preview = source().metadata;
  expect(preview).toMatchObject({ kind: "grid", width: 160, height: 90, columns: 5, rows: 5, interval: 4.95, duration: 693, images: 6 });
  expect([0, 123.74, 123.75, 618.75, 693, 1000].map(time => previewAt(preview, time)?.image)).toEqual([0, 0, 1, 5, 5, 5]);
  const twitch = structuredClone(fixture);
  twitch.extractor = "twitch:vod";
  for (const format of twitch.formats) for (const fragment of format.fragments) { fragment.url = fragment.url.replace("i.ytimg.com", "static-cdn.jtvnw.net"); fragment.duration = twitch.duration / format.fragments.length; }
  expect(storyboardPreview(twitch)?.metadata).toEqual(preview);
  const media = { ...fixture, url: "https://video.example/movie.mp4", protocol: "https", vcodec: "avc1" };
  expect(parseMedia(media, "").preview?.metadata?.images).toBe(6);
  // Selecting sound from a video does not discard its programme previews.
  expect(parseMedia({ ...media, vcodec: "none" }, "").preview?.metadata).toEqual(preview);
  expect(parseMedia({ ...media, formats: [] }, "").preview).toBeUndefined();
});

test("missing, live, malformed, oversized and expired metadata never prevents valid playback", () => {
  for (const change of [{ formats: undefined }, { is_live: true }, { duration: NaN }, { duration: 86401 }]) expect(storyboardPreview({ ...fixture, ...change })).toBeUndefined();
  for (const change of [{ width: -1 }, { width: { toString: null } }, { height: Infinity }, { columns: 1000 }, { fps: 0 }, { fps: Infinity }, { fragments: [] }]) expect(storyboardPreview({ ...fixture, formats: [{ ...fixture.formats[0], ...change }] })).toBeUndefined();
  for (const url of ["file:///tmp/private", "https://user:pass@images.example/x", "https://images.example/x?expire=1"]) {
    const bad = structuredClone(fixture); bad.formats[0]!.fragments[0]!.url = url;
    expect(storyboardPreview(bad)).toBeUndefined();
  }
  const formats = [{ ...fixture.formats[0], width: { toString: null } }, ...fixture.formats];
  expect(parseMedia({ ...fixture, formats, url: "https://video.example/movie.mp4", vcodec: "avc1", protocol: "https" }, "").source).toBe("https://video.example/movie.mp4");
  expect(storyboardPreview({ ...fixture, formats })?.metadata).toEqual(source().metadata);
  expect(storyboardPreview({ ...fixture, formats: [{ ...fixture.formats[0], width: 320 }, ...fixture.formats] })?.metadata).toEqual(source().metadata);
});

test("timed cues preserve fractional intervals, full images, crops and gaps", () => {
  const preview: PlaybackPreview = { kind: "cues", duration: 5, images: 2, cues: [
    { image: 0, startTime: 0, endTime: .995 },
    { image: 1, startTime: 2, endTime: 5, width: 160, height: 90, coords: { x: 160, y: 90 } },
  ] };
  expect(previewAt(preview, .994)?.image).toBe(0);
  expect(previewAt(preview, .995)).toBeNull();
  expect(previewAt(preview, 1.5)).toBeNull();
  expect(previewAt(preview, 2)).toEqual(preview.cues[1]);
  expect(previewAt(preview, 5)).toEqual(preview.cues[1]);
  expect(previewAt(preview, NaN)).toBeNull();
});

test("metadata hides private descriptors; absent or expired sources do no image work", async () => {
  const response = await playbackPreviewResponse(request(), async () => source(), paired);
  expect(await response.json()).toEqual(source().metadata);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await playbackPreviewResponse(request(), async () => undefined, paired)).status).toBe(204);
  let read = false;
  const denied = () => { throw new Error("No permission"); };
  expect((await playbackPreviewResponse(request("0"), async () => { read = true; return source(); }, denied)).status).toBe(404);
  expect(read).toBe(false);
  expect((await playbackPreviewResponse(request("99"), async () => source(), paired)).status).toBe(404);
  expect((await playbackPreviewResponse(request("0"), async () => ({ ...source(), expiresAt: 1 }), paired)).status).toBe(204);
  const unsigned = storyboardPreview(fixture, Date.now() - 7_200_000)!;
  expect(unsigned.expiresAt).toBeUndefined();
  expect((await playbackPreviewResponse(request(), async () => unsigned, paired)).status).toBe(200);
});

test("late source/image responses cannot outlive identity, authority or cancellation", async () => {
  for (const phase of ["metadata", "image"]) {
    let allowed = true;
    const authorize = () => { if (!allowed) throw new Error("Playback changed or permission revoked"); };
    const response = await playbackPreviewResponse(request(phase === "image" ? "0" : undefined), async () => { if (phase === "metadata") allowed = false; return source(); }, authorize,
      async () => { allowed = false; return { type: "image/png", bytes: sheet }; });
    expect(response.status).toBe(404);
  }
  const controller = new AbortController(); controller.abort();
  expect((await playbackPreviewResponse(request("0", controller.signal), async () => source(), paired)).status).toBe(404);
});

test("image reads deduplicate and enforce byte, raster dimension, signature and crop limits", async () => {
  let calls = 0;
  const read = createPreviewImages((async () => { calls++; return picture(); }) as typeof fetch);
  const a = await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(a.status).toBe(200); expect(a.headers.get("content-type")).toBe("image/png");
  await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(calls).toBe(1);
  const large = Buffer.from(sheet); large.writeUInt32BE(8192, 16); large.writeUInt32BE(8192, 20);
  for (const [type, bytes] of [["image/svg+xml", new TextEncoder().encode("<svg></svg>")], ["image/jpeg", new Uint8Array(previewImageLimit + 1)], ["image/png", large], ["image/jpeg", new TextEncoder().encode("NOT AN IMAGE")]] as const) {
    const read = createPreviewImages((async () => new Response(bytes, { headers: { "content-type": type } })) as typeof fetch);
    expect((await playbackPreviewResponse(request("0"), async () => source(), paired, read)).status).not.toBe(200);
  }
  const invalidCrop = source();
  if (invalidCrop.metadata.kind === "grid") invalidCrop.metadata.width = 161;
  expect((await playbackPreviewResponse(request("0"), async () => invalidCrop, paired, read)).status).toBe(204);
});

test("temporary failures and a fifth concurrent download remain retryable; obsolete readers cancel", async () => {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const read = createPreviewImages((async () => { await ready; return picture(); }) as typeof fetch);
  const readers = [0, 1, 2, 3].map(index => playbackPreviewResponse(request(String(index)), async () => source(), paired, read));
  await new Promise(resolve => setTimeout(resolve, 0));
  const busy = await playbackPreviewResponse(request("4"), async () => source(), paired, read);
  expect(busy.status).toBe(503); expect(busy.headers.get("retry-after")).toBe("1");
  finish(); expect((await Promise.all(readers)).map(response => response.status)).toEqual([200, 200, 200, 200]);
  expect((await playbackPreviewResponse(request("4"), async () => source(), paired, read)).status).toBe(200);
  for (const status of [429, 500, 503]) {
    let attempts = 0;
    const transient = createPreviewImages((async () => ++attempts === 1 ? new Response(null, { status }) : picture()) as typeof fetch);
    expect((await playbackPreviewResponse(request("0"), async () => source(), paired, transient)).status).toBe(503);
    expect((await playbackPreviewResponse(request("0"), async () => source(), paired, transient)).status).toBe(200);
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
