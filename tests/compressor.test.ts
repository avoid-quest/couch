import { expect, test } from "bun:test";
import { compressorFilter, defaultCompressor, isCompressorPatch } from "../src/shared/compressor";
import { parseCommand } from "../src/server/validation";

test("compressor commands admit bounded partial edits and reject invalid DSP values", () => {
  const command = (settings: unknown) => JSON.stringify({ type: "command", requestId: "request", action: { type: "compressor", playbackId: "playing", settings } });
  expect(parseCommand(command({ enabled: true, threshold: -24, attack: 0.1 })).action).toEqual({ type: "compressor", playbackId: "playing", settings: { enabled: true, threshold: -24, attack: 0.1 } });
  for (const settings of [{}, null, [], { enabled: 1 }, { threshold: -61 }, { ratio: 21 }, { knee: 19 }, { attack: 0 }, { release: 1001 }, { gain: 13 }, { gain: "1,anull" }, { detector: "peak" }, { threshold: NaN }, { gain: Infinity }]) {
    expect(isCompressorPatch(settings)).toBe(false);
    expect(() => parseCommand(command(settings))).toThrow();
  }
});

test("the FFmpeg preset expresses threshold and knee in linear units without adding normalization or lookahead", () => {
  const filter = compressorFilter({ ...defaultCompressor, threshold: -20, knee: 0, gain: -3 });
  expect(filter).toContain("threshold=0.1:");
  expect(filter).toContain(":knee=1:");
  expect(filter).toContain(":link=maximum:makeup=1,volume=-3dB");
  expect(filter).not.toMatch(/dynaudnorm|loudnorm|alimiter/);
});
