import type { PreviewFrame } from "../shared/playback-preview";
import type { PreviewSource } from "./playback-preview";
import { guideUrl } from "./iptv-feeds";
import { previewManifestLimit } from "./preview-manifest";

export type HlsPreviewManifest = { kind: "hls"; url: string; text?: string; media?: { url: string; text?: string }; metadata?: never };
type ImageTrack = { url: string; width: number; height: number };

function lines(text: string): string[] | undefined {
  if (Buffer.byteLength(text) > previewManifestLimit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return;
  const rows = text.split(/\r?\n/);
  if (rows[0] !== "#EXTM3U" || rows.length > 20_000 || rows.some(row => row.length > 8192 || row !== row.trim() || row.includes("{$"))) return;
  return rows;
}

function attributes(value: string) {
  const result = new Map<string, string>(), pattern = /([A-Z0-9-]+)=("[^"\r\n]*"|[^,\s"]+)(?:,|$)/y;
  while (pattern.lastIndex < value.length) {
    const match = pattern.exec(value);
    if (!match || result.has(match[1]!) || match[0].endsWith(",") && pattern.lastIndex === value.length) return;
    result.set(match[1]!, match[2]!);
  }
  return result;
}
const quoted = (value?: string) => value?.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : undefined;
const positive = (value?: string) => value && /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0 && Number(value) <= 86400 ? Number(value) : undefined;
function resolution(value?: string) {
  const match = /^(\d+)x(\d+)$/.exec(value ?? "");
  if (!match) return;
  const width = Number(match[1]), height = Number(match[2]);
  if (width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 4_000_000) return { width, height };
}

// Image Media Playlist v0.4: the URI is an attribute, never the next line.
// Select one JPEG track near 160px; no alternate probing or nested masters.
export function hlsImageTrack(text: string, base: string): { image: ImageTrack; media: string } | undefined {
  const rows = lines(text);
  if (!rows || rows.some(row => /^#EXT(?:INF:|-X-(?:IMAGES-ONLY|DEFINE|SESSION-KEY|START)(?::|$))/.test(row))) return;
  let image: ImageTrack | undefined, media: string | undefined, count = 0;
  try {
    for (const [index, row] of rows.entries()) {
      if (!media && row.startsWith("#EXT-X-STREAM-INF:") && rows[index + 1] && !rows[index + 1]!.startsWith("#")) media = guideUrl(rows[index + 1], base);
      if (!row.startsWith("#EXT-X-IMAGE-STREAM-INF:")) continue;
      if (++count > 16) return;
      const attrs = attributes(row.slice(24)), size = resolution(attrs?.get("RESOLUTION"));
      if (!attrs || !size || attrs.get("CODECS") !== '"jpeg"' || !/^\d+$/.test(attrs.get("BANDWIDTH") ?? "") || !Number.isSafeInteger(Number(attrs.get("BANDWIDTH"))) || Number(attrs.get("BANDWIDTH")) <= 0 || attrs.has("VIDEO")) continue;
      const url = guideUrl(quoted(attrs.get("URI")), base);
      if (!image || Math.abs(size.width - 160) < Math.abs(image.width - 160)) image = { url, ...size };
    }
    return image && media ? { image, media } : undefined;
  } catch { return; }
}

// Reuse bytes already read for playback, or defer a known HLS master until a
// controller asks. Never retain unbounded manifest bodies on a resolved source.
export function hlsPreview(value: unknown, text?: string, media?: HlsPreviewManifest["media"]): HlsPreviewManifest | undefined {
  try {
    const url = guideUrl(value);
    if (text !== undefined && !hlsImageTrack(text, url) || Buffer.byteLength(text ?? "") + Buffer.byteLength(media?.text ?? "") > previewManifestLimit) return;
    return { kind: "hls", url, ...(text === undefined ? {} : { text }), ...(media ? { media: { ...media, url: guideUrl(media.url) } } : {}) };
  } catch { return; }
}

type Segment = { uri: string; startTime: number; endTime: number; gap: boolean; tiles?: string };
function vodSegments(text: string, images: boolean): Segment[] | undefined {
  const rows = lines(text);
  if (!rows || images !== rows.includes("#EXT-X-IMAGES-ONLY")) return;
  const segments: Segment[] = [], seen = new Set<string>();
  let duration: number | undefined, tiles: string | undefined, gap = false, ended = false, time = 0;
  for (const row of rows.slice(1)) {
    const [tag] = row.split(":", 1);
    // No zero-time guess for sliding windows, edits or discontinuities. Byte
    // ranges and encrypted images need a different asset reader and stay absent.
    if (row === "#EXTM3U" || /^#EXT-X-(?:DISCONTINUITY|START|SKIP|PART|PART-INF|SERVER-CONTROL|DEFINE|STREAM-INF|I-FRAME-STREAM-INF|IMAGE-STREAM-INF|I-FRAMES-ONLY|MEDIA|SESSION-KEY)(?::|$)/.test(row)
      || images && /^#EXT-X-(?:KEY|MAP|BYTERANGE)(?::|$)/.test(row)) return;
    if (["#EXT-X-MEDIA-SEQUENCE", "#EXT-X-DISCONTINUITY-SEQUENCE", "#EXT-X-PLAYLIST-TYPE", "#EXT-X-ENDLIST", "#EXT-X-IMAGES-ONLY", "#EXT-X-TARGETDURATION", "#EXT-X-VERSION"].includes(tag!)) {
      if (seen.has(tag!)) return;
      seen.add(tag!);
      if (tag === "#EXT-X-MEDIA-SEQUENCE" || tag === "#EXT-X-DISCONTINUITY-SEQUENCE") { if (segments.length || row.slice(tag.length + 1) !== "0") return; }
      else if (tag === "#EXT-X-PLAYLIST-TYPE" && row !== "#EXT-X-PLAYLIST-TYPE:VOD") return;
      else if (tag === "#EXT-X-ENDLIST") { if (row !== tag || duration !== undefined || gap || tiles !== undefined) return; ended = true; }
      else if (["#EXT-X-TARGETDURATION", "#EXT-X-VERSION"].includes(tag!)) { if (!/^\d+$/.test(row.slice(tag!.length + 1)) || !positive(row.slice(tag!.length + 1))) return; }
    } else if (tag === "#EXTINF") {
      if (ended || duration !== undefined) return;
      duration = positive(/^#EXTINF:([^,]+),.*$/.exec(row)?.[1]);
      if (duration === undefined) return;
    } else if (tag === "#EXT-X-TILES") {
      if (!images || ended || tiles !== undefined) return;
      tiles = row.slice(13);
    } else if (row === "#EXT-X-GAP") {
      if (gap || ended) return;
      gap = true;
    } else if (row && !row.startsWith("#")) {
      if (ended || duration === undefined || time + duration > 86400 || time + duration <= time || segments.length >= 4000) return;
      segments.push({ uri: row, startTime: time, endTime: time += duration, gap, tiles });
      duration = undefined; tiles = undefined; gap = false;
    }
  }
  return ended && seen.has("#EXT-X-TARGETDURATION") && segments.length && duration === undefined && !gap && tiles === undefined ? segments : undefined;
}

export const hlsPreviewVod = (text: string) => !!vodSegments(text, false);

export function parseHlsImages(text: string, track: ImageTrack): PreviewSource | undefined {
  const segments = vodSegments(text, true);
  if (!segments) return;
  const cues: PreviewFrame[] = [], images: string[] = [];
  let expiresAt: number | undefined;
  try {
    for (const segment of segments) {
      let grid: { width: number; height: number; columns: number; cells: number; interval: number } | undefined;
      if (segment.tiles !== undefined) {
        const attrs = attributes(segment.tiles), size = resolution(attrs?.get("RESOLUTION")), layout = resolution(attrs?.get("LAYOUT")), interval = positive(attrs?.get("DURATION"));
        if (!size || !layout || !interval || size.width > track.width || size.height > track.height || layout.width * layout.height > 4000 || size.width * layout.width > 8192 || size.height * layout.height > 8192 || size.width * size.height * layout.width * layout.height > 4_000_000) return;
        grid = { ...size, columns: layout.width, cells: layout.width * layout.height, interval };
      }
      if (segment.gap) continue;
      const url = guideUrl(segment.uri, track.url);
      const expiry = new URL(url).searchParams.get("expire");
      if (expiry !== null) {
        if (!/^\d+$/.test(expiry) || !Number.isSafeInteger(Number(expiry) * 1000)) return;
        expiresAt = Math.min(expiresAt ?? Infinity, Number(expiry) * 1000);
      }
      let image = images.indexOf(url);
      if (image < 0) { if (images.length >= 128) return; image = images.push(url) - 1; }
      // Decimal EXTINF and interval multiplication can differ by a few ULPs
      // (6.006 vs 3 * 2.002). Do not invent a nearly zero-length extra tile.
      const tileTime = (tile: number) => {
        const time = segment.startTime + tile * (grid?.interval ?? 0);
        return Math.abs(time - segment.endTime) <= Number.EPSILON * Math.max(1, segment.endTime) * 4 ? segment.endTime : time;
      };
      for (let tile = 0; tile < (grid?.cells ?? 1); tile++) {
        const startTime = tileTime(tile);
        if (startTime >= segment.endTime) break;
        if (cues.length >= 4000) return;
        const endTime = grid && tile < grid.cells - 1 ? Math.min(segment.endTime, tileTime(tile + 1)) : segment.endTime;
        if (endTime <= startTime) return;
        cues.push({ image, startTime, endTime, ...(grid ? { width: grid.width, height: grid.height, coords: { x: tile % grid.columns * grid.width, y: Math.floor(tile / grid.columns) * grid.height } } : {}) });
      }
    }
    if (!cues.length) return;
    return { metadata: { kind: "cues", duration: segments.at(-1)!.endTime, images: images.length, cues }, images, imageType: "image/jpeg", ...(expiresAt === undefined ? {} : { expiresAt }) };
  } catch { return; }
}
