import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fixture from "./fixtures/youtube-storyboard.json";
import {
  createPreviewImages,
  playbackPreviewResponse,
  previewImageLimit,
  storyboardPreview,
} from "../src/server/playback-preview";
import { previewAt } from "../src/shared/playback-preview";
import { parseMedia } from "../src/server/web-media";

const source = () => storyboardPreview(structuredClone(fixture))!;
const request = (image?: string) =>
  new Request(
    `https://couch.test/api/playback-preview?playbackId=one${image === undefined ? "" : `&image=${image}`}`,
  );
const paired = () => {};
const sheet = readFileSync(new URL("./fixtures/preview-sheet.png", import.meta.url));
const picture = () => new Response(sheet, { headers: { "content-type": "image/png" } });

test("storyboards are a source capability; YouTube and Twitch partial sheets retain their frame timing", () => {
  const preview = source().metadata;
  expect(preview).toMatchObject({
    kind: "grid",
    width: 160,
    height: 90,
    columns: 5,
    rows: 5,
    interval: 4.95,
    duration: 693,
    images: 6,
  });
  expect(
    [0, 123.74, 123.75, 618.75, 693, 1000].map((time) => previewAt(preview, time)?.image),
  ).toEqual([0, 0, 1, 5, 5, 5]);
  const twitch = structuredClone(fixture);
  twitch.extractor = "twitch:vod";
  for (const format of twitch.formats)
    for (const fragment of format.fragments) {
      fragment.url = fragment.url.replace("i.ytimg.com", "static-cdn.jtvnw.net");
      fragment.duration = twitch.duration / format.fragments.length;
    }
  expect(storyboardPreview(twitch)?.metadata).toEqual(preview);
  const media = {
    ...fixture,
    url: "https://video.example/movie.mp4",
    protocol: "https",
    vcodec: "avc1",
  };
  // Selecting sound from a video does not discard its programme previews.
  expect(parseMedia({ ...media, vcodec: "none" }, "").preview?.metadata).toEqual(preview);
});

test("missing, live, malformed and private metadata never prevents valid playback", () => {
  for (const change of [{ formats: undefined }, { is_live: true }, { duration: NaN }])
    expect(storyboardPreview({ ...fixture, ...change })).toBeUndefined();
  for (const change of [{ width: -1 }, { columns: 1000 }, { fps: 0 }])
    expect(
      storyboardPreview({ ...fixture, formats: [{ ...fixture.formats[0], ...change }] }),
    ).toBeUndefined();
  for (const url of ["file:///tmp/private", "https://user:pass@images.example/x"]) {
    const bad = structuredClone(fixture);
    bad.formats[0]!.fragments[0]!.url = url;
    expect(storyboardPreview(bad)).toBeUndefined();
  }
  const formats = [{ ...fixture.formats[0], width: { toString: null } }, ...fixture.formats];
  expect(
    parseMedia(
      {
        ...fixture,
        formats,
        url: "https://video.example/movie.mp4",
        vcodec: "avc1",
        protocol: "https",
      },
      "",
    ).source,
  ).toBe("https://video.example/movie.mp4");
});

test("metadata hides private descriptors; absent or unauthorized sources do no image work", async () => {
  const response = await playbackPreviewResponse(request(), async () => source(), paired);
  expect(await response.json()).toEqual(source().metadata);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await playbackPreviewResponse(request(), async () => undefined, paired)).status).toBe(
    204,
  );
  let read = false;
  const denied = () => {
    throw new Error("No permission");
  };
  expect(
    (
      await playbackPreviewResponse(
        request("0"),
        async () => {
          read = true;
          return source();
        },
        denied,
      )
    ).status,
  ).toBe(404);
  expect(read).toBe(false);
  expect((await playbackPreviewResponse(request("99"), async () => source(), paired)).status).toBe(
    404,
  );
});

test("image reads deduplicate and enforce byte, raster dimension and signature limits", async () => {
  let calls = 0;
  const read = createPreviewImages((async () => {
    calls++;
    return picture();
  }) as typeof fetch);
  const a = await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(a.status).toBe(200);
  expect(a.headers.get("content-type")).toBe("image/png");
  await playbackPreviewResponse(request("0"), async () => source(), paired, read);
  expect(calls).toBe(1);
  const large = Buffer.from(sheet);
  large.writeUInt32BE(8192, 16);
  large.writeUInt32BE(8192, 20);
  for (const [type, bytes] of [
    ["image/svg+xml", new TextEncoder().encode("<svg></svg>")],
    ["image/jpeg", new Uint8Array(previewImageLimit + 1)],
    ["image/png", large],
    ["image/jpeg", new TextEncoder().encode("NOT AN IMAGE")],
  ] as const) {
    const read = createPreviewImages(
      (async () => new Response(bytes, { headers: { "content-type": type } })) as typeof fetch,
    );
    expect(
      (await playbackPreviewResponse(request("0"), async () => source(), paired, read)).status,
    ).not.toBe(200);
  }
});
