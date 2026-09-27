import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Jellyfin, type Api } from "@jellyfin/sdk";
import type { BaseItemDto, DeviceProfile, MediaSourceInfo, PlaybackProgressInfo } from "@jellyfin/sdk/lib/generated-client";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import { getImageApi } from "@jellyfin/sdk/lib/utils/api/image-api";
import { boundedBytes } from "./iptv-feeds";
import { videoArtwork } from "./video-metadata";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import { getPlaystateApi } from "@jellyfin/sdk/lib/utils/api/playstate-api";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api";
import { getSystemApi } from "@jellyfin/sdk/lib/utils/api/system-api";
import { getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api/user-library-api";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api/tv-shows-api";
import axios from "axios";
import type { JellyfinConnection, JellyfinItem, JellyfinItems, JellyfinStatus } from "../shared/jellyfin";
import type { BrowserMediaCapabilities, PlayerState, QueueEntry } from "../shared/protocol";
import type { PlaybackContinuation } from "./continuation";

const ticksPerSecond = 10_000_000;
const idPattern = /^[a-f\d]{32}$|^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const subtitleFormats = ["srt", "subrip", "ass", "ssa", "vtt", "webvtt"];
const profile: DeviceProfile = {
  Name: "Couch libmpv",
  MaxStreamingBitrate: 200_000_000,
  MaxStaticBitrate: 200_000_000,
  DirectPlayProfiles: [
    { Type: "Video", Container: "mkv,matroska,mp4,m4v,mov,webm,avi,ts,mpegts,mpg,mpeg", VideoCodec: "h264,hevc,av1,vp8,vp9,mpeg2video,mpeg4", AudioCodec: "aac,mp3,ac3,eac3,dts,truehd,flac,opus,vorbis,pcm_s16le,pcm_s24le" },
    { Type: "Audio", Container: "mp3,flac,ogg,oga,opus,m4a,mp4,aac,wav,aiff,webm", AudioCodec: "aac,mp3,flac,opus,vorbis,alac,pcm_s16le,pcm_s24le" },
  ],
  TranscodingProfiles: [],
  // External PGS is accepted only from Matroska sidecars below.
  SubtitleProfiles: [
    ...[...subtitleFormats, "pgssub", "dvdsub"].map(Format => ({ Format, Method: "Embed" as const })),
    ...[...subtitleFormats, "pgssub"].map(Format => ({ Format, Method: "External" as const })),
  ],
};

function browserProfile(capabilities: BrowserMediaCapabilities): DeviceProfile {
  return {
    Name: "Couch browser", TranscodingProfiles: [], SubtitleProfiles: [],
    DirectPlayProfiles: [
      ...(capabilities.mp4H264Aac ? [{ Type: "Video" as const, Container: "mp4,m4v", VideoCodec: "h264", AudioCodec: "aac" }] : []),
      ...(capabilities.mp3 ? [{ Type: "Audio" as const, Container: "mp3", AudioCodec: "mp3" }] : []),
    ],
    CodecProfiles: [
      { Type: "Video", Codec: "h264", Conditions: [
        { Condition: "EqualsAny", Property: "VideoProfile", Value: "main|high", IsRequired: true },
        ...([ ["Width", "1920"], ["Height", "1080"], ["VideoBitDepth", "8"], ["VideoLevel", "40"] ] as const).map(([Property, Value]) => ({ Condition: "LessThanEqual" as const, Property, Value, IsRequired: true })),
        { Condition: "Equals", Property: "IsInterlaced", Value: "false", IsRequired: true },
      ] },
      { Type: "VideoAudio", Codec: "aac", Conditions: [{ Condition: "LessThanEqual", Property: "AudioChannels", Value: "2", IsRequired: true }] },
    ],
  };
}

type Configuration = { url: string; userId: string; username?: string; accessToken: string; serverName: string; scope: string };
type ActivePlayback = {
  api: Api;
  playbackId: string;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  started: boolean;
  activated: boolean;
  last: PlayerState | null;
  observedAt: number;
  reportedAt: number;
};

function itemView(item: BaseItemDto): JellyfinItem | null {
  if (!item.Id || !idPattern.test(item.Id) || !["Movie", "Episode", "Audio"].includes(item.Type ?? "")) return null;
  const kind = item.Type as JellyfinItem["kind"];
  const duration = Number.isFinite(item.RunTimeTicks) && item.RunTimeTicks! > 0 ? item.RunTimeTicks! / ticksPerSecond : null;
  const position = (item.UserData?.PlaybackPositionTicks ?? 0) / ticksPerSecond;
  return {
    id: item.Id,
    title: (item.Name || "Untitled").slice(0, 300),
    kind,
    detail: (kind === "Episode" ? [item.SeriesName, item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} · E${item.IndexNumber}` : null] : kind === "Audio" ? [item.Artists?.join(", "), item.Album] : [item.ProductionYear?.toString()]).filter(Boolean).join(" · ").slice(0, 300) || null,
    description: item.Overview?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000) || null,
    duration,
    played: item.UserData?.Played === true,
    resumePosition: Number.isFinite(position) && position > 0 && (duration === null || position < duration) ? position : 0,
  };
}

function serverUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter the Jellyfin server URL, including http:// or https://."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Use a Jellyfin server URL without credentials, query parameters, or a fragment.");
  return url.href.replace(/\/+$/, "");
}

function checkedId(id: string) {
  if (!idPattern.test(id)) throw new Error("Invalid Jellyfin item.");
  return id;
}

/** One Jellyfin identity and playback reporter belong to the TV host, never its remotes. */
export function createJellyfin(databasePath: string, options: { now?: () => number; onWarning?: (message: string) => void; onProgress?: () => void; onRelease?: (playbackId: string) => void } = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS jellyfin (id INTEGER PRIMARY KEY CHECK (id = 1), device_id TEXT NOT NULL, configuration TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS jellyfin_artwork (id TEXT PRIMARY KEY, scope TEXT NOT NULL, item_id TEXT NOT NULL, tag TEXT NOT NULL)");
  db.query("INSERT OR IGNORE INTO jellyfin VALUES (1, ?, NULL)").run(crypto.randomUUID());
  const row = db.query<{ device_id: string; configuration: string | null }, []>("SELECT device_id, configuration FROM jellyfin WHERE id = 1").get()!;
  let configuration: Configuration | null = row.configuration ? JSON.parse(row.configuration) : null;
  const client = new Jellyfin({ clientInfo: { name: "Couch", version: "0.1.0" }, deviceInfo: { name: "Shared TV", id: row.device_id } });
  const http = axios.create({ adapter: "fetch", timeout: 10_000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024 });
  let api: Api | null = configuration ? client.createApi(configuration.url, configuration.accessToken, http) : null;
  let active: ActivePlayback | null = null;
  const attempts = new Map<string, ActivePlayback>();
  let generation = 0;
  let configurationGeneration = 0;
  let closed = false;
  let reporting = Promise.resolve();
  let configuring = Promise.resolve();
  const now = options.now ?? Date.now;
  const status = (): JellyfinStatus => ({ connected: configuration !== null, serverName: configuration?.serverName ?? null, username: configuration?.username ?? null });
  const connection = () => {
    if (closed || !configuration || !api) throw new Error("Connect Jellyfin in Settings → Sources first.");
    return { configuration, api };
  };
  // Serialize authentication and logout so a late logout cannot revoke a newly reused device token.
  const configure = <T>(work: () => Promise<T>) => {
    const result = configuring.then(work);
    configuring = result.then(() => undefined, () => undefined);
    return result;
  };
  const revoke = async (previous: Api | null) => {
    // Different URLs can reach the same server. Logging out its reused token would revoke the new connection too.
    if (!previous?.accessToken || api?.accessToken === previous.accessToken) return;
    await getSessionApi(previous).reportSessionEnded().catch(() => undefined);
  };
  const report = (send: () => Promise<unknown>) => {
    reporting = reporting.then(send).then(() => { if (!closed) options.onProgress?.(); }).catch(() => { options.onWarning?.("Jellyfin couldn't save your progress. Check the server connection."); });
    return reporting;
  };
  const release = (playbackId: string) => {
    const previous = attempts.get(playbackId);
    if (!previous) return reporting;
    attempts.delete(playbackId);
    if (active === previous) active = null;
    options.onRelease?.(playbackId);
    if (!previous.started) return reporting;
    return report(() => getPlaystateApi(previous.api).reportPlaybackStopped({ playbackStopInfo: {
      ItemId: previous.itemId, MediaSourceId: previous.mediaSourceId, PlaySessionId: previous.playSessionId,
      PositionTicks: Math.round((previous.last?.position ?? 0) * ticksPerSecond), Failed: previous.last?.status === "error",
    } }));
  };
  const deactivate = () => {
    generation++;
    for (const playbackId of attempts.keys()) void release(playbackId);
    return reporting;
  };
  // Persist opaque references so queue/history artwork survives a host restart.
  const viewItem = (item: BaseItemDto): JellyfinItem | null => {
    const view = itemView(item);
    if (!view || !configuration) return view;
    const image = item.ImageTags?.Primary ? { id: item.Id, tag: item.ImageTags.Primary }
      : item.Type === "Audio" ? { id: item.AlbumId, tag: item.AlbumPrimaryImageTag }
      : item.Type === "Episode" ? { id: item.SeriesId, tag: item.SeriesPrimaryImageTag } : null;
    if (!image?.id || !idPattern.test(image.id) || !image.tag || image.tag.length > 200) return view;
    const artworkId = new Bun.CryptoHasher("sha256").update(JSON.stringify(["jellyfin-artwork", configuration.scope, image.id, image.tag])).digest("hex");
    db.query("INSERT OR IGNORE INTO jellyfin_artwork VALUES (?, ?, ?, ?)").run(artworkId, configuration.scope, image.id, image.tag);
    return { ...view, artworkId };
  };
  const queueEntry = (item: JellyfinItem, id: string, scope: string): QueueEntry => ({
    id, source: `jellyfin:${scope}:${item.id}`, title: item.title,
    ...(item.detail ? { subtitle: item.detail } : {}), ...(item.description ? { description: item.description } : {}),
    ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration == null ? {} : { duration: item.duration }),
  });
  const readItemData = async (itemId: string, signal?: AbortSignal) => {
    const current = connection();
    try {
      const result = await getUserLibraryApi(current.api).getItem({ userId: current.configuration.userId, itemId: checkedId(itemId) }, { signal, validateStatus: status => status === 404 || status >= 200 && status < 300 });
      if (current.api !== api) throw new Error();
      if (result.status === 404) return null;
      const item = itemView(result.data);
      if (!item || item.id !== itemId) throw new Error();
      return result.data;
    } catch { signal?.throwIfAborted(); throw new Error("This Jellyfin item is unavailable. Refresh the library and try again."); }
  };
  const fetchItemData = async (itemId: string, signal?: AbortSignal) => {
    const data = await readItemData(itemId, signal);
    if (!data) throw new Error("This Jellyfin item is unavailable. Refresh the library and try again.");
    return data;
  };
  const fetchItem = async (itemId: string, signal?: AbortSignal) => viewItem(await fetchItemData(itemId, signal))!;
  const externalSubtitles = (current: Api, itemId: string, media: MediaSourceInfo) => {
    const subtitles: { source: string; title: string; language?: string }[] = [];
    const warnings = new Set<string>();
    for (const stream of media.MediaStreams ?? []) {
      if (stream.Type !== "Subtitle" || !stream.IsExternal) continue;
      const codec = stream.Codec?.toLowerCase() ?? "";
      const pgs = codec === "pgssub" && stream.IsTextSubtitleStream === false && stream.Path?.toLowerCase().endsWith(".mks");
      if (!subtitleFormats.includes(codec) && !pgs) {
        warnings.add("Some Jellyfin sidecars are unavailable. Use an embedded image track, a PGS Matroska (.mks) sidecar, or SRT, ASS, SSA or WebVTT subtitles.");
        continue;
      }
      try {
        const delivery = stream.DeliveryUrl ? new URL(stream.DeliveryUrl, `${current.basePath}/`) : null;
        if (stream.IsExternalUrl || (delivery && (delivery.origin !== new URL(current.basePath).origin || delivery.username || delivery.password))) throw new Error();
        if (!Number.isSafeInteger(stream.Index) || stream.Index! < 0) throw new Error();
      } catch {
        warnings.add("Some Jellyfin external subtitles cannot be loaded safely from this server.");
        continue;
      }
      const format = codec === "subrip" ? "srt" : codec === "webvtt" ? "vtt" : codec;
      const language = /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(stream.Language ?? "") ? stream.Language!.toLowerCase() : undefined;
      const title = (stream.DisplayTitle || stream.Title || "").trim();
      if (pgs) warnings.add("Jellyfin may shift PGS Matroska sidecars that start after zero. Use subtitle timing to adjust early cues.");
      subtitles.push({
        // Rebuild the supported API route so upstream paths and URL tokens never reach track labels.
        source: current.getUri(`/Videos/${itemId}/${encodeURIComponent(media.Id!)}/Subtitles/${stream.Index}/Stream.${format}`, { copyTimestamps: true }),
        title: title && !/[\\/\u0000-\u001f]|\b(?:https?|file):/i.test(title) ? title.slice(0, 200) : `${language || "External"} subtitles ${stream.Index}`,
        ...(language ? { language } : {}),
      });
    }
    for (const warning of warnings) options.onWarning?.(warning);
    return { subtitles, subtitleWarning: [...warnings].join(" ") || undefined };
  };

  return {
    status,
    connection: (): JellyfinConnection => ({ ...status(), url: configuration?.url ?? null }),
    async test() {
      const current = connection();
      try {
        const { data } = await getUserApi(current.api).getCurrentUser();
        if (current.api !== api) throw new Error("changed");
        if (data.Id !== current.configuration.userId) throw new Error("identity");
      } catch (error) {
        if (current.api !== api) throw new Error("The Jellyfin connection changed. Test it again.");
        if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) throw new Error("Jellyfin rejected the saved connection. Reconnect with your username and password.");
        throw new Error("Couldn't reach Jellyfin. Check that the server is running.");
      }
      return status();
    },
    async connect(input: { url: string; username: string; password: string }, authorize = () => {}, changed = () => {}) {
      authorize();
      if (closed) throw new Error("The Jellyfin connection is closed.");
      if (typeof input.url !== "string" || input.url.length > 2048 || typeof input.username !== "string" || !input.username.trim() || input.username.length > 200 || typeof input.password !== "string" || input.password.length > 4096) throw new Error("Enter a server URL, username, and password.");
      const candidate = client.createApi(serverUrl(input.url), "", http);
      const requestGeneration = ++configurationGeneration;
      return configure(async () => {
        authorize();
        if (requestGeneration !== configurationGeneration) throw new Error("The Jellyfin connection changed. Try again.");
        let next: Configuration;
        try {
          const info = await getSystemApi(candidate).getPublicSystemInfo();
          const result = await getUserApi(candidate).authenticateUserByName({ authenticateUserByName: { Username: input.username.trim(), Pw: input.password } });
          if (!result.data.User?.Id || !result.data.AccessToken || !info.data.Id) throw new Error();
          candidate.accessToken = result.data.AccessToken;
          const scope = new Bun.CryptoHasher("sha256").update(JSON.stringify([candidate.basePath, info.data.Id, result.data.User.Id])).digest("hex").slice(0, 24);
          next = { url: candidate.basePath, userId: result.data.User.Id, username: (result.data.User.Name || input.username.trim()).slice(0, 200), accessToken: result.data.AccessToken, serverName: (info.data.ServerName || "Jellyfin").slice(0, 200), scope };
        } catch { throw new Error("Couldn't connect to Jellyfin. Check the address, username and password."); }
        try {
          authorize();
          if (requestGeneration === configurationGeneration) await deactivate();
          authorize();
          if (requestGeneration !== configurationGeneration) throw new Error("The Jellyfin connection changed. Try again.");
        } catch (error) {
          await revoke(candidate);
          throw error;
        }
        const previous = api;
        db.query("UPDATE jellyfin SET configuration = ? WHERE id = 1").run(JSON.stringify(next));
        configuration = next;
        api = candidate;
        changed();
        await revoke(previous);
        return status();
      });
    },
    async disconnect(authorize = () => {}, changed = () => {}) {
      authorize();
      configurationGeneration++;
      const previous = api;
      const stopped = deactivate();
      configuration = null;
      api = null;
      db.run("UPDATE jellyfin SET configuration = NULL WHERE id = 1");
      changed();
      await configure(async () => { await stopped; await revoke(previous); });
    },
    async getItem(itemId: string, signal?: AbortSignal): Promise<JellyfinItem | null> {
      const data = await readItemData(itemId, signal);
      return data ? viewItem(data) : null;
    },
    async items({ query = "", startIndex = 0, resume = false }: { query?: string; startIndex?: number; resume?: boolean } = {}): Promise<JellyfinItems> {
      const current = connection();
      if (query.length > 200 || !Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > 1_000_000) throw new Error("Invalid Jellyfin library query.");
      try {
        const parameters = {
          userId: current.configuration.userId, includeItemTypes: ["Movie", "Episode", "Audio"] as JellyfinItem["kind"][],
          searchTerm: query.trim() || undefined, startIndex, limit: 50,
          enableImages: true, fields: ["Overview"] as ["Overview"], enableUserData: true, enableTotalRecordCount: true,
        };
        const { data } = resume
          ? await getItemsApi(current.api).getResumeItems({ ...parameters, excludeActiveSessions: false })
          : await getItemsApi(current.api).getItems({ ...parameters, recursive: true, sortBy: ["SortName"], sortOrder: ["Ascending"] });
        if (api !== current.api) throw new Error();
        return { items: (data.Items ?? []).map(viewItem).filter((item): item is JellyfinItem => item !== null), total: data.TotalRecordCount ?? 0, startIndex };
      } catch { throw new Error("Couldn't load the Jellyfin library. Check the server connection."); }
    },
    async artwork(id: string, signal?: AbortSignal): Promise<{ data: Uint8Array; mimeType: string } | null> {
      if (closed || !configuration || !api || !/^[a-f0-9]{64}$/.test(id)) return null;
      const current = connection();
      const image = db.query<{ item_id: string; tag: string }, [string, string]>("SELECT item_id, tag FROM jellyfin_artwork WHERE id = ? AND scope = ?").get(id, current.configuration.scope);
      if (!image) return null;
      const pending = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
      try {
        const url = getImageApi(current.api).getItemImageUrlById(image.item_id, "Primary", { tag: image.tag, maxWidth: 1024, maxHeight: 1024, format: "Jpg" });
        const response = await fetch(url, { headers: { Authorization: current.api.authorizationHeader }, signal: pending, redirect: "error" });
        if (!response.ok) { await response.body?.cancel(); return null; }
        const result = videoArtwork(await boundedBytes(response, 2 * 1024 * 1024, pending));
        return api === current.api && !closed && !pending.aborted && result ? { data: result.data, mimeType: result.mimeType } : null;
      } catch { return null; }
    },
    async entry(itemId: string, entryId: string): Promise<QueueEntry> {
      const current = connection();
      const item = await fetchItem(itemId);
      if (current.api !== api) throw new Error("The Jellyfin connection changed. Refresh the library.");
      return queueEntry(item, entryId, current.configuration.scope);
    },
    async continuation(reference: string, signal: AbortSignal): Promise<PlaybackContinuation | null> {
      signal.throwIfAborted();
      const current = connection();
      const [scope, itemId, extra] = reference.split(":");
      if (scope !== current.configuration.scope || !itemId || extra !== undefined) return null;
      const item = await fetchItemData(itemId, signal);
      const episode = item.Type === "Episode";
      const parentId = episode ? item.SeriesId : item.Type === "Audio" ? item.AlbumId : null;
      const numbered = (value: number | null | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;
      if (!parentId || !idPattern.test(parentId) || !numbered(item.IndexNumber) || episode && !numbered(item.ParentIndexNumber)) return null;
      const items: BaseItemDto[] = [];
      const ids = new Set<string>();
      while (true) {
        signal.throwIfAborted();
        const parameters = { userId: current.configuration.userId, startIndex: items.length, limit: 100, enableImages: true, fields: ["Overview"] as ["Overview"], enableUserData: false };
        // The Shows endpoint owns series membership; albumIds scopes music to its actual album.
        const { data } = episode
          ? await getTvShowsApi(current.api).getEpisodes({ ...parameters, seriesId: parentId, isMissing: false }, { signal })
          : await getItemsApi(current.api).getItems({ ...parameters, albumIds: [parentId], includeItemTypes: ["Audio"], recursive: true, sortBy: ["ParentIndexNumber", "IndexNumber"], sortOrder: ["Ascending"], enableTotalRecordCount: true }, { signal });
        signal.throwIfAborted();
        if (api !== current.api) return null;
        const page = data.Items ?? [];
        if (page.some(row => !row.Id || ids.has(row.Id))) return null;
        for (const row of page) ids.add(row.Id!);
        items.push(...page);
        if (data.TotalRecordCount != null ? items.length >= data.TotalRecordCount : page.length < 100) break;
        if (!page.length) return null;
      }
      const order = (row: BaseItemDto) => row.ParentIndexNumber ?? 1;
      const seen = new Set<string>();
      const entries = items.sort((a, b) => order(a) - order(b) || (a.IndexNumber ?? Infinity) - (b.IndexNumber ?? Infinity)).flatMap(row => {
        if (row.Type !== item.Type || (episode ? row.SeriesId : row.AlbumId) !== parentId || !numbered(row.IndexNumber)
          || episode && !numbered(row.ParentIndexNumber) || row.IsPlaceHolder || row.LocationType === "Virtual"
          || order(row) < order(item) || order(row) === order(item) && row.IndexNumber <= item.IndexNumber!) return [];
        const key = `${order(row)}:${row.IndexNumber}`;
        const view = viewItem(row);
        if (!view || seen.has(key)) return [];
        seen.add(key);
        return [queueEntry(view, crypto.randomUUID(), scope)];
      });
      return { title: (episode ? item.SeriesName : item.Album) || "Jellyfin", entries };
    },
    async resolve(reference: string, playbackId: string, signal?: AbortSignal, fromStart = false, preparing = false, browser?: BrowserMediaCapabilities) {
      signal?.throwIfAborted();
      const [scope, itemId, extra] = reference.split(":");
      if (!scope || !itemId || extra !== undefined) throw new Error("Invalid Jellyfin item.");
      checkedId(itemId);
      const current = connection();
      if (scope !== current.configuration.scope) throw new Error("This queue item belongs to a different Jellyfin server or account. Add it again from the current library.");
      const requestGeneration = ++generation;
      // A replay must read the position after the preceding stop report has reached Jellyfin.
      await reporting;
      signal?.throwIfAborted();
      if (generation !== requestGeneration || api !== current.api) throw new Error("The playing item changed.");
      const item = await fetchItem(itemId, signal);
      const startPosition = fromStart ? 0 : item.resumePosition;
      let data;
      try {
        ({ data } = await getMediaInfoApi(current.api).getPostedPlaybackInfo({ itemId, playbackInfoDto: {
          UserId: current.configuration.userId, DeviceProfile: browser ? browserProfile(browser) : profile, EnableDirectPlay: true,
          EnableDirectStream: false, EnableTranscoding: false, AutoOpenLiveStream: false,
          StartTimeTicks: Math.round(startPosition * ticksPerSecond),
        } }, { signal }));
      } catch { signal?.throwIfAborted(); throw new Error("Jellyfin couldn't prepare this item."); }
      signal?.throwIfAborted();
      if (generation !== requestGeneration || api !== current.api) throw new Error("The playing item changed.");
      const media = data.MediaSources?.find(source => source.SupportsDirectPlay && !source.RequiresOpening && !source.IsInfiniteStream && source.Id);
      if (data.ErrorCode || !media?.Id || !data.PlaySessionId) throw new Error("Jellyfin can't play this format yet.");
      if (browser) {
        const audio = media.MediaStreams?.filter(stream => stream.Type === "Audio") ?? [];
        const video = media.MediaStreams?.filter(stream => stream.Type === "Video") ?? [];
        const compatible = item.kind === "Audio"
          ? browser.mp3 && media.Container === "mp3" && audio.length === 1 && audio[0]?.Codec === "mp3" && !video.length
          : browser.mp4H264Aac && ["mp4", "m4v"].includes(media.Container ?? "") && video.length === 1 && video[0]?.Codec === "h264" && audio.length === 1 && audio[0]?.Codec === "aac";
        if (!compatible) throw new Error("Jellyfin can't play this format in this browser yet.");
      }
      const { subtitles, subtitleWarning } = browser ? { subtitles: [], subtitleWarning: undefined } : externalSubtitles(current.api, itemId, media);
      const playback = { api: current.api, playbackId, itemId, mediaSourceId: media.Id, playSessionId: data.PlaySessionId, started: false, activated: !preparing, last: null, observedAt: 0, reportedAt: 0 };
      attempts.set(playbackId, playback);
      if (preparing) {
        signal?.addEventListener("abort", () => { if (!playback.activated) void release(playbackId); }, { once: true });
      } else {
        if (active) void release(active.playbackId);
        active = playback;
      }
      return {
        audioOnly: item.kind === "Audio",
        source: current.api.getUri(`/${item.kind === "Audio" ? "Audio" : "Videos"}/${itemId}/stream`, { Static: true, MediaSourceId: media.Id, PlaySessionId: data.PlaySessionId, DeviceId: row.device_id }),
        headers: { Authorization: current.api.authorizationHeader },
        ...(subtitles.length ? { subtitles } : {}),
        ...(subtitleWarning ? { subtitleWarning } : {}),
        ...(startPosition > 0 ? { startPosition } : {}),
      };
    },
    activatePrepared(playbackId: string, previous?: PlayerState, keepPrevious = false) {
      const next = attempts.get(playbackId);
      if (!next || active === next) return;
      if (active && previous?.playbackId === active.playbackId) active.last = previous;
      if (active && !keepPrevious) void release(active.playbackId);
      next.activated = true;
      active = next;
    },
    release,
    observe(player: PlayerState) {
      if (player.status === "unavailable") return deactivate();
      const current = active;
      if (!current || player.playbackId !== current.playbackId) return reporting;
      if (["ended", "error", "idle", "unavailable"].includes(player.status)) {
        const final = player.status === "ended" && Number.isFinite(player.position) && player.position > 0 ? player : current.last ?? player;
        current.last = { ...final, status: player.status };
        return release(current.playbackId);
      }
      if (player.status !== "playing" && player.status !== "paused") return reporting;
      const timestamp = now();
      const previous = current.last;
      const expectedPosition = (previous?.position ?? player.position) + (previous?.status === "playing" ? (timestamp - current.observedAt) / 1000 * (previous.speed ?? 1) : 0);
      const changed = previous && (previous.status !== player.status || Math.abs(expectedPosition - player.position) > 2);
      current.last = { ...player };
      current.observedAt = timestamp;
      if (current.started && !changed && timestamp - current.reportedAt < 15_000) return reporting;
      const info: PlaybackProgressInfo = {
        ItemId: current.itemId, MediaSourceId: current.mediaSourceId, PlaySessionId: current.playSessionId,
        PositionTicks: Math.round(player.position * ticksPerSecond), CanSeek: player.seekable,
        IsPaused: player.status === "paused", VolumeLevel: Math.round(player.volume), PlayMethod: "DirectPlay",
      };
      const started = current.started;
      current.started = true;
      current.reportedAt = timestamp;
      return report(() => started
        ? getPlaystateApi(current.api).reportPlaybackProgress({ playbackProgressInfo: info })
        : getPlaystateApi(current.api).reportPlaybackStart({ playbackStartInfo: info }));
    },
    deactivate,
    async close() {
      if (closed) return;
      closed = true;
      configurationGeneration++;
      await deactivate();
      await configuring;
      api = null;
      db.close();
    },
  };
}

export type JellyfinSource = ReturnType<typeof createJellyfin>;
