import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createPassThrough } from "../src/server/pass-through";

const origin = "https://couch.local";
const target = { origin, userAgent: "Browser fixture" };
const source = "https://media.example/master.m3u8";
const credentials = { AuThOrIzAtIoN: "Bearer auth fixture", CoOkIe: "session=cookie-fixture", "PrOxY-AuThOrIzAtIoN": "Basic proxy fixture", "X-Api-Key": "api fixture", "x-AUTH-token": "token fixture" };
const providerHeaders = { ...credentials, "user-agent": "Provider fixture", referer: "https://user:password@player.example/private-path?token=private#private-fragment" };
const signal = () => AbortSignal.timeout(3000);
const rawRequest = spyOn(globalThis, "fetch");
beforeEach(() => { rawRequest.mockReset(); rawRequest.mockRejectedValue(new Error("Public media used an unprotected request.")); });
afterAll(() => rawRequest.mockRestore());

function response(url: string, body: BodyInit, init: ResponseInit = {}) {
  const result = new Response(body, { ...init, headers: { "Access-Control-Allow-Origin": "*", ...init.headers } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function fixture() {
  const current = new Set(["playing"]);
  const replies = new Map<string, () => Response>();
  const requests: Array<{ url: string; headers: Headers }> = [];
  // Only the pinned public-request boundary is synthetic. The production relay
  // chooses every route, rewrites each manifest and validates each capability.
  const publicRequest = (async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    return replies.get(url)?.() ?? response(url, "bytes", { headers: { "Content-Type": "video/mp4" } });
  }) as typeof fetch;
  const relay = createPassThrough(id => current.has(id), publicRequest);
  const manifest = (url: string, text: string, type = "application/vnd.apple.mpegurl") => replies.set(url, () => response(url, text, { headers: { "Content-Type": type } }));
  const prepare = (url = source, playbackId = "playing", destination = target, headers: Record<string, string> = {}) => relay.prepare(playbackId, { source: url, publicNetwork: true }, headers, destination, signal());
  const serve = (url: string, headers?: HeadersInit) => relay.serve(new Request(url, { headers }));
  return { relay, current, replies, requests, manifest, prepare, serve };
}

function destination(value: string, kind: "playlist" | "bytes", upstream: string, base = origin) {
  const url = new URL(value);
  expect(url.origin).toBe(base);
  expect(url.pathname).toContain(`/api/relay/playing/${kind}/`);
  expect(url.searchParams.get("url")).toBe(upstream);
}

function sourceHeaders(headers: Headers, authorized: boolean) {
  for (const [name, value] of Object.entries(credentials)) expect(headers.get(name)).toBe(authorized ? value : null);
  expect(headers.get("user-agent")).toBe(providerHeaders["user-agent"]);
  expect(headers.get("referer")).toBe(authorized ? providerHeaders.referer : "https://player.example/");
  expect(headers.get("accept-encoding")).toBe("identity");
}

test("public video and audio use protected relay even with permissive CORS and native playback", async () => {
  const f = fixture();
  const video = "https://media.example/video.mp4", audio = "https://media.example/audio.m4a";
  const media = await f.relay.prepare("playing", { source: video, audioSource: audio, publicNetwork: true, mpv: true }, {}, target, signal());
  destination(media.source, "bytes", video);
  destination(media.audioSource!, "bytes", audio);
  expect(f.requests).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public media cannot fall back to a raw URL when no protected destination is available", async () => {
  const f = fixture();
  await expect(f.relay.prepare("playing", { source, publicNetwork: true }, {}, null, signal())).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public master playlists protect relative, scheme-relative and rendition destinations", async () => {
  const f = fixture();
  f.manifest(source, ["#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="//audio.example/audio.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subs/index.m3u8"',
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1000,URI="iframe.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"', "video/index.m3u8", ""].join("\n"));
  const media = await f.prepare();
  const result = await f.serve(media.source);
  expect(result.status).toBe(200);
  const text = await result.text();
  const attributes = [...text.matchAll(/URI="([^"]+)"/g)].map(match => match[1]!);
  destination(attributes[0]!, "playlist", "https://audio.example/audio.m3u8");
  destination(attributes[1]!, "playlist", "https://media.example/subs/index.m3u8");
  destination(attributes[2]!, "playlist", "https://media.example/iframe.m3u8");
  destination(text.split("\n").find(line => line && !line.startsWith("#"))!, "playlist", "https://media.example/video/index.m3u8");
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public media playlists protect keys, maps, low-latency parts and every segment", async () => {
  const f = fixture();
  f.manifest(source, ["#EXTM3U", '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/key"',
    '#EXT-X-MAP:URI="init.mp4"', '#EXT-X-PART:DURATION=0.5,URI="parts/1.m4s"',
    '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="//cdn.example/parts/2.m4s"',
    '#EXT-X-RENDITION-REPORT:URI="other.m3u8",LAST-MSN=1', "#EXTINF:6,", "segments/1.ts", "#EXT-X-ENDLIST", ""].join("\n"));
  const media = await f.prepare();
  const result = await f.serve(media.source);
  const text = await result.text();
  expect(result.status).toBe(200);
  const attributes = [...text.matchAll(/URI="([^"]+)"/g)].map(match => match[1]!);
  for (const [index, upstream] of ["https://keys.example/key", "https://media.example/init.mp4", "https://media.example/parts/1.m4s", "https://cdn.example/parts/2.m4s"].entries()) {
    destination(attributes[index]!, "bytes", upstream);
  }
  destination(attributes[4]!, "playlist", "https://media.example/other.m3u8");
  const segment = text.split("\n").find(line => line && !line.startsWith("#"))!;
  destination(segment, "bytes", "https://media.example/segments/1.ts");
  expect((await f.serve(segment)).status).toBe(200);
  expect(f.requests.at(-1)?.url).toBe("https://media.example/segments/1.ts");
  expect(rawRequest).not.toHaveBeenCalled();
});

for (const childOrigin of ["https://cdn.example", "http://media.example", "https://media.example:444"]) {
  test(`HLS credentials remain on the source origin when children use ${childOrigin}`, async () => {
    const f = fixture();
    const local = "https://media.example/local.m3u8";
    const variant = `${childOrigin}/variant.m3u8`, rendition = `${childOrigin}/audio.m3u8`;
    f.manifest(source, `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="${rendition}"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${local}\n#EXT-X-STREAM-INF:BANDWIDTH=2000\n${variant}\n`);
    for (const url of [local, variant, rendition]) f.manifest(url, `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${childOrigin}/encryption.key"\n#EXT-X-MAP:URI="${childOrigin}/init.mp4"\n#EXT-X-PART:DURATION=0.5,URI="${childOrigin}/part.m4s"\n#EXTINF:6,\n${childOrigin}/segment.ts\n#EXTINF:6,\nhttps://media.example/local.ts\n`);
    const media = await f.prepare(source, "playing", target, providerHeaders);
    const master = await f.serve(media.source);
    expect(master.status).toBe(200);
    sourceHeaders(f.requests.at(-1)!.headers, true);
    const text = await master.text();
    const playlists = [...text.matchAll(/URI="([^"]+)"/g)].map(match => match[1]!).concat(text.split("\n").filter(line => line && !line.startsWith("#")));
    expect(playlists).toHaveLength(3);
    for (const playlist of playlists) {
      const authorized = new URL(new URL(playlist).searchParams.get("url")!).origin === new URL(source).origin;
      const result = await f.serve(playlist);
      expect(result.status).toBe(200);
      sourceHeaders(f.requests.at(-1)!.headers, authorized);
      const body = await result.text();
      const children = [...body.matchAll(/URI="([^"]+)"/g)].map(match => match[1]!).concat(body.split("\n").filter(line => line && !line.startsWith("#")));
      expect(children).toHaveLength(5);
      for (const child of children) {
        expect((await f.serve(child)).status).toBe(200);
        sourceHeaders(f.requests.at(-1)!.headers, new URL(new URL(child).searchParams.get("url")!).origin === new URL(source).origin);
      }
    }
    expect(rawRequest).not.toHaveBeenCalled();
  });
}

test("a redirected playlist resolves children at its effective URL without granting that origin credentials", async () => {
  const f = fixture();
  const effective = "https://redirected.example/path/master.m3u8";
  f.replies.set(source, () => response(effective, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8\n", { headers: { "Content-Type": "application/vnd.apple.mpegurl" } }));
  f.manifest("https://redirected.example/path/variant.m3u8", "#EXTM3U\n#EXTINF:6,\nsegment.ts\n");
  const media = await f.prepare(source, "playing", target, providerHeaders);
  const master = await f.serve(media.source);
  sourceHeaders(f.requests.at(-1)!.headers, true);
  const variant = (await master.text()).split("\n").find(line => line && !line.startsWith("#"))!;
  destination(variant, "playlist", "https://redirected.example/path/variant.m3u8");
  const result = await f.serve(variant);
  sourceHeaders(f.requests.at(-1)!.headers, false);
  const segment = (await result.text()).split("\n").find(line => line && !line.startsWith("#"))!;
  destination(segment, "bytes", "https://redirected.example/path/segment.ts");
  expect((await f.serve(segment)).status).toBe(200);
  sourceHeaders(f.requests.at(-1)!.headers, false);
  expect(rawRequest).not.toHaveBeenCalled();
});

for (const reference of ["file:///etc/passwd", "data:text/plain,private", "ftp://127.0.0.1/private", "tcp://127.0.0.1:1234", "https://user:password@media.example/private"]) {
  test(`public HLS rejects unsupported destination ${reference.split(":")[0]}`, async () => {
    const f = fixture();
    f.manifest(source, `#EXTM3U\n#EXTINF:6,\n${reference}\n`);
    const media = await f.prepare();
    expect((await f.serve(media.source)).status).toBe(502);
    expect(rawRequest).not.toHaveBeenCalled();
  });
}

for (const feature of [
  '#EXT-X-DEFINE:NAME="host",VALUE="127.0.0.1"\n#EXTINF:6,\nhttp://{$host}/private',
  '#EXT-X-CONTENT-STEERING:SERVER-URI="http://127.0.0.1/steering.json"',
  '#EXT-X-KEY:METHOD=AES-128,URI=http://127.0.0.1/key',
]) {
  test("public HLS rejects destinations introduced outside supported URI rewriting", async () => {
    const f = fixture();
    f.manifest(source, `#EXTM3U\n${feature}\n`);
    const media = await f.prepare();
    expect((await f.serve(media.source)).status).toBe(502);
    expect(rawRequest).not.toHaveBeenCalled();
  });
}

test("forged and stopped public relay capabilities fail before any network request", async () => {
  const f = fixture();
  const media = await f.prepare();
  const repeated = await f.prepare();
  expect(media.source).not.toBe(repeated.source);
  f.current.add("other");
  await f.prepare(source, "other");
  f.requests.length = 0;
  const changed = new URL(media.source);
  changed.searchParams.set("url", "http://127.0.0.1/private");
  expect((await f.serve(changed.href)).status).toBe(404);
  expect((await f.serve(media.source.replace("/playlist/", "/bytes/"))).status).toBe(404);
  expect((await f.serve(media.source.replace("/playing/", "/other/"))).status).toBe(404);
  expect((await f.serve(media.source.replace("/playing/", "/foreign/"))).status).toBe(404);
  const originalSignature = new URL(media.source).pathname.split("/").at(-1)!;
  const repeatedId = new URL(repeated.source).pathname.split("/").at(-1)!.split("-", 1)[0]!;
  const swapped = media.source.replace(originalSignature, originalSignature.replace(/^[^-]+/, repeatedId));
  expect((await f.serve(swapped)).status).toBe(404);
  f.current.delete("playing");
  expect((await f.serve(media.source)).status).toBe(404);
  expect((await f.serve(repeated.source)).status).toBe(404);
  expect(f.requests).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("oversized public HLS bodies are bounded and cancelled before reaching a decoder", async () => {
  const f = fixture();
  let cancelled = 0, pulled = 0;
  f.replies.set(source, () => response(source, new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new TextEncoder().encode(`#EXTM3U\n${"#".repeat(64 * 1024)}`)); },
    cancel() { cancelled++; },
  }), { headers: { "Content-Type": "application/vnd.apple.mpegurl" } }));
  const media = await f.prepare();
  const prior = cancelled;
  const result = await f.serve(media.source);
  expect(result.status).toBe(502);
  expect(cancelled).toBeGreaterThan(prior);
  expect(pulled).toBeLessThan(140);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("a source's refusal is kept for its relay, so Core can report it", async () => {
  const f = fixture();
  const video = "https://media.example/video.mp4";
  f.replies.set(video, () => response(video, "", { status: 403 }));
  const media = await f.prepare(video);
  expect(f.relay.refused("playing", media.source)).toBeUndefined();
  expect((await f.serve(media.source)).status).toBe(403);
  expect(f.relay.refused("playing", media.source)).toBe(403);
  // The last answer stands: once the source answers again the refusal is forgotten, so a later failure keeps its own reason.
  f.replies.delete(video);
  expect((await f.serve(media.source)).status).toBe(200);
  expect(f.relay.refused("playing", media.source)).toBeUndefined();
});
