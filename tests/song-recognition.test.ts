import { expect, test } from "bun:test";
import { recognizeSong, SongRecognitionError } from "../src/server/song-recognition";

function audio(silence = false) {
  const pcm = Buffer.alloc(3 * 16000 * 2);
  if (!silence)
    for (let index = 0; index < pcm.length / 2; index++) {
      const t = index / 16000;
      pcm.writeInt16LE(
        Math.round(
          12000 * Math.sin(2 * Math.PI * (440 * t + 180 * t * t)) +
            5000 * Math.sin(2 * Math.PI * 1700 * t),
        ),
        index * 2,
      );
    }
  return pcm;
}
const sample = audio();
const signal = () => new AbortController().signal;
const match = {
  matches: [{ id: "123" }],
  track: {
    title: " I Will Survive ",
    subtitle: "Gloria Gaynor",
    sections: [{ metadata: [{ title: "Album", text: "Love Tracks" }] }],
    url: "https://www.shazam.com/track/53982678/i-will-survive",
    images: { coverarthq: "javascript:alert(1)" },
  },
};

test("one request sends a fingerprint, duration and empty location, returning only supported song metadata", async () => {
  let calls = 0;
  const track = await recognizeSong(sample, signal(), async (url, options) => {
    calls++;
    expect(url).toStartWith("https://amp.shazam.com/discovery/v5/en-US/US/iphone/-/tag/");
    expect(options.redirect).toBe("error");
    const body = JSON.parse(String(options.body));
    expect(Object.keys(body).sort()).toEqual([
      "context",
      "geolocation",
      "signature",
      "timestamp",
      "timezone",
    ]);
    expect(body.geolocation).toEqual({});
    expect(body.context).toEqual({});
    expect(String(options.body)).not.toContain(sample.toString("base64"));
    return Response.json({ ...match, privateProviderField: "discard this" });
  });
  expect(calls).toBe(1);
  expect(track).toEqual({
    title: "I Will Survive",
    artist: "Gloria Gaynor",
    album: "Love Tracks",
    provider: "shazam",
    url: match.track.url,
  });
});

test("authorization is checked again after fingerprinting yields and before contacting the service", async () => {
  let allowed = true,
    calls = 0;
  const reason = new Error("Device removed during fingerprinting");
  const result = recognizeSong(
    sample,
    signal(),
    async () => {
      calls++;
      return Response.json(match);
    },
    () => {
      if (!allowed) throw reason;
    },
  );
  allowed = false;
  await expect(result).rejects.toBe(reason);
  expect(calls).toBe(0);
});

test("provider bodies are bounded and private errors are kept out of responses", async () => {
  let canceled = false;
  await expect(
    recognizeSong(
      sample,
      signal(),
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024));
            },
            cancel() {
              canceled = true;
            },
          }),
        ),
    ),
  ).rejects.toMatchObject({ status: 502 });
  expect(canceled).toBe(true);
  for (const request of [
    async () => new Response("private provider response"),
    async () => {
      throw new Error("private network address");
    },
  ]) {
    try {
      await recognizeSong(sample, signal(), request);
      throw new Error("Expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(SongRecognitionError);
      expect((error as Error).message).not.toContain("private");
    }
  }
});

test("unsafe or unrelated service links are not exposed", async () => {
  for (const url of [
    "javascript:alert(1)",
    "https://shazam.com.attacker.invalid/song",
    "https://user:secret@www.shazam.com/track/1",
    "http://www.shazam.com/track/1",
  ]) {
    const track = await recognizeSong(sample, signal(), async () =>
      Response.json({ ...match, track: { ...match.track, url } }),
    );
    expect(track?.url).toBeUndefined();
  }
});
