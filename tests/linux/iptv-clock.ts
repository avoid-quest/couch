import { strict as assert } from "node:assert";

export const guideClock = { width: 640, height: 360, frameMs: 40, maxRunMs: 600_000, maxLagMs: 8_000, maxCaptureMs: 1_000, x: 64, y: 240, cell: 16, rowStep: 24 };
const guard = 0xb4;
export type ClockCapture = { tick: number; epoch: number; captureStart: number; captureEnd: number };
export type VideoRect = { left: number; top: number; width: number; height: number };

// The timestamp and its complement are video pixels, encoded with the color field.
export function clockFrame(color: "red" | "blue", elapsed: number): Uint8Array {
  assert.ok(elapsed >= 0 && elapsed <= guideClock.maxRunMs, "Fixture clock remains inside its ten-minute bound");
  const frame = new Uint8Array(guideClock.width * guideClock.height * 3);
  for (let offset = color === "red" ? 0 : 2; offset < frame.length; offset += 3) frame[offset] = 255;
  const word = guard * 2 ** 24 + Math.floor(elapsed / guideClock.frameMs);
  for (let column = 0; column < 32; column++) for (let row = 0; row < 2; row++) {
    const level = ((word >>> (31 - column)) & 1) !== row ? 255 : 0;
    for (let y = 0; y < guideClock.cell; y++) for (let x = 0; x < guideClock.cell; x++) {
      const offset = ((guideClock.y + row * guideClock.rowStep + y) * guideClock.width + guideClock.x + column * guideClock.cell + x) * 3;
      frame.fill(level, offset, offset + 3);
    }
  }
  return frame;
}

export function decodeClock(pixels: Uint8Array, width: number, height: number, video: VideoRect = { left: 0, top: 0, width, height }): number {
  assert.equal(pixels.length, width * height * 3, "Clock capture contains complete RGB24 pixels");
  const rows: number[][] = [[], []];
  for (let row = 0; row < 2; row++) for (let column = 0; column < 32; column++) {
    const x = Math.round(video.left + (guideClock.x + (column + 0.5) * guideClock.cell) * video.width / guideClock.width);
    const y = Math.round(video.top + (guideClock.y + row * guideClock.rowStep + guideClock.cell / 2) * video.height / guideClock.height);
    assert.ok(x >= 2 && y >= 2 && x + 2 < width && y + 2 < height, "Clock cells lie inside the captured native video");
    let dark = 0, light = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const offset = ((y + dy) * width + x + dx) * 3;
      if (pixels.subarray(offset, offset + 3).every(value => value < 75)) dark++;
      if (pixels.subarray(offset, offset + 3).every(value => value > 180)) light++;
    }
    assert.ok(dark >= 23 || light >= 23, "Clock cell is unambiguous after YUV conversion and scaling");
    rows[row]!.push(light >= 23 ? 1 : 0);
  }
  assert.ok(rows[0]!.every((bit, index) => bit !== rows[1]![index]), "Clock rows contain matching complements");
  const value = (bits: number[]) => bits.reduce((word, bit) => word * 2 + bit, 0);
  assert.equal(value(rows[0]!.slice(0, 8)), guard, "Native frame contains the generated clock guard");
  const tick = value(rows[0]!.slice(8));
  assert.ok(tick * guideClock.frameMs <= guideClock.maxRunMs, "Decoded timestamp is inside the fixture lifetime");
  return tick;
}

export function clockLag(capture: ClockCapture) {
  const uncertaintyMs = capture.captureEnd - capture.captureStart;
  assert.ok(uncertaintyMs >= 0 && uncertaintyMs <= guideClock.maxCaptureMs, "Native capture clock uncertainty is at most one second");
  const presentedAt = capture.epoch + capture.tick * guideClock.frameMs;
  assert.ok(presentedAt <= capture.captureEnd, "A presented frame cannot come from the fixture's future");
  return { presentedAt, uncertaintyMs, minimumLagMs: Math.max(0, capture.captureStart - presentedAt - guideClock.frameMs), maximumLagMs: capture.captureEnd - presentedAt };
}

export function assertLiveFrame(capture: ClockCapture) {
  const lag = clockLag(capture);
  assert.ok(lag.maximumLagMs <= guideClock.maxLagMs, `Presented IPTV frame exceeds the ${guideClock.maxLagMs} ms live latency bound: ${lag.maximumLagMs} ms`);
  return lag;
}
