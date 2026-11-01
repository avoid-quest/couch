import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createPreviewResolver, parsePreviewVtt, playerPreview, previewManifestLimit, vttPreview } from "../src/server/preview-manifest";
import { playbackPreviewResponse, createPreviewImages, storyboardPreview } from "../src/server/playback-preview";
import { previewAt } from "../src/shared/playback-preview";
import { parseMedia } from "../src/server/web-media";
import native from "./fixtures/twitch-storyboard.json";

const base = "https://images.example/track/previews.vtt";
const signal = () => new AbortController().signal;
const sample = "WEBVTT\n\nfirst\n00:00.000 --> 00:00.995\nfirst.png\n\n00:02.000 --> 00:05.000\n../sheet.jpg#xywh=160,90,160,90\n";
const response = (body = sample) => new Response(body, { headers: { "Content-Type": "application/octet-stream" } });
const request = () => new Request("https://couch.test/api/playback-preview?playbackId=one");

test("real 200-cell Twitch geometry and native intervals survive binary-MIME JPEG responses", async () => {
  const info = { duration: 25593, formats: native.map(spec => ({ protocol: "mhtml", ...spec, columns: spec.cols,
    fps: spec.count / 25593, couch_interval: spec.interval, couch_frames: spec.count,
    fragments: spec.images.map(url => ({ url: `https://images.example/${url}` })) })) };
  const source = storyboardPreview(info)!;
  expect(source.metadata).toMatchObject({ kind: "grid", width: 160, height: 90, rows: 40, columns: 5, frames: 200, interval: 128 });
  expect(previewAt(source.metadata, 25593)?.coords).toEqual({ x: 640, y: 3510 });
  const read = createPreviewImages((async () => new Response(readFileSync(new URL("./fixtures/twitch-preview.jpg", import.meta.url)), { headers: { "content-type": "binary/octet-stream" } })) as typeof fetch);
  const result = await playbackPreviewResponse(new Request(`${request().url}&image=0`), async () => source, () => {}, read);
  expect(result.status).toBe(200); expect(result.headers.get("content-type")).toBe("image/jpeg");
  const old = storyboardPreview({ ...info, duration: 11643, formats: [{ ...info.formats[0], fps: 200 / 11643, couch_interval: 59 }] })!;
  expect(previewAt(old.metadata, 10000)?.coords).toEqual({ x: 640, y: 2970 }); // native frame 169, not derived frame 171
});

test("VTT preserves actual fractional ranges, relative URLs, full images, crops and gaps", () => {
  const source = parsePreviewVtt(sample, base)!;
  expect(source.images).toEqual(["https://images.example/track/first.png", "https://images.example/sheet.jpg"]);
  expect(source.metadata).toEqual({ kind: "cues", duration: 5, images: 2, cues: [
    { image: 0, startTime: 0, endTime: .995 },
    { image: 1, startTime: 2, endTime: 5, width: 160, height: 90, coords: { x: 160, y: 90 } },
  ] });
  expect(previewAt(source.metadata, 1.999)).toBeNull();
  expect(parsePreviewVtt(sample.replaceAll("\n", "\r\n"), base)?.metadata).toEqual(source.metadata);
  expect(parsePreviewVtt(`﻿${sample}`, base)?.metadata).toEqual(source.metadata);
  for (const [name, cues, images, duration] of [["streamingcommunity", 210, 4, 3360], ["animeunity", 80, 2, 1280], ["raiplay", 100, 4, 280]] as const) {
    const source = parsePreviewVtt(readFileSync(new URL(`./fixtures/${name}-preview.vtt`, import.meta.url), "utf8"), base)!;
    expect(source.metadata).toMatchObject({ kind: "cues", duration, images });
    if (source.metadata.kind === "cues") expect(source.metadata.cues).toHaveLength(cues);
  }
});

test("invalid, overlapping, unbounded and non-image cue metadata fail locally", () => {
  for (const body of ["<html>Error</html>", sample.replace("00:02.000", "00:00.500"), sample.replace("00:05.000", "25:00:00.000"),
    sample.replace("160,90,160,90", "0,0,4000,4000"), sample.replace("first.png", "file:///etc/passwd"),
    sample.replace("first.png", "https://user:pass@images.example/p.png"), sample.replace("first.png", "Subtitle text"),
    `WEBVTT\n\n${"x".repeat(previewManifestLimit)}`]) expect(parsePreviewVtt(body, base)).toBeUndefined();
});

test("literal discovery never executes page expressions", () => {
  expect(playerPreview(`<script>window.thumbnailsUrl = '../track.vtt';</script>`, base)).toEqual(vttPreview("https://images.example/track.vtt"));
  for (const text of ["window.thumbnailsUrl = eval('code')", "window.thumbnailsUrl = 'prefix' + evil;", "window.thumbnailsUrl = 'file:///etc/passwd';"]) expect(playerPreview(text, base)).toBeUndefined();
  const media = { source: "unused", url: "https://media.example/video.mp4", protocol: "https", vcodec: "avc1", duration: 1200, couch_preview_vtt: base };
  expect(parseMedia(media, "").preview).toEqual(vttPreview(base));
  expect(parseMedia({ ...media, is_live: true }, "").preview).toBeUndefined();
});

test("lazy manifests deduplicate per source, use the final redirect base and never expose URLs", async () => {
  let calls = 0;
  const read = createPreviewResolver((async (_url, options) => {
    expect(options?.credentials).toBe("omit");
    calls++; const result = response(); Object.defineProperty(result, "url", { value: "https://cdn.example/redirected/track.vtt" }); return result;
  }) as typeof fetch);
  const source = vttPreview(base)!;
  const readImage = async () => null;
  const results = await Promise.all([1, 2, 3].map(() => playbackPreviewResponse(request(), async () => source, () => {}, readImage, read)));
  expect(results.map(result => result.status)).toEqual([200, 200, 200]); expect(calls).toBe(1);
  expect(await results[0]!.text()).not.toContain("example");
  expect((await read(source, signal()))?.images[0]).toBe("https://cdn.example/redirected/first.png");
  const denied = await playbackPreviewResponse(request(), async () => source, () => { throw new Error("Revoked"); }, readImage, read);
  expect(denied.status).toBe(404); expect(calls).toBe(1);
});

test("oversized manifest bodies cancel before retaining them", async () => {
  for (const declared of [true, false]) {
    let canceled = false;
    const read = createPreviewResolver((async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(previewManifestLimit + 1)); }, cancel() { canceled = true; } }), { headers: declared ? { "content-length": String(previewManifestLimit + 1) } : {} })) as typeof fetch);
    await expect(read(vttPreview(base), signal())).rejects.toThrow("size limit"); expect(canceled).toBe(true);
  }
});
