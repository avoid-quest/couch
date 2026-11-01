import { expect, test } from "bun:test";
import { isCompressorPatch } from "../src/shared/compressor";
import { parseCommand } from "../src/server/validation";

test("compressor commands admit bounded partial edits and reject invalid DSP values", () => {
  const command = (settings: unknown) => JSON.stringify({ type: "command", requestId: "request", action: { type: "compressor", playbackId: "playing", settings } });
  expect(parseCommand(command({ enabled: true, threshold: -24, attack: 0.1 })).action).toEqual({ type: "compressor", playbackId: "playing", settings: { enabled: true, threshold: -24, attack: 0.1 } });
  for (const settings of [{}, null, { enabled: 1 }, { threshold: -61 }, { ratio: 21 }, { gain: "1,anull" }, { detector: "peak" }, { threshold: NaN }]) {
    expect(isCompressorPatch(settings)).toBe(false);
    expect(() => parseCommand(command(settings))).toThrow();
  }
});
