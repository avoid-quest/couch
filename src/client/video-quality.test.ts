import { describe, expect, test } from "bun:test";
import { readVideoQuality, saveVideoQuality, videoQualityLabels } from "./video-quality";
import type { VideoQuality } from "../shared/providers";

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
