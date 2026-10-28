import type { PlaybackPreview } from "../shared/playback-preview";
import { createArtworkCache } from "./artwork";
import { boundedBytes, guideUrl, record } from "./iptv-feeds";
import { publicFetch } from "./public-network";

export type PreviewSource = PlaybackPreview & { images: string[]; expiresAt: number };
export const previewImageLimit = 2 * 1024 * 1024;

// yt-dlp's YouTube mhtml formats describe sprite sheets, not a VTT. Its fps maps
// frame_count / duration, including a partially filled final sheet. Prefer 160px tiles.
export function youtubePreview(info: Record<string, unknown>, now = Date.now()): PreviewSource | undefined {
  if (info.extractor !== "youtube" || info.is_live === true || info.live_status === "is_live" || !Array.isArray(info.formats)) return;
  const duration = info.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 86400) return;
  const formats = info.formats.filter(record).filter(format => format.protocol === "mhtml" && format.format_note === "storyboard");
  formats.sort((a, b) => Math.abs(Number(a.width) - 160) - Math.abs(Number(b.width) - 160));
  for (const format of formats) {
    const { width, height, columns, rows, fps, fragments } = format;
    if (![width, height, columns, rows].every(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1024)) continue;
    const w = width as number, h = height as number, cols = columns as number, r = rows as number;
    if (w * h * cols * r > 4_000_000 || cols * r > 100 || typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0 || fps > 1) continue;
    const frames = Math.round(duration * fps), cells = cols * r;
    if (frames < 1 || frames > 4000 || Math.abs(duration * fps - frames) > .001 || !Array.isArray(fragments) || fragments.length !== Math.ceil(frames / cells) || fragments.length > 128) continue;
    try {
      const interval = 1 / fps;
      let expiresAt = now + 60 * 60 * 1000;
      const images = fragments.map((fragment, index) => {
        if (!record(fragment) || typeof fragment.duration !== "number" || Math.abs(fragment.duration - Math.min(cells * interval, duration - index * cells * interval)) > .01) throw new Error();
        const url = new URL(guideUrl(fragment.url));
        // Public YouTube storyboards only. Never forward playback headers or
        // accept extractor-provided private addresses as preview sources.
        if (url.protocol !== "https:" || url.hostname !== "i.ytimg.com" || url.port || !url.pathname.startsWith(`/sb/${info.id}/`)) throw new Error();
        const expiry = url.searchParams.get("expire");
        if (expiry !== null) {
          if (!/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry) * 1000)) throw new Error();
          expiresAt = Math.min(expiresAt, Number(expiry) * 1000);
        }
        return url.href;
      });
      if (expiresAt <= now) continue;
      return { width: w, height: h, columns: cols, rows: r, interval, duration, sheets: images.length, images, expiresAt };
    } catch { /* Bad optional preview data never prevents playback. */ }
  }
}

// Bounded across all Playbacks. Shared readers use one download; the last leaving
// reader cancels it. Completed images have no authority without a current source.
export function createPreviewImages(fetcher: typeof fetch = publicFetch) {
  const cache = createArtworkCache(16 * 1024 * 1024);
  let running = 0;
  return (url: string, signal: AbortSignal) => cache.read(url, async cancellation => {
    if (running >= 4) return null;
    running++;
    try {
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(5000)]);
      const response = await fetcher(url, { signal, headers: { accept: "image/jpeg, image/webp, image/png" } });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!response.ok || !["image/jpeg", "image/webp", "image/png"].includes(type)) { await response.body?.cancel(); return null; }
      const bytes = await boundedBytes(response, previewImageLimit, signal);
      return bytes.length ? { type, bytes } : null;
    } finally { running--; }
  }, signal);
}
const images = createPreviewImages();

export async function playbackPreviewResponse(request: Request, source: () => Promise<PreviewSource | undefined>, authorize: () => void, readImage = images): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  // No URLs or credentials in responses. Recheck actor and source after async work.
  const headers = { "Cache-Control": "private, no-store" };
  const check = () => { request.signal.throwIfAborted(); authorize(); };
  try {
    check();
    const preview = await source();
    check();
    if (!preview || preview.expiresAt <= Date.now()) return new Response(null, { status: 204, headers });
    const sheet = new URL(request.url).searchParams.get("sheet");
    if (sheet === null) {
      const { images: _images, expiresAt: _expiresAt, ...metadata } = preview;
      return Response.json(metadata, { headers });
    }
    if (!/^\d{1,3}$/.test(sheet) || !preview.images[Number(sheet)]) return new Response(null, { status: 404, headers });
    const picture = await readImage(preview.images[Number(sheet)]!, request.signal);
    check();
    if (!picture || preview.expiresAt <= Date.now()) return new Response(null, { status: 204, headers });
    return new Response(Buffer.from(picture.bytes), { headers: { ...headers, "Content-Type": picture.type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
