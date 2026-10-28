import type { PlaybackPreview } from "../shared/playback-preview";
import { PNG } from "image-size/types/png";
import { JPG } from "image-size/types/jpg";
import { WEBP } from "image-size/types/webp";
import { createArtworkCache } from "./artwork";
import { boundedBytes, guideUrl, record } from "./iptv-feeds";
import { publicFetch } from "./public-network";
import { createPreviewResolver, type PreviewInput } from "./preview-manifest";

export type PreviewSource = { metadata: PlaybackPreview; images: string[]; expiresAt?: number };
export const previewImageLimit = 2 * 1024 * 1024;
const pixelLimit = 4_000_000;
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

// mhtml storyboards are an extractor capability, not a provider name. fps describes
// all frames; fragment duration bookkeeping differs between YouTube and Twitch.
export function storyboardPreview(info: Record<string, unknown>, now = Date.now()): PreviewSource | undefined {
  if (info.is_live === true || info.live_status === "is_live" || !Array.isArray(info.formats) || info.formats.length > 4096) return;
  const duration = info.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 86400) return;
  let best: PreviewSource | undefined, distance = Infinity;
  for (const format of info.formats) {
    if (!record(format) || format.protocol !== "mhtml") continue;
    const { width, height, columns, rows, fps, fragments } = format;
    if (!positiveInteger(width) || width > 1024 || !positiveInteger(height) || height > 1024 || !positiveInteger(columns) || !positiveInteger(rows)) continue;
    const cells = columns * rows;
    if (cells > 4000 || width * columns > 8192 || height * rows > 8192 || width * height * cells > pixelLimit || typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) continue;
    const frames = format.couch_frames ?? Math.round(duration * fps), interval = format.couch_interval ?? 1 / fps;
    if (!positiveInteger(frames) || frames > 4000 || typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0 || interval > 86400
      || format.couch_frames === undefined && Math.abs(duration * fps - frames) > .001
      || !Array.isArray(fragments) || fragments.length !== Math.ceil(frames / cells) || fragments.length > 128 || Math.abs(width - 160) >= distance) continue;
    try {
      let expiresAt: number | undefined;
      const images = fragments.map(fragment => {
        if (!record(fragment)) throw new Error();
        const url = new URL(guideUrl(fragment.url));
        // publicFetch validates actual DNS and every redirect. No playback headers
        // or credentials are inherited by these independently supplied pictures.
        const expiry = url.searchParams.get("expire");
        if (expiry !== null) {
          if (!/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry) * 1000)) throw new Error();
          expiresAt = Math.min(expiresAt ?? Infinity, Number(expiry) * 1000);
        }
        return url.href;
      });
      if (expiresAt !== undefined && expiresAt <= now) continue;
      best = { metadata: { kind: "grid", width, height, columns, rows, interval, duration: Math.min(duration, frames * interval), frames, images: images.length }, images, ...(expiresAt === undefined ? {} : { expiresAt }) };
      distance = Math.abs(width - 160);
      if (distance === 0) break;
    } catch { /* Invalid optional data never prevents playback. */ }
  }
  return best;
}

// Header inspection bounds decoded raster size without decoding it in Core.
function dimensions(bytes: Uint8Array) {
  try {
    const [type, format] = bytes[0] === 0x89 && PNG.validate(bytes) ? ["image/png", PNG] : JPG.validate(bytes) ? ["image/jpeg", JPG] : WEBP.validate(bytes) ? ["image/webp", WEBP] : [];
    if (!format) return;
    const size = format.calculate(Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 64 * 1024)));
    if (positiveInteger(size.width) && positiveInteger(size.height) && size.width <= 8192 && size.height <= 8192 && size.width * size.height <= pixelLimit) return { ...size, type: type! };
  } catch { /* Malformed or truncated image headers are optional failures. */ }
}

// Shared readers use one download; the last departing reader cancels it. Completed
// images remain byte-bounded, and have no authority without a current source.
export function createPreviewImages(fetcher: typeof fetch = publicFetch) {
  const cache = createArtworkCache(16 * 1024 * 1024);
  let running = 0;
  return (url: string, signal: AbortSignal) => cache.read(url, async cancellation => {
    if (running >= 4) throw new Error("Preview downloads are busy.");
    running++;
    try {
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(5000)]);
      const response = await fetcher(url, { signal, headers: { accept: "image/jpeg, image/webp, image/png" } });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Preview image is unavailable."); }
      const bytes = await boundedBytes(response, previewImageLimit, signal);
      const size = dimensions(bytes);
      return size ? { type: size.type, bytes } : null;
    } finally { running--; }
  }, signal);
}
const images = createPreviewImages();
const resolvePreview = createPreviewResolver();

export async function playbackPreviewResponse(request: Request, source: () => Promise<PreviewInput | undefined>, authorize: () => void, readImage = images, resolve = resolvePreview): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const headers = { "Cache-Control": "private, no-store" };
  const check = () => { request.signal.throwIfAborted(); authorize(); };
  try {
    check();
    const supplied = await source();
    check();
    let preview;
    try { preview = await resolve(supplied, request.signal); }
    catch { check(); return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "1" } }); }
    check();
    if (!preview || preview.expiresAt !== undefined && preview.expiresAt <= Date.now()) return new Response(null, { status: 204, headers });
    const image = new URL(request.url).searchParams.get("image");
    if (image === null) return Response.json(preview.metadata, { headers });
    if (!/^\d{1,3}$/.test(image) || !preview.images[Number(image)]) return new Response(null, { status: 404, headers });
    let picture;
    try { picture = await readImage(preview.images[Number(image)]!, request.signal); }
    catch { check(); return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "1" } }); }
    check();
    if (!picture || preview.expiresAt !== undefined && preview.expiresAt <= Date.now()) return new Response(null, { status: 204, headers });
    const size = dimensions(picture.bytes), metadata = preview.metadata, index = Number(image);
    if (!size) return new Response(null, { status: 204, headers });
    const fits = metadata.kind === "grid"
      ? size.width >= metadata.width * metadata.columns && size.height >= metadata.height * Math.ceil(Math.min(metadata.columns * metadata.rows, metadata.frames - index * metadata.columns * metadata.rows) / metadata.columns)
      : metadata.cues.every(cue => cue.image !== index || !cue.coords || cue.coords.x + cue.width! <= size.width && cue.coords.y + cue.height! <= size.height);
    if (!fits) return new Response(null, { status: 204, headers });
    return new Response(Buffer.from(picture.bytes), { headers: { ...headers, "Content-Type": size.type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch { return new Response(null, { status: 404, headers }); }
}
