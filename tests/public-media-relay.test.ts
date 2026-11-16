import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createPassThrough } from "../src/server/pass-through";

const origin = "https://couch.local";
const target = { origin, userAgent: "Browser fixture" };
const source = "https://media.example/master.m3u8";
const credentials = {
  AuThOrIzAtIoN: "Bearer auth fixture",
  CoOkIe: "session=cookie-fixture",
  "PrOxY-AuThOrIzAtIoN": "Basic proxy fixture",
  "X-Api-Key": "api fixture",
  "x-AUTH-token": "token fixture",
};
const providerHeaders = {
  ...credentials,
  "user-agent": "Provider fixture",
  referer: "https://user:password@player.example/private-path?token=private#private-fragment",
};
const signal = () => AbortSignal.timeout(3000);
const rawRequest = spyOn(globalThis, "fetch");
beforeEach(() => {
  rawRequest.mockReset();
  rawRequest.mockRejectedValue(new Error("Public media used an unprotected request."));
});
afterAll(() => rawRequest.mockRestore());

// No CORS unless a test grants it: a Device can't read these itself, so Core relays them.
function response(url: string, body: BodyInit, init: ResponseInit = {}) {
  const result = new Response(body, init);
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function fixture() {
  const current = new Set(["playing"]);
  const replies = new Map<string, (init?: RequestInit) => Response>();
  const requests: Array<{ url: string; headers: Headers }> = [];
  const probes: Array<{ url: string; headers: Headers }> = [];
  // Only the pinned public-request boundary is synthetic. The production relay
  // chooses every route, rewrites each manifest and validates each capability.
  // A probe asks as the Device would, with its Origin; the relay never sends one.
  const publicRequest = (async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    (headers.has("origin") ? probes : requests).push({ url, headers });
    return (
      replies.get(url)?.(init) ??
      response(url, "bytes", { headers: { "Content-Type": "video/mp4" } })
    );
  }) as typeof fetch;
  const relay = createPassThrough((id) => current.has(id), publicRequest);
  const manifest = (url: string, text: string, type = "application/vnd.apple.mpegurl") =>
    replies.set(url, () => response(url, text, { headers: { "Content-Type": type } }));
  const prepare = (
    url = source,
    playbackId = "playing",
    destination = target,
    headers: Record<string, string> = {},
  ) =>
    relay.prepare(playbackId, { source: url, publicNetwork: true }, headers, destination, signal());
  const serve = (url: string, headers?: HeadersInit) => relay.serve(new Request(url, { headers }));
  return { relay, current, replies, requests, probes, manifest, prepare, serve };
}

function destination(value: string, kind: "playlist" | "bytes", upstream: string, base = origin) {
  const url = new URL(value);
  expect(url.origin).toBe(base);
  expect(url.pathname).toContain(`/api/relay/playing/${kind}/`);
  expect(url.searchParams.get("url")).toBe(upstream);
}

function sourceHeaders(headers: Headers, authorized: boolean) {
  for (const [name, value] of Object.entries(credentials))
    expect(headers.get(name)).toBe(authorized ? value : null);
  expect(headers.get("user-agent")).toBe(providerHeaders["user-agent"]);
  expect(headers.get("referer")).toBe(
    authorized ? providerHeaders.referer : "https://player.example/",
  );
  expect(headers.get("accept-encoding")).toBe("identity");
}

test("a public file a Device may read over HTTPS goes direct; plain HTTP stays relayed", async () => {
  const f = fixture();
  const video = "https://media.example/video.mp4",
    audio = "http://media.example/audio.m4a";
  const media = await f.relay.prepare(
    "playing",
    { source: video, audioSource: audio, publicNetwork: true },
    providerHeaders,
    target,
    signal(),
  );
  expect(media.source).toBe(video);
  destination(media.audioSource!, "bytes", audio);
  // Core asked as the Device would, through the pinned request, and never sent the provider's secrets.
  expect(f.probes.map((probe) => probe.url)).toEqual([video]);
  const asked = f.probes[0]!.headers;
  expect(asked.get("origin")).toBe(origin);
  expect(asked.get("user-agent")).toBe(target.userAgent);
  for (const name of [...Object.keys(credentials), "referer"]) expect(asked.has(name)).toBe(false);
  expect(f.relay.direct("playing", [media.source, media.audioSource])).toBe(true);
  expect(f.relay.direct("playing", [media.audioSource])).toBe(false);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public video and audio use protected relay even with permissive CORS and native playback", async () => {
  const f = fixture();
  const video = "https://media.example/video.mp4",
    audio = "https://media.example/audio.m4a";
  for (const url of [video, audio])
    f.replies.set(url, () =>
      response(url, "bytes", { headers: { "Access-Control-Allow-Origin": "*" } }),
    );
  const media = await f.relay.prepare(
    "playing",
    { source: video, audioSource: audio, publicNetwork: true, mpv: true },
    {},
    target,
    signal(),
  );
  destination(media.source, "bytes", video);
  destination(media.audioSource!, "bytes", audio);
  expect(f.requests).toHaveLength(0);
  expect(f.probes).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("a public file stays relayed when the Device can't read it, when it is a playlist, or for a relay-only target", async () => {
  const f = fixture();
  const refused = "https://media.example/refused.mp4",
    corsless = "https://media.example/corsless.ts",
    mislabelled = "https://media.example/stream";
  f.replies.set(refused, () => response(refused, "", { status: 403 }));
  f.replies.set(mislabelled, () =>
    response(mislabelled, "#EXTM3U\n#EXTINF:6,\nsegment.ts\n", {
      headers: { "Content-Type": "video/mp4", "Access-Control-Allow-Origin": "*" },
    }),
  );
  destination((await f.prepare(refused)).source, "bytes", refused);
  destination((await f.prepare(mislabelled)).source, "playlist", mislabelled);
  // A hop to http:// that Core would upgrade, but the Device would follow and block as mixed content.
  const downgraded = "https://media.example/downgraded.mp4";
  // publicFetch upgrades that hop unless asked to stop at the redirect.
  f.replies.set(downgraded, (init) =>
    init?.redirect === "manual"
      ? response(downgraded, "", {
          status: 302,
          headers: { Location: "http://media.example/video.mp4?requiressl=yes" },
        })
      : response("https://media.example/video.mp4?requiressl=yes", "bytes"),
  );
  destination((await f.prepare(downgraded)).source, "bytes", downgraded);
  expect(f.probes.map((probe) => probe.url)).not.toContain(
    "http://media.example/video.mp4?requiressl=yes",
  );
  // mpegts.js reads with CORS, and this source doesn't share it.
  const transport = await f.relay.prepare(
    "playing",
    { source: corsless, publicNetwork: true, mpegts: true },
    {},
    target,
    signal(),
  );
  destination(transport.source, "bytes", corsless);
  f.probes.length = 0;
  const video = "https://media.example/video.mp4";
  destination(
    (await f.prepare(video, "playing", { ...target, relay: true })).source,
    "bytes",
    video,
  );
  expect(f.probes).toHaveLength(0);
});

test("public segments go direct only from the probed HTTPS origin, and their playlists stay relayed", async () => {
  const f = fixture();
  const variant = "https://media.example/variant.m3u8";
  f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${variant}\n`);
  f.manifest(
    variant,
    [
      "#EXTM3U",
      '#EXT-X-MAP:URI="init.mp4"',
      "#EXTINF:6,",
      "https://cdn.example/1.ts",
      "#EXTINF:6,",
      "https://cdn.example/2.ts",
      "#EXTINF:6,",
      "https://other.example/3.ts",
      "",
    ].join("\n"),
  );
  f.replies.set("https://cdn.example/1.ts", () =>
    response("https://cdn.example/1.ts", "bytes", {
      headers: { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" },
    }),
  );
  const media = await f.prepare(source, "playing", target, providerHeaders);
  expect(f.probes).toHaveLength(0);
  const master = await (await f.serve(media.source)).text();
  const playlist = master.split("\n").find((line) => line && !line.startsWith("#"))!;
  destination(playlist, "playlist", variant);
  expect(f.relay.direct("playing", [media.source])).toBe(false);
  for (let reload = 0; reload < 2; reload++) {
    const text = await (await f.serve(playlist)).text();
    const children = [...text.matchAll(/URI="([^"]+)"/g)]
      .map((match) => match[1]!)
      .concat(text.split("\n").filter((line) => line && !line.startsWith("#")));
    destination(children[0]!, "bytes", "https://media.example/init.mp4");
    expect(children.slice(1, 3)).toEqual(["https://cdn.example/1.ts", "https://cdn.example/2.ts"]);
    destination(children[3]!, "bytes", "https://other.example/3.ts");
  }
  // One probe decides every reload of this route.
  expect(f.probes.map((probe) => probe.url)).toEqual(["https://cdn.example/1.ts"]);
  expect(f.relay.direct("playing", [media.source])).toBe(true);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public media cannot fall back to a raw URL when no protected destination is available", async () => {
  const f = fixture();
  await expect(
    f.relay.prepare("playing", { source, publicNetwork: true }, {}, null, signal()),
  ).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public master playlists protect relative, scheme-relative and rendition destinations", async () => {
  const f = fixture();
  f.manifest(
    source,
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="//audio.example/audio.m3u8"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",URI="subs/index.m3u8"',
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1000,URI="iframe.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"',
      "video/index.m3u8",
      "",
    ].join("\n"),
  );
  const media = await f.prepare();
  const result = await f.serve(media.source);
  expect(result.status).toBe(200);
  const text = await result.text();
  const attributes = [...text.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!);
  destination(attributes[0]!, "playlist", "https://audio.example/audio.m3u8");
  destination(attributes[1]!, "playlist", "https://media.example/subs/index.m3u8");
  destination(attributes[2]!, "playlist", "https://media.example/iframe.m3u8");
  destination(
    text.split("\n").find((line) => line && !line.startsWith("#"))!,
    "playlist",
    "https://media.example/video/index.m3u8",
  );
  expect(rawRequest).not.toHaveBeenCalled();
});

test("public media playlists protect keys, maps, low-latency parts and every segment", async () => {
  const f = fixture();
  f.manifest(
    source,
    [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/key"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-PART:DURATION=0.5,URI="parts/1.m4s"',
      '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="//cdn.example/parts/2.m4s"',
      '#EXT-X-RENDITION-REPORT:URI="other.m3u8",LAST-MSN=1',
      "#EXTINF:6,",
      "segments/1.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n"),
  );
  const media = await f.prepare();
  const result = await f.serve(media.source);
  const text = await result.text();
  expect(result.status).toBe(200);
  const attributes = [...text.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!);
  for (const [index, upstream] of [
    "https://keys.example/key",
    "https://media.example/init.mp4",
    "https://media.example/parts/1.m4s",
    "https://cdn.example/parts/2.m4s",
  ].entries()) {
    destination(attributes[index]!, "bytes", upstream);
  }
  destination(attributes[4]!, "playlist", "https://media.example/other.m3u8");
  const segment = text.split("\n").find((line) => line && !line.startsWith("#"))!;
  destination(segment, "bytes", "https://media.example/segments/1.ts");
  expect((await f.serve(segment)).status).toBe(200);
  expect(f.requests.at(-1)?.url).toBe("https://media.example/segments/1.ts");
  expect(rawRequest).not.toHaveBeenCalled();
});

for (const childOrigin of [
  "https://cdn.example",
  "http://media.example",
  "https://media.example:444",
]) {
  test(`HLS credentials remain on the source origin when children use ${childOrigin}`, async () => {
    const f = fixture();
    const local = "https://media.example/local.m3u8";
    const variant = `${childOrigin}/variant.m3u8`,
      rendition = `${childOrigin}/audio.m3u8`;
    f.manifest(
      source,
      `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="${rendition}"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${local}\n#EXT-X-STREAM-INF:BANDWIDTH=2000\n${variant}\n`,
    );
    for (const url of [local, variant, rendition])
      f.manifest(
        url,
        `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${childOrigin}/encryption.key"\n#EXT-X-MAP:URI="${childOrigin}/init.mp4"\n#EXT-X-PART:DURATION=0.5,URI="${childOrigin}/part.m4s"\n#EXTINF:6,\n${childOrigin}/segment.ts\n#EXTINF:6,\nhttps://media.example/local.ts\n`,
      );
    const media = await f.prepare(source, "playing", target, providerHeaders);
    const master = await f.serve(media.source);
    expect(master.status).toBe(200);
    sourceHeaders(f.requests.at(-1)!.headers, true);
    const text = await master.text();
    const playlists = [...text.matchAll(/URI="([^"]+)"/g)]
      .map((match) => match[1]!)
      .concat(text.split("\n").filter((line) => line && !line.startsWith("#")));
    expect(playlists).toHaveLength(3);
    for (const playlist of playlists) {
      const authorized =
        new URL(new URL(playlist).searchParams.get("url")!).origin === new URL(source).origin;
      const result = await f.serve(playlist);
      expect(result.status).toBe(200);
      sourceHeaders(f.requests.at(-1)!.headers, authorized);
      const body = await result.text();
      const children = [...body.matchAll(/URI="([^"]+)"/g)]
        .map((match) => match[1]!)
        .concat(body.split("\n").filter((line) => line && !line.startsWith("#")));
      expect(children).toHaveLength(5);
      for (const child of children) {
        expect((await f.serve(child)).status).toBe(200);
        sourceHeaders(
          f.requests.at(-1)!.headers,
          new URL(new URL(child).searchParams.get("url")!).origin === new URL(source).origin,
        );
      }
    }
    expect(rawRequest).not.toHaveBeenCalled();
  });
}

test("a redirected playlist resolves children at its effective URL without granting that origin credentials", async () => {
  const f = fixture();
  const effective = "https://redirected.example/path/master.m3u8";
  f.replies.set(source, () =>
    response(effective, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8\n", {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    }),
  );
  f.manifest("https://redirected.example/path/variant.m3u8", "#EXTM3U\n#EXTINF:6,\nsegment.ts\n");
  const media = await f.prepare(source, "playing", target, providerHeaders);
  const master = await f.serve(media.source);
  sourceHeaders(f.requests.at(-1)!.headers, true);
  const variant = (await master.text()).split("\n").find((line) => line && !line.startsWith("#"))!;
  destination(variant, "playlist", "https://redirected.example/path/variant.m3u8");
  const result = await f.serve(variant);
  sourceHeaders(f.requests.at(-1)!.headers, false);
  const segment = (await result.text()).split("\n").find((line) => line && !line.startsWith("#"))!;
  destination(segment, "bytes", "https://redirected.example/path/segment.ts");
  expect((await f.serve(segment)).status).toBe(200);
  sourceHeaders(f.requests.at(-1)!.headers, false);
  expect(rawRequest).not.toHaveBeenCalled();
});

for (const reference of [
  "file:///etc/passwd",
  "data:text/plain,private",
  "ftp://127.0.0.1/private",
  "tcp://127.0.0.1:1234",
  "https://user:password@media.example/private",
]) {
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
  "#EXT-X-KEY:METHOD=AES-128,URI=http://127.0.0.1/key",
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
  const swapped = media.source.replace(
    originalSignature,
    originalSignature.replace(/^[^-]+/, repeatedId),
  );
  expect((await f.serve(swapped)).status).toBe(404);
  f.current.delete("playing");
  expect((await f.serve(media.source)).status).toBe(404);
  expect((await f.serve(repeated.source)).status).toBe(404);
  expect(f.requests).toHaveLength(0);
  expect(rawRequest).not.toHaveBeenCalled();
});

test("oversized public HLS bodies are bounded and cancelled before reaching a decoder", async () => {
  const f = fixture();
  let cancelled = 0,
    pulled = 0;
  f.replies.set(source, () =>
    response(
      source,
      new ReadableStream({
        pull(controller) {
          pulled++;
          controller.enqueue(new TextEncoder().encode(`#EXTM3U\n${"#".repeat(64 * 1024)}`));
        },
        cancel() {
          cancelled++;
        },
      }),
      { headers: { "Content-Type": "application/vnd.apple.mpegurl" } },
    ),
  );
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

test("a capped live master offers only variants up to the chosen quality, and its audio only", async () => {
  const f = fixture();
  f.manifest(
    source,
    [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080",
      "1080p.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720",
      "720p.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=630000,RESOLUTION=640x360",
      "360p.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2"',
      "audio_only.m3u8",
      "",
    ].join("\n"),
  );
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, hlsMaxHeight: 720 },
    {},
    target,
    signal(),
  );
  const text = await (await f.serve(media.source)).text();
  const children = text
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line).searchParams.get("url"));
  expect(children).toEqual([
    "https://media.example/720p.m3u8",
    "https://media.example/360p.m3u8",
    "https://media.example/audio_only.m3u8",
  ]);
  expect(text).not.toContain("RESOLUTION=1920x1080");
});

test("every route of a Playback shares one read of each playlist: the master for the item, an endless one per refresh", async () => {
  const f = fixture();
  const variant = "https://media.example/720p.m3u8";
  f.manifest(
    source,
    `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720\n${variant}\n`,
  );
  f.manifest(
    variant,
    "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2,\nhttps://media.example/7.ts\n",
  );
  const screens = await Promise.all([
    f.prepare(source, "playing", target),
    f.prepare(source, "playing", { origin: "https://other.local", userAgent: "Browser fixture" }),
  ]);
  // Core's own read of the master, choosing its sound, is the same read.
  const core = await f.relay.reader("playing")(source, {}, true);
  expect(await core.text()).toContain(variant);
  const variants = await Promise.all(
    screens.map(async (media) =>
      (await (await f.serve(media.source)).text())
        .split("\n")
        .find((line) => line && !line.startsWith("#"))!,
    ),
  );
  const texts = await Promise.all(variants.map(async (link) => (await f.serve(link)).text()));
  expect(texts[0]).toContain("#EXT-X-MEDIA-SEQUENCE:7");
  expect(texts[1]).toContain("#EXT-X-MEDIA-SEQUENCE:7");
  expect(f.requests.map((request) => request.url)).toEqual([source, variant]);
});

test("a refused playlist renews the item once, and the links Core gave read the fresh resolution", async () => {
  const f = fixture();
  const fresh = "https://media.example/renewed/master.m3u8";
  const stale = "https://media.example/720p.m3u8?session=old";
  const renewed = "https://media.example/720p.m3u8?session=new";
  f.manifest(
    source,
    `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720\n${stale}\n`,
  );
  f.manifest(
    fresh,
    `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3100000,RESOLUTION=1280x720\n${renewed}\n`,
  );
  f.replies.set(stale, () => response(stale, "", { status: 403 }));
  f.manifest(renewed, "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttps://media.example/9.ts\n");
  let runs = 0;
  const renewal = {
    current: { source },
    renew: async () => {
      runs++;
      return { source: fresh };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const link = (await (await f.serve(media.source)).text())
    .split("\n")
    .find((line) => line && !line.startsWith("#"))!;
  destination(link, "playlist", stale);
  for (let reload = 0; reload < 2; reload++) {
    const answer = await f.serve(link);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("9.ts");
  }
  expect(runs).toBe(1);
  // A late screen still names the first resolution and reads the fresh one.
  const late = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const variant = (await (await f.serve(late.source)).text())
    .split("\n")
    .find((line) => line && !line.startsWith("#"))!;
  destination(variant, "playlist", renewed);
  expect(runs).toBe(1);
});

// The first relay link in a rewritten playlist, read through Core.
const firstLink = async (f: ReturnType<typeof fixture>, link: string) =>
  (await (await f.serve(link)).text()).split("\n").find((line) => line && !line.startsWith("#"))!;

test("a renewal reads a master whose address stayed the same afresh, with the renewed headers", async () => {
  const f = fixture();
  const stale = "https://media.example/720p.m3u8?sig=old";
  const renewed = "https://media.example/720p.m3u8?sig=new";
  f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${stale}\n`);
  f.replies.set(stale, () => response(stale, "", { status: 403 }));
  f.manifest(renewed, "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttps://media.example/9.ts\n");
  let runs = 0;
  const renewal = {
    current: { source },
    renew: async () => {
      runs++;
      f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${renewed}\n`);
      return { source, headers: { Cookie: "session=renewed" } };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    { Cookie: "session=old" },
    target,
    signal(),
  );
  const link = await firstLink(f, media.source);
  const answer = await f.serve(link);
  expect(answer.status).toBe(200);
  expect(await answer.text()).toContain("9.ts");
  expect(runs).toBe(1);
  const read = f.requests.findLast((request) => request.url === renewed)!;
  expect(read.headers.get("cookie")).toBe("session=renewed");
  // A late screen's own headers are the old ones; Core reads with the renewed ones.
  const late = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    { Cookie: "session=old" },
    target,
    signal(),
  );
  await f.serve(late.source);
  expect(f.requests.findLast((request) => request.url === source)!.headers.get("cookie")).toBe(
    "session=renewed",
  );
});

test("a finished playlist's refused segment renews the item and reads its renewed segment", async () => {
  const f = fixture();
  const variant = "https://media.example/vod.m3u8";
  const segments = (sig: string) =>
    `#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttps://media.example/1.ts?sig=${sig}\n#EXTINF:2,\nhttps://media.example/2.ts?sig=${sig}\n#EXT-X-ENDLIST\n`;
  f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${variant}\n`);
  f.manifest(variant, segments("old"));
  let runs = 0;
  const renewal = {
    current: { source },
    renew: async () => {
      runs++;
      f.manifest(variant, segments("new"));
      for (const index of [1, 2])
        f.replies.set(`https://media.example/${index}.ts?sig=old`, (init) =>
          response(String(index), "", { status: 403, headers: init?.headers as HeadersInit }),
        );
      return { source };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const segment = await firstLink(f, await firstLink(f, media.source));
  destination(segment, "bytes", "https://media.example/1.ts?sig=old");
  // Paused past expiry: the old links are refused now.
  f.replies.set("https://media.example/1.ts?sig=old", () =>
    response("https://media.example/1.ts?sig=old", "", { status: 403 }),
  );
  const answer = await f.serve(segment);
  expect(answer.status).toBe(200);
  expect(runs).toBe(1);
  expect(f.requests.at(-1)!.url).toBe("https://media.example/1.ts?sig=new");
});

test("an address renews the item once: a refused retry or an unchanged expiring address ends it", async () => {
  const f = fixture();
  const file = "https://media.example/video.mp4";
  f.replies.set(file, () => response(file, "", { status: 403 }));
  let runs = 0;
  const renewal = {
    current: { source: file },
    renew: async () => {
      runs++;
      return { source: file };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source: file, publicNetwork: true, renewal },
    {},
    { ...target, relay: true },
    signal(),
  );
  for (let request = 0; request < 3; request++)
    expect((await f.serve(media.source)).status).toBe(403);
  expect(runs).toBe(1);

  // An endless playlist whose own address expires within a minute, and a renewal that keeps it.
  const g = fixture();
  const expiring = `https://media.example/live.m3u8?expires=${Math.floor(Date.now() / 1000) + 30}`;
  g.manifest(
    expiring,
    "#EXTM3U\n#EXT-X-TARGETDURATION:0.002\n#EXTINF:2,\nhttps://media.example/1.ts\n",
  );
  let again = 0;
  const live = await g.relay.prepare(
    "playing",
    {
      source: expiring,
      publicNetwork: true,
      renewal: {
        current: { source: expiring },
        renew: async () => {
          again++;
          return { source: expiring };
        },
      },
    },
    {},
    target,
    signal(),
  );
  for (let reload = 0; reload < 4; reload++) {
    expect((await g.serve(live.source)).status).toBe(200);
    await Bun.sleep(5);
  }
  expect(again).toBe(1);
});

test("a 404 renews only when a fresh read repeats it", async () => {
  const f = fixture();
  let answers = 0;
  f.replies.set(source, () =>
    answers++
      ? response(source, "#EXTM3U\n#EXT-X-ENDLIST\n", {
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        })
      : response(source, "", { status: 404 }),
  );
  let runs = 0;
  const renewal = {
    current: { source },
    renew: async () => {
      runs++;
      return { source };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  expect((await f.serve(media.source)).status).toBe(200);
  expect(runs).toBe(0);
});

test("a failed renewal is tried once more; a spent one that's refused lets a later load resolve afresh", async () => {
  const f = fixture();
  const stale = "https://media.example/video.mp4?sig=old",
    fresh = "https://media.example/video.mp4?sig=new";
  f.replies.set(stale, () => response(stale, "", { status: 403 }));
  let runs = 0;
  const renewal: NonNullable<Parameters<typeof f.relay.prepare>[1]["renewal"]> = {
    current: { source: stale },
    renew: async () => {
      if (runs++ === 0) throw new Error("yt-dlp timed out");
      return { source: fresh };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source: stale, publicNetwork: true, renewal },
    {},
    { ...target, relay: true },
    signal(),
  );
  expect((await f.serve(media.source)).status).toBe(403);
  expect(renewal.spent).toBeFalsy();
  expect((await f.serve(media.source)).status).toBe(200);
  expect(runs).toBe(2);
  // The renewed link is refused too: the renewal is spent, and the item dead until resolved again.
  f.replies.set(fresh, () => response(fresh, "", { status: 403 }));
  expect((await f.serve(media.source)).status).toBe(403);
  expect(runs).toBe(3);
  expect((await f.serve(media.source)).status).toBe(403);
  expect(runs).toBe(3);
  expect(renewal.spent).toBe(true);
  expect(renewal.dead).toBe(true);
});

test("a finished playlist's refused init file or key renews the item and reads its renewed one", async () => {
  const f = fixture();
  const variant = "https://media.example/vod.m3u8";
  const segments = (sig: string) =>
    `#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="https://media.example/init.mp4?sig=${sig}"\n#EXT-X-KEY:METHOD=AES-128,URI="https://media.example/key?sig=${sig}"\n#EXTINF:2,\nhttps://media.example/1.m4s?sig=${sig}\n#EXT-X-ENDLIST\n`;
  f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${variant}\n`);
  f.manifest(variant, segments("old"));
  let runs = 0;
  const renewal = {
    current: { source },
    renew: async () => {
      runs++;
      f.manifest(variant, segments("new"));
      return { source };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const text = await (await f.serve(await firstLink(f, media.source))).text();
  const uris = [...text.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!);
  destination(uris[0]!, "bytes", "https://media.example/init.mp4?sig=old");
  destination(uris[1]!, "bytes", "https://media.example/key?sig=old");
  // A receiver joining after the links expired.
  for (const name of ["init.mp4", "key"])
    f.replies.set(`https://media.example/${name}?sig=old`, () =>
      response(`https://media.example/${name}?sig=old`, "", { status: 403 }),
    );
  expect((await f.serve(uris[0]!)).status).toBe(200);
  expect(f.requests.at(-1)!.url).toBe("https://media.example/init.mp4?sig=new");
  expect((await f.serve(uris[1]!)).status).toBe(200);
  expect(f.requests.at(-1)!.url).toBe("https://media.example/key?sig=new");
  expect(runs).toBe(1);
});

test("an endless stream renews on each expiry its segments answered between", async () => {
  const f = fixture();
  const live = (sig: string) => `https://media.example/live.m3u8?sig=${sig}`,
    segment = (sig: string) => `https://media.example/${sig}.ts?sig=${sig}`;
  const publish = (sig: string) => {
    f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${live(sig)}\n`);
    f.manifest(live(sig), `#EXTM3U\n#EXT-X-TARGETDURATION:0.002\n#EXTINF:2,\n${segment(sig)}\n`);
  };
  publish("a");
  const signatures = ["b", "c"];
  let runs = 0;
  const renewal: NonNullable<Parameters<typeof f.relay.prepare>[1]["renewal"]> = {
    current: { source },
    renew: async () => {
      publish(signatures[runs++]!);
      return { source };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const variant = await firstLink(f, media.source);
  for (const [index, sig] of ["a", "b"].entries()) {
    const link = await firstLink(f, variant);
    destination(link, "bytes", segment(sig));
    expect((await f.serve(link)).status).toBe(200);
    // Its link expired: the item renews, and the player's next playlist read names fresh segments.
    f.replies.set(segment(sig), () => response(segment(sig), "", { status: 403 }));
    expect((await f.serve(link)).status).toBe(403);
    expect(runs).toBe(index + 1);
    expect(renewal.spent).toBeFalsy();
    await Bun.sleep(5);
  }
  expect(await firstLink(f, variant)).toContain(encodeURIComponent(segment("c")));
});

test("an endless stream whose renewed segments are refused too spends its renewal", async () => {
  const f = fixture();
  const live = (sig: string) => `https://media.example/live.m3u8?sig=${sig}`,
    segment = (sig: string, index: number) => `https://media.example/${index}.ts?sig=${sig}`;
  const publish = (sig: string) => {
    f.manifest(source, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3300000\n${live(sig)}\n`);
    f.manifest(
      live(sig),
      `#EXTM3U\n#EXT-X-TARGETDURATION:0.002\n#EXTINF:2,\n${segment(sig, 1)}\n#EXTINF:2,\n${segment(sig, 2)}\n`,
    );
    // The playlist answers, and every segment is refused for a reason a renewal doesn't cure.
    for (const index of [1, 2])
      f.replies.set(segment(sig, index), () => response(segment(sig, index), "", { status: 403 }));
  };
  publish("a");
  let runs = 0;
  const renewal: NonNullable<Parameters<typeof f.relay.prepare>[1]["renewal"]> = {
    current: { source },
    renew: async () => {
      publish(`r${++runs}`);
      return { source };
    },
  };
  const media = await f.relay.prepare(
    "playing",
    { source, publicNetwork: true, renewal },
    {},
    target,
    signal(),
  );
  const variant = await firstLink(f, media.source);
  const links = async () =>
    (await (await f.serve(variant)).text())
      .split("\n")
      .filter((line) => line && !line.startsWith("#"));
  const [first, second] = await links();
  expect((await f.serve(first!)).status).toBe(403);
  expect(runs).toBe(1);
  // A segment the player read before the renewal is passed on refused; it doesn't renew again.
  expect((await f.serve(second!)).status).toBe(403);
  expect(runs).toBe(1);
  expect(renewal.spent).toBeFalsy();
  // One the renewed playlist named is refused too: the renewal is spent.
  await Bun.sleep(5);
  for (const link of await links()) {
    expect((await f.serve(link)).status).toBe(403);
    expect(runs).toBe(1);
    expect(renewal.spent).toBe(true);
  }
});
