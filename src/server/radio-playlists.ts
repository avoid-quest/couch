import { parseM3U } from "@iptv/playlist";
import { createHash } from "node:crypto";
import type { RadioStation } from "../shared/radio";
import { guideFetch, guideLimits, guideUrl } from "./iptv-feeds";

const maxStations = 5_000;

export function radioHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\|]/.test(value)) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function radioId(value: string): string {
  const hash = createHash("sha256").update(`couch:radio:${value}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function resolveUrl(value: string, base: string): string {
  let url: string | null = null;
  try { url = radioHttpUrl(new URL(value, base).href); } catch { /* Report the same error for malformed and unsupported URLs. */ }
  if (!url || /[\u0000-\u0020\u007f\\|]/.test(value)) throw new Error("Playlist entries need HTTP or HTTPS URLs without credentials or URL header directives.");
  return url;
}

function parseStations(text: string, sourceId: string, url: string): RadioStation[] {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map(line => line.trim());
  if (!/^#EXTM3U(?:\s|$)/.test(lines[0] ?? "")) throw new Error("The feed must be an extended M3U playlist starting with #EXTM3U.");
  let count = 0;
  let needsUrl = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    if (/^#EXT-X-/i.test(line)) throw new Error("This is an HLS stream manifest. Add its URL directly to the queue instead of importing it as a station list.");
    if (/^#(?:EXTVLCOPT|KODIPROP|EXTHTTP|WEBPROP)(?::|\s)/i.test(line) || /(?:^|\s)(?:http-)?(?:user-agent|referer|referrer|cookie|authorization)\s*=/i.test(line)) throw new Error("Playlist playback properties and custom HTTP headers are not supported yet.");
    if (line.startsWith("#EXTINF:")) {
      if (needsUrl) throw new Error("Every playlist station must have one stream URL.");
      if (++count > maxStations) throw new Error(`A radio playlist can contain at most ${maxStations} stations.`);
      needsUrl = true;
    } else if (!line.startsWith("#")) {
      if (!needsUrl) throw new Error("Every playlist station must have an #EXTINF title and one stream URL.");
      lines[index] = resolveUrl(line, url);
      needsUrl = false;
    }
  }
  if (needsUrl) throw new Error("Every playlist station must have one stream URL.");
  const channels = parseM3U(lines.join("\n")).channels;
  if (channels.length !== count) throw new Error("Some playlist stations have invalid titles or attributes.");
  const stations = new Map<string, RadioStation>();
  for (const channel of channels) {
    if (["false", "0"].includes(channel.extras?.radio?.toLowerCase() ?? "")) continue;
    const name = (channel.name || channel.tvgName || "").trim();
    if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Station names must contain 1 to 200 characters.");
    const streamUrl = resolveUrl(channel.url!, url);
    const tvgId = channel.tvgId;
    const groupTitle = channel.groupTitle?.trim();
    if ([tvgId, groupTitle].some(value => value && (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)))) throw new Error("Playlist station IDs and group names must be at most 200 characters.");
    const identityTvgId = tvgId?.trim(); // Preserve installed IDs; guide matching keeps the original value.
    const id = radioId(`${sourceId}\0${identityTvgId ? `tvg:${identityTvgId}` : `url:${streamUrl}`}`);
    if (stations.has(id)) continue;
    let logoUrl: string | undefined;
    if (channel.tvgLogo) {
      try { logoUrl = resolveUrl(channel.tvgLogo, url); } catch { /* Invalid artwork does not block the station. */ }
    }
    stations.set(id, { id, sourceId, name, url: streamUrl, homepage: null, countryCode: "", codec: "", bitrate: 0,
      ...(tvgId ? { tvgId } : {}), ...(groupTitle ? { groupTitle } : {}), ...(logoUrl ? { logoUrl } : {}) });
  }
  return [...stations.values()];
}

export async function readRadioSource(url: string, sourceId: string, request: typeof globalThis.fetch, signal: AbortSignal) {
  const response = await guideFetch(url, guideLimits.playlistBytes, request, signal);
  const text = Buffer.from(response.bytes).toString("utf8");
  const stations = parseStations(text, sourceId, response.url);
  const advertised = parseM3U(text).headers?.xTvgUrl;
  let discoveredGuideUrl: string | null = null;
  if (advertised) {
    try {
      const target = guideUrl(advertised, response.url);
      // Automatic discovery can only fetch from the imported playlist's origin.
      if (new URL(target).origin === new URL(response.url).origin) discoveredGuideUrl = target;
    } catch { /* A malformed optional guide must not remove playable stations. */ }
  }
  return { stations, discoveredGuideUrl };
}

export async function readRadioPlaylist(url: string, sourceId: string, request: typeof globalThis.fetch, signal: AbortSignal): Promise<RadioStation[]> {
  return (await readRadioSource(url, sourceId, request, signal)).stations;
}
