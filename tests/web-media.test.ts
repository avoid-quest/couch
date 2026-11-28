import { expect, spyOn, test } from "bun:test";
import * as network from "../src/server/public-network";
import { createWebMediaResolver, parseMedia, videoQualities } from "../src/server/web-media";
import * as extractor from "../src/server/yt-dlp";
import { videoQualityOffers } from "../src/client/video-quality";

// StreamingCommunity's plugin returns a video and an audio rendition of one HLS master (#700).
test("a split m3u8 pair from one master plays the master capped, with no separate sound", () => {
  const master = "https://vixcloud.example/playlist/206473?token=t&expires=1";
  const rendition = (type: string) => ({
    protocol: "m3u8_native",
    manifest_url: master,
    url: `https://vixcloud.example/playlist/206473?type=${type}&rendition=x`,
  });
  const media = parseMedia(
    {
      requested_formats: [
        { ...rendition("video"), vcodec: "avc1", acodec: "none", height: 480 },
        { ...rendition("audio"), vcodec: "none", acodec: "mp4a" },
      ],
    },
    "",
  );
  expect(media.source).toBe(master);
  expect(media.hls).toBe(true);
  expect(media.audioSource).toBeUndefined();
  expect(media.hlsMaxHeight).toBe(480);
});

test("an extensionless selected HLS transport keeps its protocol", () => {
  expect(
    parseMedia(
      {
        url: "https://media.example/playlist?token=fixture",
        protocol: "m3u8_native",
        vcodec: "avc1",
        acodec: "aac",
      },
      "",
    ).hls,
  ).toBe(true);
  expect(
    parseMedia(
      {
        url: "https://media.example/file",
        protocol: "https",
        vcodec: "avc1",
        formats: [{ protocol: "m3u8_native" }],
      },
      "",
    ).hls,
  ).toBeUndefined();
});

// Twitch: one muxed variant of a master that also offers smaller ones and audio only.
test("an HLS variant plays its master, capped at the chosen variant's height", () => {
  const master = "https://usher.example/channel.m3u8?token=t";
  const stream = {
    protocol: "m3u8_native",
    manifest_url: master,
    url: "https://playlist.example/v1/1080p60.m3u8",
    vcodec: "avc1",
    acodec: "mp4a",
    height: 1080,
  };
  for (const is_live of [true, false]) {
    const media = parseMedia({ ...stream, is_live }, "");
    expect(media.source).toBe(master);
    expect(media.hlsMaxHeight).toBe(1080);
  }
  expect(parseMedia({ ...stream, extractor: "youtube" }, "").source).toBe(stream.url);
  expect(parseMedia({ ...stream, protocol: "https" }, "").source).toBe(stream.url);
  // Without a height the master couldn't keep the chosen quality.
  const { height: _, ...unsized } = stream;
  expect(parseMedia(unsized, "").source).toBe(stream.url);
});

test("an endless HLS variant that refuses playback renews from the master it fell back to", async () => {
  const master = "https://media.example/master.m3u8";
  const stream = {
    is_live: true,
    protocol: "m3u8_native",
    url: "https://media.example/selected.m3u8",
    manifest_url: master,
    vcodec: "avc1",
    acodec: "mp4a",
  };
  const extract = spyOn(extractor, "resolveWithYtDlp").mockImplementation(
    (_args, _options, _provider, accept) => accept(JSON.stringify(stream)),
  );
  const request = spyOn(network, "publicFetch").mockResolvedValue(
    new Response(null, { status: 403 }),
  );
  try {
    const media = await createWebMediaResolver()("https://media.example/concert");
    expect(media.source).toBe(master);
    expect(media.renewal?.current.source).toBe(master);
  } finally {
    request.mockRestore();
    extract.mockRestore();
  }
});

// Each choice is named by what the source has: Twitch's top is 1080p60 and nothing reaches 1080p but it.
test("quality choices are named by the heights a source offers", () => {
  const twitch = {
    formats: [
      { format_id: "audio_only", protocol: "m3u8_native", vcodec: "none" },
      ...[
        [160, 30],
        [360, 30],
        [480, 30],
        [720, 60],
        [1080, 60],
      ].map(([height, fps]) => ({ protocol: "m3u8_native", vcodec: "avc1", height, fps })),
    ],
  };
  const selected = { vcodec: "avc1", height: 1080, fps: 60 };
  expect(videoQualities({ ...twitch, ...selected }, false, true, "best")).toEqual({
    best: "1080p60",
    "1080p": "1080p60",
    "720p": "720p60",
    "480p": "480p",
  });
  // YouTube caps the smaller side; a Device without VP9 reaches only H.264, and DASH never plays.
  const youtube = {
    formats: [
      { protocol: "https", vcodec: "vp9", width: 3840, height: 2160 },
      { protocol: "https", vcodec: "avc1.640028", width: 1920, height: 1080, fps: 30 },
      { protocol: "https", vcodec: "avc1.4d401f", width: 1080, height: 1920 },
      { protocol: "http_dash_segments", vcodec: "avc1", width: 7680, height: 4320 },
    ],
  };
  expect(videoQualities(youtube, true, true, "480p")?.best).toBe("2160p");
  expect(videoQualities(youtube, true, false, "480p")).toEqual({
    best: "1080p",
    "1080p": "1080p",
    "720p": "1080p",
    "480p": undefined,
  });
  // Off YouTube a site's language outranks size, as in yt-dlp: a dub plays only when nothing else does.
  // A site's quality ranks first only at Best, so a cap can play a Twitch clip's portrait copy
  // (quality -2) when it is the closest size.
  const clip = (height: number, extra = {}) => ({
    protocol: "https",
    vcodec: "avc1",
    acodec: "mp4a",
    height,
    ...extra,
  });
  expect(
    videoQualities(
      {
        ...clip(1080, { quality: -2 }),
        formats: [
          clip(720),
          clip(360),
          clip(1080, { quality: -2 }),
          clip(480, { quality: -2 }),
          clip(2160, { language_preference: -10 }),
        ],
      },
      false,
      true,
      "1080p",
    ),
  ).toEqual({ best: "720p", "1080p": "1080p", "720p": "720p", "480p": "480p" });
  // Twitch ranks its Source rendition first (quality 10), yet each cap names the rung under it, and a
  // dub plays under the cap before an original above it.
  const source = (height: number, fps: number, extra = {}) => ({
    protocol: "m3u8_native",
    vcodec: "avc1",
    height,
    fps,
    ...extra,
  });
  expect(
    videoQualities(
      {
        ...source(1440, 60),
        formats: [
          { protocol: "m3u8_native", vcodec: "none", acodec: "mp4a" },
          source(1440, 60, { quality: 10 }),
          source(1080, 60),
          source(720, 60),
          source(480, 30),
        ],
      },
      false,
      true,
      "best",
    ),
  ).toEqual({ best: "1440p60", "1080p": "1080p60", "720p": "720p60", "480p": "480p" });
  // With nothing under the cap, the closest transcode plays before Source.
  expect(
    videoQualities(
      {
        ...source(720, 60),
        formats: [source(1440, 60, { quality: 10 }), source(1080, 60), source(720, 60)],
      },
      false,
      true,
      "480p",
    ),
  ).toEqual({ best: "1440p60", "1080p": "1080p60", "720p": "720p60", "480p": "720p60" });
  // Best ranks the smaller side, as yt-dlp does: landscape 1080p over a portrait 720×1280.
  const sized = (width: number, height: number) => ({ ...clip(height), width });
  expect(
    videoQualities(
      { ...sized(1920, 1080), formats: [sized(720, 1280), sized(1920, 1080)] },
      false,
      true,
      "best",
    ),
  ).toEqual({ best: "1080p", "1080p": "1080p", "720p": "1080p", "480p": "1080p" });
  // A websocket stream never plays, however a site ranks it.
  expect(
    videoQualities(
      {
        ...clip(720),
        formats: [clip(1080, { protocol: "websocket_frag", quality: 2 }), clip(720)],
      },
      false,
      true,
      "1080p",
    )?.best,
  ).toBe("720p");
  expect(
    videoQualities(
      { ...clip(480), formats: [clip(1080, { language_preference: 10 }), clip(480)] },
      false,
      true,
      "480p",
    )?.["480p"],
  ).toBe("480p");
  // A fixed file names no size, so it offers no choice.
  expect(
    videoQualities({ formats: [{ protocol: "https", vcodec: "avc1" }] }, false, true, "1080p"),
  ).toBe(undefined);
});

test("the current choice is named by the format yt-dlp selected", () => {
  // Without a separate sound, a video-only 1080p60 can't play: 720p muxed is what every choice gets.
  const info = {
    formats: [
      { protocol: "https", vcodec: "avc1", acodec: "none", height: 1080, fps: 60 },
      { protocol: "https", vcodec: "avc1", acodec: "mp4a", height: 720, fps: 30 },
    ],
  };
  expect(videoQualities(info, false, true, "480p")?.best).toBe("720p");
  // yt-dlp's choice (a dropped format, an extractor's own ranking) outranks the prediction.
  const twitch = {
    formats: [
      { protocol: "m3u8_native", vcodec: "avc1", height: 1080, fps: 60 },
      { protocol: "m3u8_native", vcodec: "avc1", height: 720, fps: 60 },
    ],
  };
  expect(
    videoQualities({ ...twitch, vcodec: "avc1", height: 720, fps: 60 }, false, true, "1080p"),
  ).toEqual({ best: "1080p60", "1080p": "720p60", "720p": "720p60", "480p": "720p60" });
  // A selection without a size leaves its choice unnamed.
  expect(videoQualities({ ...twitch, vcodec: "avc1" }, false, true, "720p")).toEqual({
    best: "1080p60",
    "1080p": "1080p60",
    "480p": "720p60",
  });
});

test("the player offers each picture once, as its strictest choice", () => {
  // YouTube with 1440p and 720p: 1080p and 720p both play 720p, and only 720p keeps it.
  const labels = { best: "1440p", "1080p": "720p", "720p": "720p", "480p": "720p" };
  expect(videoQualityOffers(labels, "auto")).toEqual({
    options: [
      { value: "best", label: "1440p" },
      { value: "480p", label: "720p" },
    ],
    value: "480p",
    label: "720p",
  });
  // An unnamed current choice keeps the others and checks none of them.
  expect(videoQualityOffers({ best: "1080p60", "480p": "720p60" }, "720p")).toEqual({
    options: [
      { value: "best", label: "1080p60" },
      { value: "480p", label: "720p60" },
    ],
    value: "720p",
    label: "",
  });
});
