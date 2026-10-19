import { publicFetch } from "./public-network";
import { streamingCommunityLink } from "./streamingcommunity";
import type { ExternalSubtitle, VideoQuality } from "../shared/protocol";
import { sourceSubtitle } from "./subtitles";
import { resolveWithYtDlp, runYtDlp, type YtDlpOptions } from "./yt-dlp";
import { providerForUrl } from "../shared/providers";
import { isMovies123Host } from "../shared/movies123";
import { resolveMovies123Link } from "./movies123";
import { movies123Title } from "./providers/movies123";
import { isAnimeSaturnHost } from "../shared/animesaturn";
import { isAnimeUnityHost } from "../shared/animeunity";
import { resolveAnimeSaturnLink } from "./animesaturn";
import { resolveAnimeUnityLink } from "./animeunity";
import { animeSaturnTitle } from "./providers/animesaturn";
import { animeUnityTitle } from "./providers/animeunity";

export type WebMediaMetadata = { title?: string; thumbnail?: string; duration?: number; live?: boolean };
// headers: what yt-dlp sends for these streams; Core's pass-through sends them too (#644 ticket 7).
// audioOnly: the one stream has no video (Bandcamp, SoundCloud).
export type WebMediaSource = { publicNetwork?: boolean; source: string; audioSource?: string; audioOnly?: boolean; subtitles?: ExternalSubtitle[]; headers?: Record<string, string>; metadata?: WebMediaMetadata; expiry?: { at: number; recover: (signal: AbortSignal) => Promise<WebMediaSource | null> } };

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

// yt-dlp drops the formats it sees are DRM, but Vimeo's FairPlay keys show only in its media playlists.
async function rejectDrm(info: Metadata, signal?: AbortSignal) {
  const stream = (Array.isArray(info.requested_formats) ? info.requested_formats : [info]).find(stream => object(stream) && String(stream.protocol).startsWith("m3u8"));
  if (!stream) return;
  const playlist = await publicFetch(mediaUrl(stream.url), { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]) }).then(response => response.text()).catch(() => "");
  if (/#EXT-X-(?:SESSION-)?KEY:.*?(?:URI="skd:\/\/|KEYFORMAT="com\.(?:apple\.streamingkeydelivery|microsoft\.playready)")/.test(playlist)) throw new Error("This item requires DRM playback, which is not supported.");
}

export function parseMedia(info: Metadata, subtitleLanguage: string): WebMediaSource {
  if (info.has_drm === true) throw new Error("This item requires DRM playback, which is not supported.");
  const selected = info.requested_formats === undefined ? [info] : info.requested_formats;
  if (!Array.isArray(selected) || !selected.length || selected.length > 2 || !selected.every(object)) throw new Error("The website returned an unsupported combination of media streams.");
  let source: string;
  let audioSource: string | undefined;
  let subtitles = sourceSubtitles(info, subtitleLanguage);
  if (selected.length === 1) source = selectedSource(selected[0]!);
  else {
    const video = selected.find(stream => stream.vcodec !== "none");
    const audio = selected.find(stream => stream.vcodec === "none" && stream.acodec !== "none");
    if (!video || !audio) throw new Error("The website returned an unsupported combination of media streams.");
    source = selectedSource(video);
    audioSource = selectedSource(audio);
    // hls.js plays an HLS master's picture, sound and subtitles together; an <audio> can't play its sound rendition (StreamingCommunity).
    if ([video, audio].every(stream => String(stream.protocol).startsWith("m3u8")) && typeof video.manifest_url === "string" && video.manifest_url === audio.manifest_url) {
      source = mediaUrl(video.manifest_url);
      audioSource = undefined;
      subtitles = [];
    }
  }
  const metadata = publicMetadata(info);
  return { source, ...(audioSource ? { audioSource } : {}), ...(selected.length === 1 && selected[0]!.vcodec === "none" ? { audioOnly: true } : {}), ...(subtitles.length ? { subtitles } : {}), ...(Object.keys(metadata).length ? { metadata } : {}) };
}

const languageName = (code: string) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; } };

// One file per language, as yt-dlp chose it (--sub-format). Subtitles inside an HLS playlist play in hls.js instead.
// The profile's language and the video's own come first. At most 16: Chromium reports two track
// changes for each one when a subtitle is chosen, and Core takes 60 reports a second.
function sourceSubtitles(info: Metadata, preferred: string): ExternalSubtitle[] {
  if (!object(info.requested_subtitles)) return [];
  const rank = (language = "") => {
    const at = [preferred, info.language].findIndex(wanted => typeof wanted === "string" && !!wanted && language.toLowerCase().startsWith(wanted.toLowerCase().slice(0, 2)));
    return at < 0 ? 2 : at;
  };
  return Object.entries(info.requested_subtitles).flatMap(([language, subtitle]) => {
    if (!object(subtitle) || !["vtt", "srt"].includes(String(subtitle.ext)) || String(subtitle.protocol).startsWith("m3u8")) return [];
    try { return [{ source: sourceSubtitle(mediaUrl(subtitle.url)), title: typeof subtitle.name === "string" ? subtitle.name.slice(0, 100) : languageName(language), language: language.slice(0, 35) }]; } catch { return []; }
  }).sort((a, b) => rank(a.language) - rank(b.language)).slice(0, 16);
}

// Devices play progressive files and HLS; none plays DASH (#644 ticket 6: Shaka only if a source needs it).
const playable = "[protocol!*=dash]";

function formatSelector(quality: VideoQuality): string {
  if (quality === "best") return `bv*${playable}+ba${playable}/b${playable}`;
  if (!["1080p", "720p", "480p"].includes(quality)) throw new Error("Choose an available video quality.");
  const filter = `[height<=?${quality.slice(0, -1)}]`;
  return `bv*${filter}${playable}+ba${playable}/b${filter}${playable}`;
}

export function createWebMediaResolver(options: ResolverOptions = {}) {
  // vp9: the Device plays VP9 (Chromium; #644 ticket 1). Other engines get H.264 and AAC, which every browser plays.
  return async function resolveWebMedia(url: string, signal?: AbortSignal, quality: VideoQuality = "auto", streamingCommunityOrigin?: string, vp9 = true, subtitleLanguage = ""): Promise<WebMediaSource> {
    const source = mediaUrl(url);
    const streamingCommunity = streamingCommunityLink(source, streamingCommunityOrigin);
    const plugin = streamingCommunity ? "streamingcommunity" : undefined;
    const selectedQuality = quality === "auto" ? "1080p" : quality;
    const host = new URL(source).hostname;
    const direct = isMovies123Host(host) ? await resolveMovies123Link(source, signal, publicFetch, subtitleLanguage)
      : isAnimeSaturnHost(host) ? await resolveAnimeSaturnLink(source, signal)
      : isAnimeUnityHost(host) ? await resolveAnimeUnityLink(source, signal) : undefined;
    const youtube = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
    const sort = youtube ? ["--format-sort", vp9 ? "res,fps,vcodec:vp9" : "res,fps,vcodec:h264,acodec:aac"] : [];
    const sourceHeaders = Object.entries(direct?.headers ?? {}).flatMap(([name, value]) => ["--add-headers", `${name}:${value}`]);
    const { info, media } = await resolveWithYtDlp(["--no-playlist", "--playlist-items", "1", "--dump-single-json", "--format", formatSelector(selectedQuality), ...sort, ...sourceHeaders, "--write-subs", "--sub-langs", "all,-live_chat", "--sub-format", "vtt/srt", "--", direct?.url ?? streamingCommunity ?? source], { ...options, signal, plugin }, plugin ?? providerForUrl(source) ?? "other", async output => {
      const info = parseInfo(output);
      if (info._has_drm === true) await rejectDrm(info, signal);
      return { info, media: parseMedia(info, subtitleLanguage) };
    });
    media.publicNetwork = true;
    if (direct) {
      media.metadata = { ...media.metadata, ...direct.metadata };
      if (direct.subtitles?.length) media.subtitles = direct.subtitles.map(track => ({ ...track, source: sourceSubtitle(track.source) }));
    }
    try { media.headers = headers(info.http_headers); } catch { /* Invalid headers only cost a relay its extra headers. */ }
    if (direct) media.headers = { ...media.headers, ...headers(direct.headers) };
    // A live variant playlist can be tied to yt-dlp's session (RaiPlay's Akamai
    // aka_me_session_id answers 403 to another User-Agent), so a Device, which sends
    // its own headers, opens the master playlist instead.
    if (media.metadata?.live && !media.audioSource && typeof info.manifest_url === "string" && String(info.protocol).startsWith("m3u8")) {
      const response = await publicFetch(media.source, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(5000)]) }).catch(() => null);
      await response?.body?.cancel();
      if (response?.status === 403) media.source = mediaUrl(info.manifest_url);
    }
    const transport = new URL(media.source);
    const at = Number(transport.searchParams.get("ts")) * 1000;
    // Qualified with Bandcamp's naturally aged mp3-128 URL returning 410 while a
    // fresh resolution of the same track returns the same media. Other 4xx errors
    // and providers do not establish transport expiry.
    if (host.endsWith(".bandcamp.com") && info.extractor === "Bandcamp" && info.format_id === "mp3-128" && !media.audioSource && !media.metadata?.live && transport.protocol === "https:" && /^t\d+\.bcbits\.com$/.test(transport.hostname) && /^\/stream\//.test(transport.pathname) && Number.isSafeInteger(at) && at > 0) {
      media.expiry = { at, recover: async cancellation => {
        if (Date.now() < at) return null;
        cancellation.throwIfAborted();
        const response = await publicFetch(media.source, { headers: { ...media.headers, Range: "bytes=0-0" }, redirect: "error", signal: AbortSignal.any([cancellation, AbortSignal.timeout(5000)]) }).catch(() => { throw new Error("Couldn't confirm the stream expired. Play it again."); });
        await response.body?.cancel();
        cancellation.throwIfAborted();
        if (response.status !== 410) return null;
        const fresh = await resolveWebMedia(source, cancellation, quality, streamingCommunityOrigin, vp9, subtitleLanguage);
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
    const host = new URL(source).hostname;
    const inspectTitle = isMovies123Host(host) ? movies123Title : isAnimeSaturnHost(host) ? animeSaturnTitle : isAnimeUnityHost(host) ? animeUnityTitle : undefined;
    if (inspectTitle) {
      const { title, thumbnail, duration } = (await inspectTitle(source, signal)).item;
      return { title, thumbnail, duration };
    }
    const streamingCommunity = streamingCommunityLink(source, streamingCommunityOrigin);
    const output = await runYtDlp(["--no-playlist", "--playlist-items", "1", "--dump-single-json", "--ignore-no-formats-error", "--", streamingCommunity ?? source], { ...options, signal, plugin: streamingCommunity ? "streamingcommunity" : undefined });
    return publicMetadata(parseInfo(output));
  };
}

export const resolveWebMedia = createWebMediaResolver();
export const inspectWebMedia = createWebMediaInspector();
