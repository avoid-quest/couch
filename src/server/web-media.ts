import { streamingCommunityLink } from "./streamingcommunity";
import type { VideoQuality } from "../shared/protocol";
import { runYtDlp, type YtDlpOptions } from "./yt-dlp";

export type WebMediaMetadata = { title?: string; thumbnail?: string; duration?: number; live?: boolean };
export type WebMediaSource = { source: string; audioSource?: string; headers?: Record<string, string>; maxVideoHeight?: number; metadata?: WebMediaMetadata; expiry?: { at: number; recover: (signal: AbortSignal) => Promise<WebMediaSource | null> } };

type ResolverOptions = Omit<YtDlpOptions, "signal" | "plugin">;
type Metadata = Record<string, unknown>;
const object = (value: unknown): value is Metadata => typeof value === "object" && value !== null && !Array.isArray(value);

function mediaUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error("Web media must use an HTTP or HTTPS URL without embedded credentials.");
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Web media must use an HTTP or HTTPS URL without embedded credentials.");
  return url.href;
}

function headers(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!object(value) || Object.keys(value).length > 64) throw new Error("The website returned invalid media headers.");
  const result: Record<string, string> = {};
  let size = 0;
  for (const [name, field] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || typeof field !== "string" || /[\u0000-\u001f\u007f]/.test(field)) throw new Error("The website returned invalid media headers.");
    size += Buffer.byteLength(name) + Buffer.byteLength(field);
    if (size > 16 * 1024) throw new Error("The website returned too many media headers.");
    const key = name.toLowerCase();
    if (["host", "content-length", "transfer-encoding", "connection"].includes(key)) continue;
    if (result[key] !== undefined && result[key] !== field) throw new Error("The website returned conflicting media headers.");
    result[key] = field;
  }
  return result;
}

function selectedSource(info: Metadata): string {
  if (info.has_drm === true) throw new Error("This item requires DRM playback, which is not supported.");
  // A DASH fragment base URL is not a playable media file. Give mpv the manifest.
  if (info.protocol === "http_dash_segments") {
    if (typeof info.manifest_url !== "string") throw new Error("This website's segmented format is not supported yet.");
    return mediaUrl(info.manifest_url);
  }
  if (info.protocol !== undefined && !["http", "https", "m3u8", "m3u8_native"].includes(String(info.protocol))) throw new Error("This website's media transport is not supported yet.");
  return mediaUrl(info.url);
}

function parseInfo(output: string): Metadata {
  let info: unknown;
  try { info = JSON.parse(output); } catch { throw new Error("yt-dlp returned invalid media information. Update yt-dlp and try again."); }
  if (!object(info)) throw new Error("yt-dlp returned invalid media information.");
  if (info._type === "playlist" || info._type === "multi_video" || info.entries !== undefined) throw new Error("Open a specific video or track. Webpage playlists are not supported yet.");
  return info;
}

function publicMetadata(info: Metadata): WebMediaMetadata {
  const metadata: WebMediaMetadata = {};
  if (typeof info.title === "string") {
    const title = info.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
    if (title) metadata.title = title;
  }
  if (typeof info.thumbnail === "string") {
    try { metadata.thumbnail = mediaUrl(info.thumbnail); } catch { /* An invalid thumbnail must not prevent playback. */ }
  }
  if (typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration >= 0 && info.duration <= Number.MAX_SAFE_INTEGER) metadata.duration = info.duration;
  if (typeof info.is_live === "boolean") metadata.live = info.is_live;
  else if (info.live_status === "is_live") metadata.live = true;
  else if (["not_live", "was_live", "post_live", "is_upcoming"].includes(String(info.live_status))) metadata.live = false;
  return metadata;
}

function parseMedia(info: Metadata, quality: VideoQuality): WebMediaSource {
  if (info.has_drm === true) throw new Error("This item requires DRM playback, which is not supported.");
  const selected = info.requested_formats === undefined ? [info] : info.requested_formats;
  if (!Array.isArray(selected) || !selected.length || selected.length > 2 || !selected.every(object)) throw new Error("The website returned an unsupported combination of media streams.");
  const baseHeaders = headers(info.http_headers);
  const streamHeaders = selected.map(stream => ({ ...baseHeaders, ...headers(stream.http_headers) }));
  const sharedHeaders = streamHeaders[0]!;
  // libmpv applies one header map to both URLs, so even an extra header would cross stream boundaries.
  if (streamHeaders.some(fields => Object.keys(fields).length !== Object.keys(sharedHeaders).length || Object.entries(sharedHeaders).some(([key, value]) => fields[key] !== value))) throw new Error("This website requires different headers for its audio and video streams, which is not supported yet.");
  let source: string;
  let audioSource: string | undefined;
  const video = selected.find(stream => stream.vcodec !== "none");
  if (selected.length === 1) source = selectedSource(selected[0]!);
  else {
    const audio = selected.find(stream => stream.vcodec === "none" && stream.acodec !== "none");
    if (!video || !audio) throw new Error("The website returned an unsupported combination of media streams.");
    source = selectedSource(video);
    const audioUrl = selectedSource(audio);
    // The same DASH manifest already contains both sets of tracks.
    if (audioUrl !== source) audioSource = audioUrl;
  }
  // DASH manifests contain every representation; the native demuxer applies this cap.
  const maxVideoHeight = video?.protocol === "http_dash_segments" && quality !== "best" ? Number(quality.slice(0, -1)) : undefined;
  const metadata = publicMetadata(info);
  return { source, ...(audioSource ? { audioSource } : {}), ...(Object.keys(sharedHeaders).length ? { headers: sharedHeaders } : {}), ...(maxVideoHeight !== undefined ? { maxVideoHeight } : {}), ...(Object.keys(metadata).length ? { metadata } : {}) };
}

function formatSelector(quality: VideoQuality): string {
  if (quality === "best") return "bv*+ba/b";
  if (!["1080p", "720p", "480p"].includes(quality)) throw new Error("Choose an available video quality.");
  const filter = `[height<=?${quality.slice(0, -1)}]`;
  return `bv*${filter}+ba/b${filter}`;
}

export function createWebMediaResolver(options: ResolverOptions = {}) {
  return async function resolveWebMedia(url: string, signal?: AbortSignal, quality: VideoQuality = "auto", streamingCommunityOrigin?: string): Promise<WebMediaSource> {
    const source = mediaUrl(url);
    const streamingCommunity = streamingCommunityLink(source, streamingCommunityOrigin);
    const plugin = streamingCommunity ? "streamingcommunity" : undefined;
    const selectedQuality = quality === "auto" ? "1080p" : quality;
    const host = new URL(source).hostname;
    const sort = quality === "auto" && (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"))
      ? ["--format-sort", "res,fps,vcodec:vp9"] : [];
    const output = await runYtDlp(["--no-playlist", "--playlist-items", "1", "--dump-single-json", "--format", formatSelector(selectedQuality), ...sort, "--", streamingCommunity ?? source], { ...options, signal, plugin });
    const info = parseInfo(output);
    const media = parseMedia(info, selectedQuality);
    const transport = new URL(media.source);
    const at = Number(transport.searchParams.get("ts")) * 1000;
    // Qualified with Bandcamp's naturally aged mp3-128 URL returning 410 while a
    // fresh resolution of the same track returns the same media. Other 4xx errors
    // and providers do not establish transport expiry.
    if (host.endsWith(".bandcamp.com") && info.extractor === "Bandcamp" && info.format_id === "mp3-128" && !media.audioSource && !media.metadata?.live && transport.protocol === "https:" && /^t\d+\.bcbits\.com$/.test(transport.hostname) && /^\/stream\//.test(transport.pathname) && Number.isSafeInteger(at) && at > 0) {
      media.expiry = { at, recover: async cancellation => {
        if (Date.now() < at) return null;
        cancellation.throwIfAborted();
        const response = await fetch(media.source, { headers: { ...media.headers, Range: "bytes=0-0" }, redirect: "error", signal: AbortSignal.any([cancellation, AbortSignal.timeout(5000)]) }).catch(() => { throw new Error("Couldn't confirm the stream expired. Play it again."); });
        await response.body?.cancel();
        cancellation.throwIfAborted();
        if (response.status !== 410) return null;
        const fresh = await resolveWebMedia(source, cancellation, quality, streamingCommunityOrigin);
        const replacement = new URL(fresh.source);
        if (replacement.origin !== transport.origin || replacement.pathname !== transport.pathname || fresh.metadata?.duration !== media.metadata?.duration || fresh.source === media.source || !fresh.expiry || fresh.expiry.at <= Date.now()) throw new Error("Stream expired. Play it again.");
        return fresh;
      } };
    }
    return media;
  };
}

export function createWebMediaInspector(options: ResolverOptions = {}) {
  return async function inspectWebMedia(url: string, signal?: AbortSignal, streamingCommunityOrigin?: string): Promise<WebMediaMetadata> {
    const source = mediaUrl(url);
    const streamingCommunity = streamingCommunityLink(source, streamingCommunityOrigin);
    const output = await runYtDlp(["--no-playlist", "--playlist-items", "1", "--dump-single-json", "--ignore-no-formats-error", "--", streamingCommunity ?? source], { ...options, signal, plugin: streamingCommunity ? "streamingcommunity" : undefined });
    return publicMetadata(parseInfo(output));
  };
}

export const resolveWebMedia = createWebMediaResolver();
export const inspectWebMedia = createWebMediaInspector();
