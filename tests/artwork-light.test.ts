import { expect, test } from "bun:test";
import { atLuminance, clearEdges, contrast, deepPeak, haze, lightFrom, luminance, peak, pickLight, readLight, roomPeak, tonePeak, type Rgb } from "../src/client/artwork-light";

// A 16×16 read as getImageData gives it: RGBA, one pixel after another.
const pixels = (...parts: [Rgb, number][]) => new Uint8ClampedArray(parts.flatMap(([[r, g, b], count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat()));
const white: Rgb = [255, 255, 255], muted: Rgb = [163, 163, 163];
const hue = ([r, g, b]: Rgb) => r >= g && r >= b ? "red" : g >= b ? "green" : "blue";

test("the strongest hue leads, and the second colour is another hue the picture holds", () => {
  const picked = pickLight(pixels([[220, 40, 30], 150], [[30, 60, 200], 60], [[0, 0, 0], 46]))!;
  expect(picked.map(hue)).toEqual(["red", "blue"]);
});

test("a picture of one hue lights in it twice", () => {
  const [a, b] = pickLight(pixels([[30, 60, 200], 200], [[20, 40, 150], 56]))!;
  expect([hue(a), hue(b)]).toEqual(["blue", "blue"]);
});

test("a close hue isn't a second colour, and a trace of another doesn't count", () => {
  // Orange beside red is the same light; a few green pixels are a detail, not a colour.
  const [, second] = pickLight(pixels([[220, 40, 30], 150], [[230, 110, 30], 100], [[40, 200, 60], 3]))!;
  expect(hue(second)).toBe("red");
});

test("black, white and transparent pixels carry no light; a grey picture lights grey; an empty one gives none", () => {
  expect(pickLight(pixels([[0, 0, 0], 128], [[255, 255, 255], 128]))).toBeNull();
  expect(pickLight(new Uint8ClampedArray(16 * 16 * 4))).toBeNull();
  const [grey] = pickLight(pixels([[120, 120, 120], 256]))!;
  expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(1);
});

test("a colour keeps its hue at a luminance, never above it; one that can't reach it stays as bright as it can", () => {
  const dimmed = atLuminance([240, 120, 40], 0.05);
  expect(luminance(dimmed)).toBeLessThanOrEqual(0.05);
  expect(luminance(dimmed)).toBeGreaterThan(0.045);
  expect(dimmed[0]).toBeGreaterThan(dimmed[1]);
  expect(dimmed[1]).toBeGreaterThan(dimmed[2]);
  expect(atLuminance([0, 0, 255], 0.5)).toEqual([0, 0, 255]);
  expect(atLuminance([0, 0, 0], 0.05)).toEqual([0, 0, 0]);
});

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

test("a photo with some colour among its greys lights in that colour; one with a trace of it stays grey", () => {
  // A dim green garden beside a grey sky: few vivid pixels, but a good share of the picture.
  const garden = pickLight(pixels([[200, 200, 205], 120], [[60, 90, 50], 60], [[0, 0, 0], 76]))!;
  expect(hue(garden[0])).toBe("green");
  const [grey] = pickLight(pixels([[200, 200, 205], 240], [[60, 90, 50], 10], [[0, 0, 0], 6]))!;
  expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(10);
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
    expect(await readLight(src)).toBeNull();
    reachable = true;
    expect((await readLight(src))?.key).toBe(src);
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

test("a picture whose edge is mostly see-through is a mark; an opaque one isn't", () => {
  const side = 16, picture = (clear: (x: number, y: number) => boolean) => new Uint8ClampedArray(Array.from({ length: side * side }, (_, index) => [255, 255, 255, clear(index % side, Math.floor(index / side)) ? 0 : 255]).flat());
  const edge = (x: number, y: number) => x === 0 || y === 0 || x === side - 1 || y === side - 1;
  expect(clearEdges(picture(edge))).toBe(true);
  expect(clearEdges(picture(() => false))).toBe(false);
  // A logo on white with a see-through corner or two is still opaque.
  expect(clearEdges(picture((x, y) => x < 2 && y < 2))).toBe(false);
});
