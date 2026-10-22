import { apiFetch, type ApiCredentials } from "./api/client";

/**
 * Ambient light from artwork (docs/design.md, Principles): two colours read from a 16×16 copy of the picture, then
 * dimmed so the ink over them keeps 7:1. Core fetches the picture for the read (src/server/artwork.ts), since most
 * artwork hosts don't let a page read theirs; artwork it can't read gives no light, and the picture on screen is
 * never touched.
 */
export type Rgb = readonly [number, number, number];
export type Light = { key: string; a: Rgb; b: Rgb };

const linear = (channel: number) => { const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
// Rounded down, so a colour never ends brighter than asked.
const encoded = (value: number) => Math.floor(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) + 1e-9);
/** WCAG relative luminance. */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG contrast ratio between two colours. */
export const contrast = (one: Rgb, two: Rgb) => { const [high, low] = [luminance(one), luminance(two)].sort((x, y) => y - x); return (high! + 0.05) / (low! + 0.05); };

/**
 * The colour at a luminance: its hue and saturation kept, its light scaled in linear light (so it reads as the same
 * colour, dimmer). A colour that can't reach it (a deep blue) stays as bright as it can.
 */
export function atLuminance(colour: Rgb, target: number): Rgb {
  const channels = colour.map(linear), current = luminance(colour);
  if (current <= 0) return [0, 0, 0];
  const scale = Math.min(target / current, 1 / Math.max(...channels));
  return channels.map(value => encoded(Math.min(1, value * scale))) as unknown as Rgb;
}

/**
 * How bright each colour may be. The first is a backlight that hugs the artwork and is gone a few rem out; at its
 * brightest white ink keeps 7:1 over it (1.05 / 7 − 0.05 = 0.1). The second is a wide haze that may lie under any
 * text, so it stays dark enough for muted ink (#a3a3a3) to keep 7:1 too (0.416 / 7 − 0.05 = 0.0094), with room for
 * the backlight's last trace where text comes near the artwork.
 */
export const peak = 0.07, haze = 0.004;

/**
 * The two colours of a picture's pixels (RGBA, as getImageData gives them): the strongest hue, by how vivid its pixels
 * are, and the strongest hue at least 60° from it (else the first again). Near-black, near-white and transparent
 * pixels carry no light; a picture of only those gives none, and one under a tenth coloured lights in its grey.
 */
export function pickLight(pixels: ArrayLike<number>): [Rgb, Rgb] | null {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let grey = { weight: 0, r: 0, g: 0, b: 0 }, coloured = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!, alpha = pixels[index + 3]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), value = max / 255, chroma = (max - min) / 255;
    if (alpha < 128 || value < 0.08 || min > 240) continue;
    if (chroma < 0.08) { grey = { weight: grey.weight + 1, r: grey.r + r, g: grey.g + g, b: grey.b + b }; continue; }
    const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    const bin = bins[Math.floor(hue * 2) % 12]!, weight = chroma * value;
    coloured++;
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
  }
  const mean = (bin: { weight: number; r: number; g: number; b: number }): Rgb => [bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight];
  const ranked = bins.map((bin, index) => ({ bin, index })).filter(({ bin }) => bin.weight > 0).sort((x, y) => y.bin.weight - x.bin.weight);
  const first = ranked[0];
  // A picture with hardly any colour (a black-and-white photo, a white cover) lights in its own grey.
  if (!first || coloured < (coloured + grey.weight) * 0.1) return grey.weight ? [mean(grey), mean(grey)] : null;
  const apart = (index: number) => Math.min(Math.abs(index - first.index), 12 - Math.abs(index - first.index)) >= 2;
  const second = ranked.find(({ bin, index }) => apart(index) && bin.weight >= first.bin.weight * 0.15) ?? first;
  return [mean(first.bin), mean(second.bin)];
}

/** Light from two picked colours: the first as the backlight, the second as the haze. */
export const lightFrom = (key: string, [a, b]: [Rgb, Rgb]): Light => ({ key, a: atLuminance(a, peak), b: atLuminance(b, haze) });

const size = 16;
const cache = new Map<string, Light | null>();
/** The light already read for an address, if any. */
export const cachedLight = (src: string) => cache.get(src) ?? null;
const pending = new Map<string, Promise<Light | null>>();

/** The picture's bytes: through Core, which reads hosts that don't allow a page to (CORS); a blob: is the page's own. */
const picture = async (src: string, credentials: ApiCredentials | null | undefined) =>
  (src.startsWith("blob:") || !credentials ? await fetch(src, { referrerPolicy: "no-referrer" }) : await apiFetch(credentials, `/api/artwork?${new URLSearchParams({ url: src })}`)).blob();

/**
 * One read per address, apart from the shown image, so the picture on screen is never changed or broken by it. A
 * picture's answer is kept, light or none; a read that failed (Core unreachable, a host that timed out) isn't, so the
 * next time the artwork shows it is read again.
 */
export function readLight(src: string, credentials?: ApiCredentials | null): Promise<Light | null> {
  if (cache.has(src)) return Promise.resolve(cache.get(src)!);
  let read = pending.get(src);
  if (!read) {
    read = (async () => {
      const bitmap = await createImageBitmap(await picture(src, credentials));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(bitmap, 0, 0, size, size);
        const picked = pickLight(context.getImageData(0, 0, size, size).data);
        return picked && lightFrom(src, picked);
      } finally { bitmap.close(); }
    })().then(light => { cache.set(src, light); return light; }, () => null).finally(() => pending.delete(src));
    pending.set(src, read);
  }
  return read;
}
