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
const request = (cancellation?: AbortSignal) => new Request("https://couch.test/api/playback-preview?playbackId=one", { signal: cancellation });

test("real 200-cell Twitch geometry and native intervals survive binary-MIME JPEG responses", async () => {
  const info = { duration: 25593, formats: native.map(spec => ({ protocol: "mhtml", ...spec, columns: spec.cols,
    fps: spec.count / 25593, couch_interval: spec.interval, couch_frames: spec.count,
    fragments: spec.images.map(url => ({ url: `https://images.example/${url}` })) })) };
  const source = storyboardPreview(info)!;
  expect(source.metadata).toMatchObject({ kind: "grid", width: 160, height: 90, rows: 40, columns: 5, frames: 200, interval: 128 });
  expect(previewAt(source.metadata, 128)?.coords).toEqual({ x: 160, y: 0 });
  expect(previewAt(source.metadata, 25593)?.coords).toEqual({ x: 640, y: 3510 });
  const read = createPreviewImages((async () => new Response(readFileSync(new URL("./fixtures/twitch-preview.jpg", import.meta.url)), { headers: { "content-type": "binary/octet-stream" } })) as typeof fetch);
  const result = await playbackPreviewResponse(new Request(`${request().url}&image=0`), async () => source, () => {}, read);
  expect(result.status).toBe(200); expect(result.headers.get("content-type")).toBe("image/jpeg");
  const old = storyboardPreview({ ...info, duration: 11643, formats: [{ ...info.formats[0], fps: 200 / 11643, couch_interval: 59 }] })!;
  expect(previewAt(old.metadata, 10000)?.coords).toEqual({ x: 640, y: 2970 }); // native frame 169, not derived frame 171
});

test("PNG and WebP signatures also override missing or misleading provider MIME", async () => {
  for (const [file, type] of [["preview-sheet.png", "image/png"], ["preview-sheet.webp", "image/webp"]]) {
    for (const supplied of ["application/octet-stream", "image/jpeg", "text/plain", ""]) {
      const read = createPreviewImages((async () => new Response(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)), { headers: { "content-type": supplied! } })) as typeof fetch);
      expect((await read(`https://images.example/${file}`, signal()))?.type).toBe(type!);
    }
  }
});

test("VTT preserves actual fractional ranges, relative URLs, full images, crops and gaps", () => {
  const source = parsePreviewVtt(sample, base)!;
  expect(source.images).toEqual(["https://images.example/track/first.png", "https://images.example/sheet.jpg"]);
  expect(source.metadata).toEqual({ kind: "cues", duration: 5, images: 2, cues: [
    { image: 0, startTime: 0, endTime: .995 },
    { image: 1, startTime: 2, endTime: 5, width: 160, height: 90, coords: { x: 160, y: 90 } },
  ] });
  expect(previewAt(source.metadata, .995)).toBeNull();
  expect(previewAt(source.metadata, 1.999)).toBeNull();
  expect(previewAt(source.metadata, 5)?.image).toBe(1);
  expect(previewAt(source.metadata, 5.001)).toBeNull();
  expect(parsePreviewVtt(sample.replace("xywh=", "xywh=pixel:"), base)?.metadata).toEqual(source.metadata);
  expect(parsePreviewVtt(sample.replaceAll("\n", "\r\n"), base)?.metadata).toEqual(source.metadata);
  expect(parsePreviewVtt(sample.replaceAll("\n", "\r"), base)?.metadata).toEqual(source.metadata);
  expect(parsePreviewVtt(`\uFEFF${sample}`, base)?.metadata).toEqual(source.metadata);
  for (const [name, cues, images, duration] of [["streamingcommunity", 210, 4, 3360], ["animeunity", 80, 2, 1280]] as const) {
    const source = parsePreviewVtt(readFileSync(new URL(`./fixtures/${name}-preview.vtt`, import.meta.url), "utf8"), base)!;
    expect(source.metadata).toMatchObject({ kind: "cues", duration, images });
    if (source.metadata.kind === "cues") expect(source.metadata.cues).toHaveLength(cues);
  }
});

test("invalid, overlapping, unbounded, mapped-clock and non-image cue metadata fail locally", () => {
  for (const body of ["<html>Error</html>", "WEBVTT\n\n", sample.replace("00:02.000", "00:00.500"), sample.replace("00:05.000", "00:02.000"),
    sample.replace("00:00.995", "00:60.000"), sample.replace("00:05.000", "25:00:00.000"), sample.replace("160,90,160,90", "8190,0,160,90"),
    sample.replace("160,90,160,90", "0,0,0,0"), sample.replace("160,90,160,90", "0,0,4000,4000"), sample.replace("first.png", "file:///etc/passwd"),
    sample.replace("first.png", "https://user:pass@images.example/p.png"), sample.replace("first.png", "Subtitle text"),
    sample.replace("WEBVTT\n", "WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n"), sample.replace("#xywh=160,90,160,90", "#xywh=percent:0,0,50,50"),
    `WEBVTT\n\n${"\n".repeat(20001)}`, `WEBVTT\n\n${"x".repeat(previewManifestLimit)}`]) expect(parsePreviewVtt(body, base)).toBeUndefined();
  const many = (count: number, unique: boolean) => "WEBVTT\n\n" + Array.from({ length: count }, (_, i) => {
    const at = (n: number) => `${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000`;
    return `${at(i)} --> ${at(i + 1)}\n${unique ? i : 0}.png\n\n`;
  }).join("");
  expect(parsePreviewVtt(many(4001, false), base)).toBeUndefined();
  expect(parsePreviewVtt(many(129, true), base)).toBeUndefined();
});

test("literal discovery never executes page expressions or fetches manifests while resolving playback", () => {
  expect(playerPreview(`<script>window.thumbnailsUrl = '../track.vtt';</script>`, base)).toEqual(vttPreview("https://images.example/track.vtt"));
  for (const text of ["", "window.thumbnailsUrl = eval('code')", "window.thumbnailsUrl = 'prefix' + evil;", "window.thumbnailsUrl = 'file:///etc/passwd';"]) expect(playerPreview(text, base)).toBeUndefined();
  const media = { source: "unused", url: "https://media.example/video.mp4", protocol: "https", vcodec: "avc1", duration: 1200, couch_preview_vtt: base };
  expect(parseMedia(media, "").preview).toEqual(vttPreview(base));
  expect(parseMedia({ ...media, is_live: true }, "").preview).toBeUndefined();
  expect(parseMedia({ ...media, is_live: false, live_status: "is_live" }, "").preview).toBeUndefined();
  expect(parseMedia({ ...media, couch_preview_vtt: { toString: null } }, "").source).toBe(media.url);
});

test("lazy manifests deduplicate per source, use the final redirect base and never expose URLs", async () => {
  let calls = 0, images = 0;
  const read = createPreviewResolver((async () => {
    calls++; const result = response(); Object.defineProperty(result, "url", { value: "https://cdn.example/redirected/track.vtt" }); return result;
  }) as typeof fetch);
  const source = vttPreview(base)!;
  const readImage = async () => { images++; return null; };
  expect(calls).toBe(0);
  const results = await Promise.all([1, 2, 3].map(() => playbackPreviewResponse(request(), async () => source, () => {}, readImage, read)));
  expect(results.map(result => result.status)).toEqual([200, 200, 200]); expect(calls).toBe(1); expect(images).toBe(0);
  expect(await results[0]!.text()).not.toContain("example");
  expect((await read(source, signal()))?.images[0]).toBe("https://cdn.example/redirected/first.png");
  await read(source, signal()); expect(calls).toBe(1);
  await read(vttPreview(base), signal()); expect(calls).toBe(2);
  const denied = await playbackPreviewResponse(request(), async () => source, () => { throw new Error("Revoked"); }, readImage, read);
  expect(denied.status).toBe(404); expect(calls).toBe(2);
});

test("last-reader cancellation and obsolete playback retire manifest work without canceling other readers", async () => {
  let upstream!: AbortSignal, done!: () => void;
  const ready = new Promise<void>(resolve => { done = resolve; });
  const read = createPreviewResolver((async (_url, options) => {
    upstream = options!.signal!; await ready; upstream.throwIfAborted(); return response();
  }) as typeof fetch);
  const source = vttPreview(base)!, first = new AbortController(), second = new AbortController();
  const one = playbackPreviewResponse(request(first.signal), async () => source, () => {}, undefined, read);
  const two = playbackPreviewResponse(request(second.signal), async () => source, () => {}, undefined, read);
  await new Promise(resolve => setTimeout(resolve, 0)); first.abort();
  expect((await one).status).toBe(404); expect(upstream.aborted).toBe(false);
  second.abort(); expect((await two).status).toBe(404); expect(upstream.aborted).toBe(true); done();
  let authorized = true;
  const stale = createPreviewResolver((async () => { authorized = false; return response(); }) as typeof fetch);
  expect((await playbackPreviewResponse(request(), async () => source, () => { if (!authorized) throw new Error("Changed"); }, undefined, stale)).status).toBe(404);
});

test("manifest absence is optional; temporary failures and saturation can be retried", async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    const read = createPreviewResolver((async () => ++calls === 1 ? new Response(null, { status }) : response()) as typeof fetch);
    const source = vttPreview(base)!;
    const first = await playbackPreviewResponse(request(), async () => source, () => {}, undefined, read);
    expect(first.status).toBe(503); expect(first.headers.get("retry-after")).toBe("1");
    expect((await playbackPreviewResponse(request(), async () => source, () => {}, undefined, read)).status).toBe(200);
  }
  for (const status of [404, 410]) {
    const read = createPreviewResolver((async () => new Response(null, { status })) as typeof fetch);
    expect((await playbackPreviewResponse(request(), async () => vttPreview(base), () => {}, undefined, read)).status).toBe(204);
  }
  let done!: () => void;
  const wait = new Promise<void>(resolve => { done = resolve; });
  const read = createPreviewResolver((async () => { await wait; return response(); }) as typeof fetch);
  const readers = Array.from({ length: 4 }, () => read(vttPreview(base), signal()));
  const fifth = vttPreview(base)!;
  await expect(read(fifth, signal())).rejects.toThrow("busy");
  done(); await Promise.all(readers); expect((await read(fifth, signal()))?.metadata.kind).toBe("cues");
});

test("oversized manifest bodies cancel before retaining them", async () => {
  for (const declared of [true, false]) {
    let canceled = false;
    const read = createPreviewResolver((async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(previewManifestLimit + 1)); }, cancel() { canceled = true; } }), { headers: declared ? { "content-length": String(previewManifestLimit + 1) } : {} })) as typeof fetch);
    await expect(read(vttPreview(base), signal())).rejects.toThrow("size limit"); expect(canceled).toBe(true);
  }
});
