import { expect, test } from "bun:test";
import { contrast, deepPeak, haze, lightFrom, luminance, peak, readArt, roomPeak, tonePeak, type Rgb } from "../src/client/artwork-light";

const white: Rgb = [255, 255, 255], muted: Rgb = [163, 163, 163];

test("ink keeps 7:1 over the light at its brightest, whatever the artwork", () => {
  for (const colour of [[255, 255, 255], [255, 220, 0], [0, 255, 120], [255, 0, 0], [30, 60, 255], [200, 120, 255]] as Rgb[]) {
    const { a, b } = lightFrom("art", [colour, colour]);
    expect(luminance(a)).toBeLessThanOrEqual(peak);
    expect(luminance(b)).toBeLessThanOrEqual(haze);
    // The backlight hugs the artwork, where only titles come near; the haze may lie under any text.
    expect(contrast(white, a)).toBeGreaterThanOrEqual(7);
    expect(contrast(muted, b)).toBeGreaterThanOrEqual(7);
  }
});

test("a read that failed isn't kept as no light: the next showing reads the picture again", async () => {
  const src = "https://example.test/cover.jpg";
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: globals.fetch, createImageBitmap: globals.createImageBitmap, document: globals.document };
  let reachable = false;
  globals.fetch = async () => { if (!reachable) throw new TypeError("Failed to fetch"); return new Response("picture"); };
  globals.createImageBitmap = async () => ({ close() {} });
  const blue = Array.from({ length: 16 * 16 }, () => [30, 60, 220, 255]).flat();
  globals.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: blue }) }) }) };
  try {
    expect(await readArt(src)).toBeNull();
    reachable = true;
    expect((await readArt(src))?.light?.key).toBe(src);
  } finally { Object.assign(globals, saved); }
});

test("the room and the bar's tone keep muted ink at 7:1 over the brightest colour of any hue", () => {
  const muted: Rgb = [189, 189, 189];
  for (const colour of [[255, 255, 0], [0, 255, 255], [255, 0, 0], [0, 0, 255], [200, 200, 200]] as Rgb[]) {
    const { room, deep, tone } = lightFrom("art", [colour, colour]);
    expect(luminance(room)).toBeLessThanOrEqual(roomPeak);
    expect(luminance(deep)).toBeLessThanOrEqual(deepPeak);
    expect(luminance(tone)).toBeLessThanOrEqual(tonePeak);
    expect(contrast(muted, room)).toBeGreaterThanOrEqual(7);
  }
});
