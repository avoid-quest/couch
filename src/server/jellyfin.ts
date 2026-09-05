import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Jellyfin, type Api } from "@jellyfin/sdk";
import type { BaseItemDto, DeviceProfile, MediaSourceInfo, PlaybackProgressInfo } from "@jellyfin/sdk/lib/generated-client";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import { getPlaystateApi } from "@jellyfin/sdk/lib/utils/api/playstate-api";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api";
import { getSystemApi } from "@jellyfin/sdk/lib/utils/api/system-api";
import { getUserLibraryApi } from "@jellyfin/sdk/lib/utils/api/user-library-api";
import axios from "axios";
import type { JellyfinItem, JellyfinItems, JellyfinStatus } from "../shared/jellyfin";
import type { PlayerState, QueueEntry } from "../shared/protocol";

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
  // Embedded tracks stay in the original file; text sidecars use Jellyfin's subtitle API.
  SubtitleProfiles: [
    ...[...subtitleFormats, "pgssub", "dvdsub"].map(Format => ({ Format, Method: "Embed" as const })),
    ...subtitleFormats.map(Format => ({ Format, Method: "External" as const })),
  ],
};

type Configuration = { url: string; userId: string; username?: string; accessToken: string; serverName: string; scope: string };
type ActivePlayback = {
  api: Api;
  playbackId: string;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  started: boolean;
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
    detail: kind === "Episode" ? item.SeriesName ?? null : kind === "Audio" ? item.Artists?.join(", ") || item.Album || null : item.ProductionYear?.toString() ?? null,
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
export function createJellyfin(databasePath: string, options: { now?: () => number; onWarning?: (message: string) => void; onProgress?: () => void } = {}) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE IF NOT EXISTS jellyfin (id INTEGER PRIMARY KEY CHECK (id = 1), device_id TEXT NOT NULL, configuration TEXT)");
  db.query("INSERT OR IGNORE INTO jellyfin VALUES (1, ?, NULL)").run(crypto.randomUUID());
  const row = db.query<{ device_id: string; configuration: string | null }, []>("SELECT device_id, configuration FROM jellyfin WHERE id = 1").get()!;
  let configuration: Configuration | null = row.configuration ? JSON.parse(row.configuration) : null;
  const client = new Jellyfin({ clientInfo: { name: "Couch", version: "0.1.0" }, deviceInfo: { name: "Shared TV", id: row.device_id } });
  const http = axios.create({ adapter: "fetch", timeout: 10_000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024 });
  let api: Api | null = configuration ? client.createApi(configuration.url, configuration.accessToken, http) : null;
  let active: ActivePlayback | null = null;
  let generation = 0;
  let configurationGeneration = 0;
  let closed = false;
  let reporting = Promise.resolve();
  let configuring = Promise.resolve();
  const now = options.now ?? Date.now;
  const status = (): JellyfinStatus => ({ connected: configuration !== null, serverName: configuration?.serverName ?? null, username: configuration?.username ?? null });
  const connection = () => {
    if (closed || !configuration || !api) throw new Error("Connect a Jellyfin server on the TV first.");
    return { configuration, api };
  };
  // Serialize authentication and logout so a late logout cannot revoke a newly reused device token.
  const configure = <T>(work: () => Promise<T>) => {
    const result = configuring.then(work);
    configuring = result.then(() => undefined, () => undefined);
    return result;
  };
  const revoke = async (previous: Api | null) => {
    if (!previous?.accessToken || (api?.basePath === previous.basePath && api.accessToken === previous.accessToken)) return;
    await getSessionApi(previous).reportSessionEnded().catch(() => undefined);
  };
  const report = (send: () => Promise<unknown>) => {
    reporting = reporting.then(send).then(() => { if (!closed) options.onProgress?.(); }).catch(() => { options.onWarning?.("Jellyfin could not save playback progress. Check the server connection."); });
    return reporting;
  };
  const deactivate = () => {
    generation++;
    const previous = active;
    active = null;
    if (!previous?.started) return reporting;
    return report(() => getPlaystateApi(previous.api).reportPlaybackStopped({ playbackStopInfo: {
      ItemId: previous.itemId, MediaSourceId: previous.mediaSourceId, PlaySessionId: previous.playSessionId,
      PositionTicks: Math.round((previous.last?.position ?? 0) * ticksPerSecond), Failed: previous.last?.status === "error",
    } }));
  };
  const fetchItem = async (itemId: string, signal?: AbortSignal) => {
    const current = connection();
    try {
      const result = await getUserLibraryApi(current.api).getItem({ userId: current.configuration.userId, itemId: checkedId(itemId) }, { signal });
      if (current.api !== api) throw new Error();
      const item = itemView(result.data);
      if (!item || item.id !== itemId) throw new Error();
      return item;
    } catch { signal?.throwIfAborted(); throw new Error("This Jellyfin item is unavailable. Refresh the library and try again."); }
  };
  const externalSubtitles = (current: Api, itemId: string, media: MediaSourceInfo) => {
    const subtitles: { source: string; title: string; language?: string }[] = [];
    const warnings = new Set<string>();
    for (const stream of media.MediaStreams ?? []) {
      if (stream.Type !== "Subtitle" || !stream.IsExternal) continue;
      const codec = stream.Codec?.toLowerCase() ?? "";
      if (!subtitleFormats.includes(codec)) {
        warnings.add("Some Jellyfin external subtitles use an unsupported format. SRT, ASS, SSA and WebVTT are supported; external image subtitles need another delivery path.");
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
    async connect(input: { url: string; username: string; password: string }) {
      if (closed) throw new Error("The Jellyfin connection is closed.");
      if (typeof input.url !== "string" || input.url.length > 2048 || typeof input.username !== "string" || !input.username.trim() || input.username.length > 200 || typeof input.password !== "string" || input.password.length > 4096) throw new Error("Enter a server URL, username, and password.");
      const candidate = client.createApi(serverUrl(input.url), "", http);
      const requestGeneration = ++configurationGeneration;
      return configure(async () => {
        if (requestGeneration !== configurationGeneration) throw new Error("The Jellyfin connection changed. Try again.");
        let next: Configuration;
        try {
          const info = await getSystemApi(candidate).getPublicSystemInfo();
          const result = await getUserApi(candidate).authenticateUserByName({ authenticateUserByName: { Username: input.username.trim(), Pw: input.password } });
          if (!result.data.User?.Id || !result.data.AccessToken || !info.data.Id) throw new Error();
          candidate.accessToken = result.data.AccessToken;
          const scope = new Bun.CryptoHasher("sha256").update(JSON.stringify([candidate.basePath, info.data.Id, result.data.User.Id])).digest("hex").slice(0, 24);
          next = { url: candidate.basePath, userId: result.data.User.Id, username: (result.data.User.Name || input.username.trim()).slice(0, 200), accessToken: result.data.AccessToken, serverName: (info.data.ServerName || "Jellyfin").slice(0, 200), scope };
        } catch { throw new Error("Could not connect to Jellyfin. Check the server address, username, and password."); }
        if (requestGeneration === configurationGeneration) await deactivate();
        if (requestGeneration !== configurationGeneration) {
          await revoke(candidate);
          throw new Error("The Jellyfin connection changed. Try again.");
        }
        const previous = api;
        db.query("UPDATE jellyfin SET configuration = ? WHERE id = 1").run(JSON.stringify(next));
        configuration = next;
        api = candidate;
        await revoke(previous);
        return status();
      });
    },
    async disconnect() {
      configurationGeneration++;
      const previous = api;
      const stopped = deactivate();
      configuration = null;
      api = null;
      db.run("UPDATE jellyfin SET configuration = NULL WHERE id = 1");
      await configure(async () => { await stopped; await revoke(previous); });
    },
    async items({ query = "", startIndex = 0, resume = false }: { query?: string; startIndex?: number; resume?: boolean } = {}): Promise<JellyfinItems> {
      const current = connection();
      if (query.length > 200 || !Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > 1_000_000) throw new Error("Invalid Jellyfin library query.");
      try {
        const parameters = {
          userId: current.configuration.userId, includeItemTypes: ["Movie", "Episode", "Audio"] as JellyfinItem["kind"][],
          searchTerm: query.trim() || undefined, startIndex, limit: 50,
          enableImages: false, enableUserData: true, enableTotalRecordCount: true,
        };
        const { data } = resume
          ? await getItemsApi(current.api).getResumeItems({ ...parameters, excludeActiveSessions: false })
          : await getItemsApi(current.api).getItems({ ...parameters, recursive: true, sortBy: ["SortName"], sortOrder: ["Ascending"] });
        if (api !== current.api) throw new Error();
        return { items: (data.Items ?? []).map(itemView).filter((item): item is JellyfinItem => item !== null), total: data.TotalRecordCount ?? 0, startIndex };
      } catch { throw new Error("Could not load the Jellyfin library. Check the server connection."); }
    },
    async entry(itemId: string, entryId: string): Promise<QueueEntry> {
      const current = connection();
      const item = await fetchItem(itemId);
      if (current.api !== api) throw new Error("The Jellyfin connection changed. Refresh the library.");
      return { id: entryId, source: `jellyfin:${current.configuration.scope}:${item.id}`, title: item.detail && item.kind !== "Movie" ? `${item.detail} · ${item.title}`.slice(0, 300) : item.title };
    },
    async resolve(reference: string, playbackId: string, signal?: AbortSignal, fromStart = false) {
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
          UserId: current.configuration.userId, DeviceProfile: profile, EnableDirectPlay: true,
          EnableDirectStream: false, EnableTranscoding: false, AutoOpenLiveStream: false,
          StartTimeTicks: Math.round(startPosition * ticksPerSecond),
        } }, { signal }));
      } catch { signal?.throwIfAborted(); throw new Error("Jellyfin could not prepare this item for playback."); }
      signal?.throwIfAborted();
      if (generation !== requestGeneration || api !== current.api) throw new Error("The playing item changed.");
      const media = data.MediaSources?.find(source => source.SupportsDirectPlay && !source.RequiresOpening && !source.IsInfiniteStream && source.Id);
      if (data.ErrorCode || !media?.Id || !data.PlaySessionId) throw new Error("This item needs a playback format that is not supported yet. Jellyfin direct play is currently supported; remuxing and transcoding are not enabled.");
      const { subtitles, subtitleWarning } = externalSubtitles(current.api, itemId, media);
      active = { api: current.api, playbackId, itemId, mediaSourceId: media.Id, playSessionId: data.PlaySessionId, started: false, last: null, observedAt: 0, reportedAt: 0 };
      return {
        source: current.api.getUri(`/${item.kind === "Audio" ? "Audio" : "Videos"}/${itemId}/stream`, { Static: true, MediaSourceId: media.Id, PlaySessionId: data.PlaySessionId, DeviceId: row.device_id }),
        headers: { Authorization: current.api.authorizationHeader },
        ...(subtitles.length ? { subtitles } : {}),
        ...(subtitleWarning ? { subtitleWarning } : {}),
        ...(startPosition > 0 ? { startPosition } : {}),
      };
    },
    observe(player: PlayerState) {
      if (player.status === "unavailable") return deactivate();
      const current = active;
      if (!current || player.playbackId !== current.playbackId) return reporting;
      if (["ended", "error", "idle", "unavailable"].includes(player.status)) {
        const final = player.status === "ended" && Number.isFinite(player.position) && player.position > 0 ? player : current.last ?? player;
        current.last = { ...final, status: player.status };
        return deactivate();
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
