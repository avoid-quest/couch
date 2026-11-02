import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import {
  audioInput,
  createSourcePreparation,
  prepareSource,
} from "../src/server/source-preparation";
import { createPassThrough } from "../src/server/pass-through";

const request = spyOn(globalThis, "fetch");
beforeEach(() => request.mockReset());
afterAll(() => request.mockRestore());
const signal = () => AbortSignal.timeout(3000);
const channels = { picture: false, sound: true };
const audioChoices = [
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="en.m3u8"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="Italian",LANGUAGE="it",DEFAULT=NO,AUTOSELECT=YES,URI="https://audio.example/it.m3u8"',
];
const master = [
  "#EXTM3U",
  ...audioChoices,
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,AUDIO="aac",CODECS="avc1.640028,mp4a.40.2"',
  "video.m3u8",
  "",
].join("\n");
const manifest = (text: string) =>
  new Response(text, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });

test("sound-only preparation and protected delivery never fetch a separate video rendition", async () => {
  const media = {
    source: "https://video.example/video.mp4",
    audioSource: "https://audio.example/audio.m4a",
    publicNetwork: true,
  };
  const selected = await prepareSource(media, channels, signal());
  const fetched: string[] = [],
    sent: Headers[] = [];
  const relay = createPassThrough(() => true, (async (url, init) => {
    fetched.push(String(url));
    sent.push(new Headers(init?.headers));
    return new Response("audio", { headers: { "Content-Type": "audio/mp4" } });
  }) as typeof fetch);
  const routed = await relay.prepare(
    "playing",
    selected,
    { authorization: "Bearer video-only", referer: "https://player.example/watch" },
    { origin: "https://couch.example", userAgent: "Test" },
    signal(),
  );
  expect(routed.audioSource).toBeUndefined();
  expect(new URL(routed.source).searchParams.get("url")).toBe(media.audioSource);
  await relay.serve(new Request(routed.source));
  expect(fetched.every((url) => url === media.audioSource)).toBe(true);
  expect(sent.at(-1)!.has("authorization")).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await prepareSource(media, { picture: true, sound: true }, signal())).toBe(media);
  await relay.close();
});

test("YouTube sound-only keeps its checked original audio instead of reopening the dubbed master", async () => {
  const hlsSelection = {
    video: "https://manifest.example/video/index.m3u8",
    audio: "https://manifest.example/original/index.m3u8",
    bandwidth: 900000,
  };
  const selected = await prepareSource(
    { source: "https://manifest.example/master.m3u8", hls: true, hlsSelection },
    channels,
    signal(),
  );
  expect(selected).toMatchObject({
    source: hlsSelection.audio,
    hls: true,
    hlsSelection: undefined,
  });
  expect(request).not.toHaveBeenCalled();
});

test("HLS sound-only selects its single audio rendition with one manifest read and no video read", async () => {
  request.mockResolvedValue(
    new Response(
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",DEFAULT=YES,URI="main.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="audio",CODECS="avc1.640028,mp4a.40.2"\nvideo.m3u8\n',
      { headers: { "Content-Type": "application/vnd.apple.mpegurl" } },
    ),
  );
  const media = { source: "https://media.example/master.m3u8", hls: true };
  const selected = await prepareSource(media, channels, signal());
  expect(selected.source).toBe("https://media.example/main.m3u8");
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]![0])).toBe(media.source);
});

test("audio-only HLS retains the language choices and classifies only audio without replacing the cached master", async () => {
  const source = "https://media.example/master.m3u8";
  request.mockImplementation(async (url) =>
    manifest(String(url) === source ? master : "#EXTM3U\n#EXTINF:2,\naudio.aac\n"),
  );
  const preparation = createSourcePreparation(signal());
  const selected = await preparation.select({ source }, channels);
  expect(selected.source).toBe(source);
  expect(
    selected.audioManifest?.text.split("\n").filter((line) => line.startsWith("#EXT-X-MEDIA:")),
  ).toEqual(audioChoices);
  expect(selected.audioManifest?.text).toContain('CODECS="mp4a.40.2",AUDIO="aac"');
  expect(selected.audioManifest?.text).not.toMatch(/video|avc1|RESOLUTION/);
  expect(await preparation.live(selected.source, selected)).toBe(true);
  expect((await preparation.select({ source }, channels)).audioManifest).toEqual(
    selected.audioManifest,
  );
  expect(await preparation.live(selected.source, selected)).toBe(true);
  expect(request.mock.calls.map((call) => String(call[0]))).toEqual([
    source,
    "https://media.example/en.m3u8",
  ]);
  await createSourcePreparation(signal()).select({ source }, channels);
  expect(request).toHaveBeenCalledTimes(3);
});

test("mixed in-band and separate audio keeps its master and language menu", async () => {
  request.mockResolvedValue(manifest(master.replace(',URI="en.m3u8"', "")));
  const selected = await prepareSource(
    { source: "https://media.example/master.m3u8" },
    channels,
    signal(),
  );
  expect(selected.source).toBe("https://media.example/master.m3u8");
  expect(selected.audioManifest).toBeUndefined();
});

test("synthetic classification uses redirected audio destinations without granting source credentials", async () => {
  const source = "https://media.example/master.m3u8",
    effective = "https://redirected.example/path/master.m3u8";
  request.mockImplementation(async (url) => {
    const result = manifest(
      String(url) === source ? master : "#EXTM3U\n#EXTINF:2,\naudio.aac\n#EXT-X-ENDLIST\n",
    );
    if (String(url) === source) Object.defineProperty(result, "url", { value: effective });
    return result;
  });
  const preparation = createSourcePreparation(signal());
  const selected = await preparation.select(
    { source, headers: { authorization: "Bearer source-fixture", cookie: "fixture=1" } },
    channels,
  );
  expect(selected.audioManifest?.url).toBe(effective);
  expect(await preparation.live(selected.source, selected)).toBe(false);
  expect(request.mock.calls.map((call) => String(call[0]))).toEqual([
    source,
    "https://redirected.example/path/en.m3u8",
  ]);
  const sent = new Headers(request.mock.calls[1]![1]?.headers);
  expect(sent.has("authorization")).toBe(false);
  expect(sent.has("cookie")).toBe(false);
});

test("synthetic HLS protects every audio choice and child with playback signatures and origin-scoped credentials", async () => {
  const source = "https://media.example/master.m3u8";
  request.mockResolvedValue(manifest(master));
  const selected = await prepareSource({ source }, channels, signal());
  request.mockReset();
  request.mockRejectedValue(new Error("Protected media used raw fetch."));
  const fetched: Array<{ url: string; headers: Headers }> = [];
  let active = true;
  const relay = createPassThrough((id) => active && id === "playing", (async (url, init) => {
    fetched.push({ url: String(url), headers: new Headers(init?.headers) });
    if (String(url).endsWith(".m3u8"))
      return manifest("#EXTM3U\n#EXTINF:2,\nsegment.aac\n#EXT-X-ENDLIST\n");
    return new Response("audio", {
      status: 206,
      headers: { "Content-Type": "audio/aac", "Content-Range": "bytes 0-4/5" },
    });
  }) as typeof fetch);
  try {
    const routed = await relay.prepare(
      "playing",
      { ...selected, publicNetwork: true },
      {
        authorization: "Bearer fixture",
        cookie: "fixture=1",
        referer: "https://player.example/watch",
      },
      { origin: "https://couch.example", userAgent: "Browser fixture" },
      signal(),
    );
    expect(routed.audioManifest).toBeUndefined();
    expect(fetched).toHaveLength(0);
    const response = await relay.serve(new Request(routed.source));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("video");
    const choices = [...text.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!);
    expect(choices).toHaveLength(2);
    expect(choices.map((uri) => new URL(uri).searchParams.get("url"))).toEqual([
      "https://media.example/en.m3u8",
      "https://audio.example/it.m3u8",
    ]);
    expect(text.split("\n").find((line) => line && !line.startsWith("#"))).toBe(choices[0]);
    for (const [index, choice] of choices.entries()) {
      expect(new URL(choice).origin).toBe("https://couch.example");
      const child = await relay.serve(new Request(choice));
      expect(child.status).toBe(200);
      expect(fetched.at(-1)!.headers.has("authorization")).toBe(index === 0);
      expect(fetched.at(-1)!.headers.has("cookie")).toBe(index === 0);
      const segment = (await child.text())
        .split("\n")
        .find((line) => line && !line.startsWith("#"))!;
      expect(new URL(segment).pathname).toContain("/api/relay/playing/bytes/");
      expect((await relay.serve(new Request(segment))).status).toBe(206);
      expect(fetched.at(-1)!.headers.has("authorization")).toBe(index === 0);
    }
    const count = fetched.length;
    const tampered = new URL(choices[0]!);
    tampered.searchParams.set("url", "https://media.example/video.m3u8");
    expect((await relay.serve(new Request(tampered.href))).status).toBe(404);
    active = false;
    expect((await relay.serve(new Request(routed.source))).status).toBe(404);
    expect(fetched).toHaveLength(count);
    expect(fetched.some((read) => /master|video/.test(read.url))).toBe(false);
    expect(request).not.toHaveBeenCalled();
  } finally {
    await relay.close();
  }
});

test("classification keeps selected-rendition credentials on their original origin", async () => {
  request.mockResolvedValue(
    new Response("#EXTM3U\n#EXTINF:2,\naudio.aac\n", {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    }),
  );
  const source = {
    source: "https://video.example/movie",
    audioSource: "https://audio.example/live",
    headers: { authorization: "Bearer video-only", referer: "https://player.example/" },
  };
  const preparation = createSourcePreparation(signal());
  const selected = await preparation.select(source, channels);
  expect(await preparation.live(selected.source, selected)).toBe(true);
  const sent = new Headers(request.mock.calls[0]![1]?.headers);
  expect(sent.has("authorization")).toBe(false);
  expect(sent.get("referer")).toBe("https://player.example/");
});

test("a selected HLS rendition cannot introduce a non-HTTP source or embedded credentials", async () => {
  for (const uri of ["file:///private", "https://user:password@media.example/audio.m3u8"]) {
    request.mockResolvedValueOnce(
      new Response(
        `#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="${uri}"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="a"\nvideo.m3u8\n`,
        { headers: { "Content-Type": "application/vnd.apple.mpegurl" } },
      ),
    );
    await expect(
      prepareSource({ source: "https://media.example/master.m3u8" }, channels, signal()),
    ).rejects.toThrow("unsupported destination");
  }
});

for (const [selection, language, stream] of [
  [{ audioTrack: 1, audioLanguage: "en" }, "it", 0],
  [{ audioLanguage: "it-IT" }, "it", 0],
  [
    {
      audioSelection: { index: 1, label: "English", language: "en" },
      audioTrack: 1,
      audioLanguage: "it",
    },
    "en",
    0,
  ],
] as const)
  test(`scheduled HLS selection ${JSON.stringify(selection)} decodes ${language}`, async () => {
    request.mockResolvedValue(manifest(master));
    const selected = await audioInput(
      "https://media.example/master.m3u8",
      {},
      signal(),
      false,
      true,
      undefined,
      selection,
    );
    expect(selected.source).toBe(
      language === "it" ? "https://audio.example/it.m3u8" : "https://media.example/en.m3u8",
    );
    expect(selected.audioStream).toBe(stream);
    expect(selected.audioSelection).toEqual({
      index: language === "it" ? 1 : 0,
      label: language === "it" ? "Italian" : "English",
      language,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

test("muxed ordinary input retains the selected audio ordinal instead of always decoding its first stream", async () => {
  request.mockResolvedValue(new Response("media", { headers: { "Content-Type": "video/mp4" } }));
  const audioSelection = { index: 1, label: "Italian", language: "it" };
  const selected = await audioInput(
    "https://media.example/movie.mp4",
    {},
    signal(),
    false,
    true,
    undefined,
    { audioSelection, audioLanguage: "en" },
  );
  expect(selected.source).toBe("https://media.example/movie.mp4");
  expect(selected.audioStream).toBe(1);
  expect(selected.audioSelection).toEqual(audioSelection);
});

test("playlist sniffing retains its size limit and public destination guard", async () => {
  let cancelled = false;
  request.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("#EXTM3U\n" + "a".repeat(2 * 1024 * 1024)));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "application/octet-stream" } },
    ),
  );
  await expect(
    prepareSource({ source: "https://media.example/stream" }, channels, signal()),
  ).rejects.toThrow("size limit");
  expect(cancelled).toBe(true);
  request.mockClear();
  expect(
    (
      await prepareSource(
        { source: "http://127.0.0.1/stream", publicNetwork: true },
        channels,
        signal(),
      )
    ).hls,
  ).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
