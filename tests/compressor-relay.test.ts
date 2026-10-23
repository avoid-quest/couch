import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createPassThrough } from "../src/server/pass-through";

let fetch: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => { fetch = spyOn(globalThis, "fetch"); });
afterEach(() => fetch.mockRestore());
const target = { origin: "https://couch.example", userAgent: "Fixture" };

test("Direct media needs no relay when off, but Web Audio requires CORS-readable bytes", async () => {
  const source = "https://radio.example/audio.mp3", relay = createPassThrough(() => true);
  fetch.mockImplementation(async () => new Response("audio", { headers: { "Content-Type": "audio/mpeg" } }));
  const normal = await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000));
  expect(normal.source).toBe(source);
  const readable = await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000), true);
  expect(new URL(readable.source).origin).toBe(target.origin);
  expect(new URL(readable.source).pathname).toContain("/api/relay/playing/bytes/");
  expect(await (await relay.serve(new Request(readable.source))).text()).toBe("audio");
  await relay.close();
});

test("CORS-approved ordinary media remains direct with compression", async () => {
  const source = "https://radio.example/audio.mp3", relay = createPassThrough(() => true);
  fetch.mockImplementation(async () => new Response("audio", { headers: { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*" } }));
  expect((await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000), true)).source).toBe(source);
  await relay.close();
});

test("same-origin audio needs no CORS header or extra relay", async () => {
  const source = `${target.origin}/music.wav`, relay = createPassThrough(() => true);
  fetch.mockImplementation(async () => new Response("audio", { headers: { "Content-Type": "audio/wav" } }));
  expect((await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000), true)).source).toBe(source);
  await relay.close();
});

test("compressed HLS protects every segment and key even when its playlist allows CORS", async () => {
  const source = "https://radio.example/audio.m3u8", relay = createPassThrough(() => true);
  fetch.mockImplementation(async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/key"\n#EXTINF:2,\nhttps://first.example/segment.ts\n#EXTINF:2,\nhttps://second.example/segment.ts\n', { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Access-Control-Allow-Origin": "*" } }));
  const readable = await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000), true);
  const playlist = await (await relay.serve(new Request(readable.source))).text();
  const urls = [...playlist.matchAll(/https:\/\/couch\.example\/api\/relay\/[^\s"]+/g)].map(match => match[0]);
  expect(urls).toHaveLength(3);
  expect(urls.map(url => new URL(url).searchParams.get("url"))).toEqual(["https://keys.example/key", "https://first.example/segment.ts", "https://second.example/segment.ts"]);
  await relay.close();
});

test("an inconclusive CORS probe never sends opaque audio into Web Audio", async () => {
  const source = "https://radio.example/audio.mp3", relay = createPassThrough(() => true);
  fetch.mockImplementation(async () => { throw new Error("Probe timed out"); });
  expect((await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000))).source).toBe(source);
  const prepared = await relay.prepare("playing", { source }, {}, target, AbortSignal.timeout(3000), true);
  expect(new URL(prepared.source).pathname).toContain("/api/relay/playing/bytes/");
  await relay.close();
});
