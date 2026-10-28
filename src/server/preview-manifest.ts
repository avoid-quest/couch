import type { PlaybackPreview, PreviewFrame } from "../shared/playback-preview";
import type { PreviewSource } from "./playback-preview";
import { boundedBytes, guideUrl } from "./iptv-feeds";
import { publicFetch } from "./public-network";

export type PreviewManifest = { kind: "vtt"; url: string; metadata?: never };
export type PreviewInput = PreviewSource | PreviewManifest;
export const previewManifestLimit = 512 * 1024;

export function vttPreview(value: unknown, base?: string): PreviewManifest | undefined {
  try { return { kind: "vtt", url: guideUrl(value, base) }; } catch { return; }
}

// These players publish a plain URL literal in HTML already read for playback.
// Expressions and escaped script strings are deliberately not evaluated.
export function playerPreview(html: string, base: string): PreviewManifest | undefined {
  return vttPreview(/window\.thumbnailsUrl\s*=\s*(['"])([^'"\\\r\n]{1,4096})\1\s*(?:;|\r?\n|<|$)/.exec(html)?.[2], base);
}

function timestamp(value: string): number {
  const parts = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  return parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) + Number(parts[4]) / 1000 : NaN;
}

// WebVTT metadata cues use their actual ends, including gaps. Only one supplied
// image URI per cue is supported; subtitle text is never preview discovery.
export function parsePreviewVtt(text: string, base: string): PreviewSource | undefined {
  if (text.length > previewManifestLimit || Buffer.byteLength(text) > previewManifestLimit || !/^\uFEFF?WEBVTT(?:[ \t][^\r\n]*)?(?:\r\n?|\n|$)/.test(text) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return;
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  let lines = 0;
  for (const character of text) if (character === "\n" && ++lines > 20_000) return;
  const rows = text.split("\n");
  if (rows.some(line => line.length > 8192)) return;
  const cues: PreviewFrame[] = [], images: string[] = [];
  let expiresAt: number | undefined, index = 1;
  // A mapped transport clock needs programme-time mapping, not a zero-time guess.
  while (index < rows.length && rows[index]!.trim()) if (rows[index++]!.startsWith("X-TIMESTAMP-MAP")) return;
  try {
    while (index < rows.length) {
      if (!rows[index]!.trim()) { index++; continue; }
      const start = index;
      while (index < rows.length && rows[index]!.trim()) index++;
      if (/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(rows[start]!)) continue;
      const timing = rows[start]!.includes("-->") ? start : start + 1;
      if (index !== timing + 2) return;
      const range = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t].*)?$/.exec(rows[timing]!);
      if (!range) return;
      const startTime = timestamp(range[1]!), endTime = timestamp(range[2]!);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < (cues.at(-1)?.endTime ?? 0) || endTime <= startTime || endTime > 86400 || cues.length >= 4000) return;
      const target = rows[timing + 1]!.trim(), hash = target.indexOf("#");
      const url = guideUrl(target, base);
      let crop: Pick<PreviewFrame, "width" | "height" | "coords"> = {};
      if (hash >= 0) {
        const match = /^#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/.exec(target.slice(hash));
        if (!match) return;
        const [x, y, width, height] = match.slice(1).map(Number) as [number, number, number, number];
        if (![x, y, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0 || x + width > 8192 || y + height > 8192 || width * height > 4_000_000) return;
        crop = { width, height, coords: { x, y } };
      }
      let image = images.indexOf(url);
      if (image < 0) {
        if (images.length >= 128) return;
        const expiry = new URL(url).searchParams.get("expire");
        if (expiry !== null) {
          if (!/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry) * 1000)) return;
          expiresAt = Math.min(expiresAt ?? Infinity, Number(expiry) * 1000);
        }
        image = images.push(url) - 1;
      }
      cues.push({ image, startTime, endTime, ...crop });
    }
    if (!cues.length) return;
    const metadata: PlaybackPreview = { kind: "cues", duration: cues.at(-1)!.endTime, images: images.length, cues };
    return { metadata, images, ...(expiresAt === undefined ? {} : { expiresAt }) };
  } catch { return; }
}

// Successful/absent metadata belongs to this resolved source, never a URL shared
// across playbacks. Concurrent controllers share work; the last leaving cancels.
export function createPreviewResolver(fetcher: typeof fetch = publicFetch) {
  const completed = new WeakMap<PreviewManifest, PreviewSource | undefined>();
  const pending = new WeakMap<PreviewManifest, { promise: Promise<PreviewSource | undefined>; controller: AbortController; readers: number }>();
  let running = 0;
  const load = async (source: PreviewManifest, cancellation: AbortSignal) => {
    if (running >= 4) throw new Error("Preview manifests are busy.");
    running++;
    try {
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(5000)]);
      const response = await fetcher(source.url, { signal, credentials: "omit", headers: { "user-agent": "Couch", accept: "text/vtt" } });
      if (!response.ok) {
        await response.body?.cancel();
        if ([404, 410].includes(response.status)) return;
        throw new Error("Preview manifest is unavailable.");
      }
      const bytes = await boundedBytes(response, previewManifestLimit, signal);
      return parsePreviewVtt(new TextDecoder().decode(bytes), response.url || source.url);
    } finally { running--; }
  };
  return async (source: PreviewInput | undefined, signal: AbortSignal): Promise<PreviewSource | undefined> => {
    signal.throwIfAborted();
    if (!source || source.metadata) return source;
    if (completed.has(source)) return completed.get(source);
    let work = pending.get(source);
    if (!work) {
      const controller = new AbortController();
      const promise = load(source, controller.signal).then(result => {
        controller.signal.throwIfAborted(); completed.set(source, result); return result;
      }).finally(() => { if (pending.get(source)?.controller === controller) pending.delete(source); });
      work = { promise, controller, readers: 0 };
      pending.set(source, work);
    }
    work.readers++;
    let abort!: () => void;
    try {
      return await new Promise((resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        work.promise.then(resolve, reject);
      });
    } finally {
      signal.removeEventListener("abort", abort);
      if (--work.readers === 0 && pending.get(source) === work) { pending.delete(source); work.controller.abort(); }
    }
  };
}
