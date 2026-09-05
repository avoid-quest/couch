import { describe, expect, test } from "bun:test";
import { readVideoQuality, saveVideoQuality, supportsWebVideoQuality, videoQualityLabels } from "./video-quality";
import type { VideoQuality } from "../shared/providers";
import { audioExtensions } from "../shared/media";

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe("browser video quality preference", () => {
  test("each supported choice survives a new read without changing another browser", () => {
    const first = storage(), second = storage();
    for (const quality of Object.keys(videoQualityLabels) as VideoQuality[]) {
      saveVideoQuality(quality, first);
      expect(readVideoQuality(first)).toBe(quality);
      expect(readVideoQuality(second)).toBe("best");
    }
  });

  test("missing, obsolete and blocked storage fall back to best", () => {
    expect(readVideoQuality(storage())).toBe("best");
    for (const value of ["4k", "", "toString", "__proto__"]) expect(readVideoQuality({ getItem: () => value })).toBe("best");
    expect(readVideoQuality({ getItem: () => { throw new Error("blocked"); } })).toBe("best");
  });

  test("a denied write is reported instead of claiming persistence", () => {
    expect(() => saveVideoQuality("720p", { setItem: () => { throw new Error("blocked"); } })).toThrow("blocked");
  });
});

test("webpage quality excludes known audio-only links without matching other hosts", () => {
  for (const extension of audioExtensions) expect(supportsWebVideoQuality(`https://example.com/track.${extension.toUpperCase()}?download=1`)).toBe(false);
  for (const url of ["https://bandcamp.com/", "https://artist.bandcamp.com/track/song", "https://example.com/music/SONG.MP3?download=1", "https://example.com/track.flac"]) expect(supportsWebVideoQuality(url)).toBe(false);
  for (const url of ["https://youtube.com/watch?v=video", "https://notbandcamp.com/video", "https://bandcamp.com.example/video", "http://localhost/video.html", ""]) expect(supportsWebVideoQuality(url)).toBe(true);
});
