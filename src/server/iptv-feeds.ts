import { parseM3U } from "@iptv/playlist";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import type { GuideChannel, GuideProgram } from "../shared/iptv";

export const guideLimits = { playlistBytes: 2 * 1024 * 1024, xmlBytes: 16 * 1024 * 1024, channels: 5_000, programs: 100_000, elements: 600_000, nesting: 12, sources: 8 };
export type PrivateChannel = GuideChannel & { streamUrl: string; logoUrl: string | null };
export class GuideError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const fail = (message: string): never => { throw new GuideError(message); };
export const guideId = (...parts: string[]) => createHash("sha256").update(JSON.stringify(["couch:iptv:v1", ...parts])).digest("hex");
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function guideText(value: unknown, max: number, optional = false): string {
  if (value === undefined && optional) return "";
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || !optional && !value.trim()) fail("The guide contains missing or oversized text fields.");
  return (value as string).trim();
}
function guideIdentifier(value: unknown): string {
  guideText(value, 200);
  return value as string; // IDs match exactly; only display text is trimmed.
}
export function guideUrl(value: unknown, base?: string): string {
  if (typeof value !== "string" || !value || value.length > 4096 || /[\u0000-\u0020\u007f\\|]/.test(value) || !base && !/^https?:\/\//i.test(value)) fail("Use an HTTP or HTTPS URL without embedded credentials or playback headers.");
  try {
    const url = new URL(value as string, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = "";
    return url.href;
  } catch { return fail("Use an HTTP or HTTPS URL without embedded credentials or playback headers."); }
}

export async function boundedBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maximum) { await response.body?.cancel(); throw new GuideError("The response exceeds its size limit.", 413); }
  const reader = response.body?.getReader();
  if (!reader) throw new GuideError("The server returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) return Buffer.concat(chunks);
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new GuideError("The response exceeds its size limit.", 413); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

export async function guideFetch(url: string, maximum: number, request: typeof fetch, signal: AbortSignal) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const response = await request(url, { signal, redirect: "manual", headers: { "User-Agent": "Couch/0.1" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = guideUrl(response.headers.get("location"), url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new GuideError(`The source returned HTTP ${response.status}.`, 502); }
    return { url, bytes: await boundedBytes(response, maximum, signal) };
  }
  throw new GuideError("The source redirected too many times.", 502);
}

// Capability detection for direct live media playlists, not HLS playback parsing.
// RFC 8216 sections 4.3.2.1 and 4.3.3 allow an omitted media sequence, defaulting to zero.
export function liveHlsPlaylist(text: string, base: string): boolean {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.shift() !== "#EXTM3U") return false;
  let target: number | null = null, duration: number | null = null, longest = 0, segments = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line) continue;
    if (line !== line.trim() || /[\u0000-\u001f\u007f]/.test(line)) return false;
    const tag = line.split(":", 1)[0]!;
    if (/^#EXT-X-(?:ENDLIST|I-FRAMES-ONLY|START|MEDIA|STREAM-INF|I-FRAME-STREAM-INF|SESSION-DATA|SESSION-KEY)$/.test(tag) || tag === "#EXTM3U") return false;
    if (["#EXT-X-TARGETDURATION", "#EXT-X-MEDIA-SEQUENCE", "#EXT-X-PLAYLIST-TYPE", "#EXT-X-VERSION"].includes(tag)) {
      if (seen.has(tag)) return false;
      seen.add(tag);
      const value = line.slice(tag.length + 1);
      if (tag === "#EXT-X-PLAYLIST-TYPE") { if (value !== "EVENT") return false; }
      else if (tag === "#EXT-X-MEDIA-SEQUENCE") {
        if (segments || !/^\d{1,20}$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n) return false;
      } else {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) return false;
        if (tag === "#EXT-X-TARGETDURATION") target = Number(value);
      }
    } else if (tag === "#EXTINF") {
      const match = /^#EXTINF:(\d+(?:\.\d+)?),.*$/.exec(line);
      if (duration !== null || !match || !Number.isFinite(Number(match[1])) || Number(match[1]) <= 0) return false;
      duration = Number(match[1]);
    } else if (!line.startsWith("#")) {
      if (duration === null) return false;
      try { guideUrl(line, base); } catch { return false; }
      longest = Math.max(longest, Math.round(duration));
      duration = null;
      segments++;
    }
  }
  return target !== null && segments > 0 && duration === null && longest <= target;
}

export function parseGuideChannels(text: string, sourceId: string, base: string): PrivateChannel[] {
  if (Buffer.byteLength(text) > guideLimits.playlistBytes) fail("The channel list exceeds 2 MiB.");
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim());
  if (!/^#EXTM3U(?:\s|$)/.test(lines[0] ?? "")) fail("Use an extended M3U channel list.");
  let awaitingUrl = false;
  let count = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    if (/^#EXT-X-/i.test(line)) fail("Import a channel list, not an HLS stream manifest.");
    if (/^#(?:EXTVLCOPT|KODIPROP|EXTHTTP|WEBPROP)(?::|\s)/i.test(line) || /(?:^|\s)(?:http-)?(?:user-agent|referer|referrer|cookie|authorization)\s*=/i.test(line)) fail("Custom playback headers and DRM properties are unsupported.");
    if (line.startsWith("#EXTINF:")) {
      if (awaitingUrl || ++count > guideLimits.channels) fail("Use at most 5000 channels, each with one EXTINF and URL.");
      awaitingUrl = true;
    } else if (!line.startsWith("#")) {
      if (!awaitingUrl) fail("Each channel needs an EXTINF and URL.");
      lines[index] = guideUrl(line, base);
      awaitingUrl = false;
    }
  }
  if (awaitingUrl || !count) fail("The channel list is empty or incomplete.");
  const parsed = parseM3U(lines.join("\n")).channels;
  if (parsed.length !== count) fail("Some M3U attributes are invalid.");
  const ids = new Set<string>();
  return parsed.map(channel => {
    const tvgId = guideIdentifier(channel.tvgId);
    if (ids.has(tvgId)) fail("Each channel needs a unique tvg-id for exact XMLTV mapping.");
    ids.add(tvgId);
    if (["true", "1"].includes(channel.extras?.radio?.toLowerCase() ?? "")) fail("Import television channels here. Use Radio for radio playlists.");
    const logoUrl = channel.tvgLogo ? guideUrl(channel.tvgLogo, base) : null;
    return { id: guideId(sourceId, tvgId), sourceId, tvgId, name: guideText(channel.name || channel.tvgName, 200), group: guideText(channel.groupTitle, 200, true), hasLogo: !!logoUrl, logoUrl, streamUrl: guideUrl(channel.url, base) };
  });
}

// XMLTV permits reduced precision and named zones. This supported subset requires
// minute precision and a numeric offset, Z/UTC/GMT, or its specified UTC default.
export function xmltvTime(value: unknown): number {
  const match = typeof value === "string" && /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s+(Z|UTC|GMT|[+-]\d{4}))?$/.exec(value.trim());
  if (!match) return fail("XMLTV times need minute precision and UTC or a numeric timezone offset.");
  const [, year, month, day, hour, minute, second = "00", zone = "UTC"] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) return fail("XMLTV contains an invalid calendar time.");
  let offset = 0;
  if (/^[+-]/.test(zone!)) {
    const hours = Number(zone!.slice(1, 3)), minutes = Number(zone!.slice(3, 5));
    if (hours > 14 || minutes > 59 || hours === 14 && minutes !== 0) return fail("XMLTV contains an invalid timezone offset.");
    offset = (hours * 60 + minutes) * (zone![0] === "+" ? 1 : -1);
  }
  return date.getTime() - offset * 60_000;
}

export function parseGuidePrograms(text: string, channels: PrivateChannel[]): GuideProgram[] {
  if (Buffer.byteLength(text) > guideLimits.xmlBytes) fail("The XMLTV guide exceeds 16 MiB.");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) fail("XMLTV DTD and entity declarations are unsupported.");
  let elements = 0;
  for (const _ of text.matchAll(/<[A-Za-z_][\w:.-]*(?:\s|\/?>)/g)) if (++elements > guideLimits.elements) fail("The XMLTV guide contains too many elements.");
  if (XMLValidator.validate(text) !== true) fail("The XMLTV guide is not valid XML.");
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: false, htmlEntities: true, maxNestedTags: guideLimits.nesting,
    processEntities: { maxEntitySize: 32, maxExpansionDepth: 1, maxTotalExpansions: 1_000_000, maxExpandedLength: guideLimits.xmlBytes },
    isArray: (_name, path) => typeof path === "string" && ["tv.channel", "tv.programme", "tv.programme.title", "tv.programme.desc"].includes(path),
  }).parse(text);
  if (!record(parsed) || !record(parsed.tv)) return fail("XMLTV needs a tv document root.");
  const tv = parsed.tv;
  const definitions = tv.channel ?? [];
  if (!Array.isArray(definitions) || definitions.length > guideLimits.channels) return fail("XMLTV has too many channel definitions.");
  const defined = new Set<string>();
  for (const definition of definitions) {
    if (!record(definition)) fail("XMLTV has an invalid channel definition.");
    const id = guideIdentifier((definition as Record<string, unknown>)["@_id"]);
    if (defined.has(id)) fail("XMLTV channel IDs must be unique.");
    defined.add(id);
  }
  const mapping = new Map(channels.map(channel => [channel.tvgId, channel.id]));
  if (channels.some(channel => !defined.has(channel.tvgId))) fail("Each M3U tvg-id must match an XMLTV channel id exactly.");
  const rows = tv.programme ?? [];
  if (!Array.isArray(rows) || rows.length > guideLimits.programs) return fail("XMLTV supports at most 100000 programs.");
  const scalar = (value: unknown, max: number, optional = false) => {
    const first = Array.isArray(value) ? value[0] : value;
    return guideText(record(first) ? first["#text"] : first, max, optional);
  };
  const ids = new Set<string>();
  return rows.flatMap(row => {
    if (!record(row)) return fail("XMLTV contains an invalid program.");
    const channelId = mapping.get(guideIdentifier(row["@_channel"]));
    if (!channelId) return [];
    const start = xmltvTime(row["@_start"]), end = xmltvTime(row["@_stop"]);
    if (end <= start || end - start > 7 * 24 * 60 * 60_000) return fail("Programs need a stop time after start, at most seven days later.");
    const id = guideId(channelId, String(start));
    if (ids.has(id)) return fail("XMLTV repeats a program start for the same channel.");
    ids.add(id);
    return [{ id, channelId, start, end, title: scalar(row.title, 300), description: scalar(row.desc, 4000, true) }];
  });
}
