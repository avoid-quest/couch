import { providerForUrl } from "../shared/providers";
import type { PlaybackActor, QueueEntry, SessionState } from "../shared/protocol";
import type { HistoryItem, WatchingProfile } from "../shared/viewing";
import { RadioError, type createRadio } from "./radio";
import { playbackMediaId, ViewingError } from "./progress";
import type { ProgressSnapshot, Store } from "./store";
import { ControllerError } from "./devices";

type Services = {
  radio: Pick<ReturnType<typeof createRadio>, "search" | "favorites" | "saveFavorite" | "removeFavorite" | "reorderFavorites" | "playlistStations" | "getStation">;
  viewing?: { store: Store; session: Viewing; refreshHistory?: (items: HistoryItem[]) => void };
};
// Profiles and history are shared by every Playback; Play and Queue act for the Device that asks (#644 ticket 9).
export type Viewing = {
  readonly state: Pick<SessionState, "activeProfile" | "queue" | "currentEntryId">;
  createProfile(name: unknown): WatchingProfile;
  renameProfile(id: string, name: unknown, expectedName: string): WatchingProfile;
  namePerson(id: string, name: unknown, expectedName: string): WatchingProfile;
  removeProfile(id: string, expectedName: string): WatchingProfile;
  selectProfile(id: string): WatchingProfile;
  editProgress(mediaId: string, changes: { watched?: boolean; clearResume?: boolean }, item: { title: string }): void;
  removeHistory(mediaId: string): ProgressSnapshot;
  restoreProgress(removed: ProgressSnapshot, expected?: ProgressSnapshot): void;
  loadQueue(entries: QueueEntry[], mode: "append" | "replace" | "play", authorize: () => void, playedBy?: PlaybackActor): void;
  playHistory(mediaId: string, fromStart: boolean, authorize: () => void, playedBy?: PlaybackActor): void;
};

const progressIdentity = /^media:[a-f0-9]{64}$/;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function methodNotAllowed(methods: string) {
  return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: methods } });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new RequestError("Send a JSON object.");
  }
  const value: unknown = await request.json().catch(() => { throw new RequestError("Invalid JSON body."); });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Send a JSON object.");
  return value as Record<string, unknown>;
}

function queryText(params: URLSearchParams, key: string, maximum: number) {
  const value = params.get(key)?.trim() ?? "";
  if (value.length > maximum || /[\0\r\n]/.test(value)) throw new RequestError(`Invalid ${key} query.`);
  return value;
}

function queryInteger(params: URLSearchParams, key: string, fallback: number, minimum: number, maximum: number) {
  const value = params.get(key);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) throw new RequestError(`Invalid ${key} query.`);
  return Number(value);
}

export function createCatalog({ radio, viewing }: Services) {
  type ProgressRows = import("./store").ProgressSnapshot;
  const progressUndo = new Map<string, { rows: ProgressRows; expected: ProgressRows; expiresAt: number; timer: ReturnType<typeof setTimeout> }>();
  const rememberProgress = (rows: ProgressRows, expected: ProgressRows = []) => {
    const undoToken = crypto.randomUUID();
    const expiresAt = Date.now() + 6_000;
    const timer = setTimeout(() => progressUndo.delete(undoToken), 6_000);
    timer.unref?.();
    progressUndo.set(undoToken, { rows, expected, expiresAt, timer });
    return { undoToken, expiresAt };
  };
  const historyView = (item: HistoryItem): HistoryItem => {
    const { queue, currentEntryId } = viewing!.session.state;
    const queueEntry = queue.find(entry => entry.id === currentEntryId && playbackMediaId(entry) === item.mediaId)
      ?? queue.findLast(entry => playbackMediaId(entry) === item.mediaId);
    const saved = viewing!.store.historySource(item.mediaId);
    const source = queueEntry ? { ...queueEntry, ...(saved?.source === queueEntry.source ? { subtitle: saved.subtitle ?? queueEntry.subtitle, description: saved.description ?? queueEntry.description, thumbnail: saved.thumbnail ?? queueEntry.thumbnail, collection: queueEntry.collection ?? (saved.id === queueEntry.id ? saved.collection : undefined) } : {}) } : saved;
    const provider = source && providerForUrl(source.source.replace(/^web:/, ""));
    const sourceLabel = provider ? { youtube: "YouTube", twitch: "Twitch", raiplay: "RaiPlay", bandcamp: "Bandcamp", streamingcommunity: "StreamingCommunity" }[provider] : "Online";
    return { ...item, ...(queueEntry ? { queueEntryId: queueEntry.id } : {}), ...(source ? { playable: true, thumbnail: source.thumbnail, subtitle: source.subtitle, description: source.description, collection: source.collection, sourceLabel } : {}) };
  };
  return {
    async handle(request: Request, trusted: boolean, authorize = () => {}, playedBy?: PlaybackActor): Promise<Response> {
      const { pathname, searchParams } = new URL(request.url);
      try {
        if (viewing && pathname === "/api/profiles") {
          if (request.method === "GET") return Response.json({ profiles: viewing.store.profiles(), activeProfile: viewing.session.state.activeProfile });
          if (request.method !== "POST") return methodNotAllowed("GET, POST");
          const { name } = await body(request);
          authorize();
          return Response.json({ profile: viewing.session.createProfile(name) }, { status: 201 });
        }
        const profileEdit = /^\/api\/profiles\/([\w-]{1,80})\/(rename|remove|person-name)$/.exec(pathname);
        if (viewing && profileEdit) {
          if (request.method !== "POST") return methodNotAllowed("POST");
          const changes = await body(request);
          authorize();
          const allowed = profileEdit[2] !== "remove" ? ["name", "expectedName"] : ["expectedName"];
          if (Object.keys(changes).some(key => !allowed.includes(key))) throw new RequestError("Send only the watching profile change.");
          if (typeof changes.expectedName !== "string" || !changes.expectedName || changes.expectedName.length > 60 || /[\u0000-\u001f\u007f]/.test(changes.expectedName)) throw new RequestError("Reload watching profiles before editing.");
          return profileEdit[2] === "person-name"
            ? Response.json({ profile: viewing.session.namePerson(profileEdit[1]!, changes.name, changes.expectedName) })
            : profileEdit[2] === "rename"
            ? Response.json({ profile: viewing.session.renameProfile(profileEdit[1]!, changes.name, changes.expectedName) })
            : Response.json({ activeProfile: viewing.session.removeProfile(profileEdit[1]!, changes.expectedName) });
        }
        const profileSelection = /^\/api\/profiles\/([\w-]{1,80})\/select$/.exec(pathname);
        if (viewing && profileSelection) {
          if (request.method !== "POST") return methodNotAllowed("POST");
          return Response.json({ profile: viewing.session.selectProfile(profileSelection[1]!) });
        }
        if (viewing && pathname === "/api/progress/history") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const { activeProfile, queue, currentEntryId } = viewing.session.state;
          const queued = new Map(queue.map(entry => [playbackMediaId(entry), entry]));
          const current = queue.find(entry => entry.id === currentEntryId);
          if (current) queued.set(playbackMediaId(current), current);
          const provider = searchParams.get("provider");
          if (provider !== null && !["youtube", "twitch", "raiplay", "bandcamp", "streamingcommunity"].includes(provider)) throw new RequestError("Invalid provider.");
          const items = viewing.store.sharedHistory(queryInteger(searchParams, "limit", 40, 1, 100), mediaId => {
            if (!provider) return true;
            const source = queued.get(mediaId) ?? viewing.store.historySource(mediaId);
            return !!source && source.kind !== "radio" && providerForUrl(source.source.replace(/^web:/, "")) === provider;
          }).map(historyView);
          viewing.refreshHistory?.(items);
          return Response.json({ items, profile: activeProfile });
        }
        if (viewing && pathname === "/api/progress/undo") {
          if (request.method !== "POST") return methodNotAllowed("POST");
          const changes = await body(request);
          authorize();
          if (Object.keys(changes).length !== 1 || typeof changes.token !== "string") throw new RequestError("Send the removal token.");
          const removal = progressUndo.get(changes.token);
          if (!removal || removal.expiresAt < Date.now()) throw new RequestError("Undo is no longer available for this action.", 410);
          viewing.session.restoreProgress(removal.rows, removal.expected);
          clearTimeout(removal.timer);
          progressUndo.delete(changes.token);
          return Response.json({ ok: true });
        }
        const historyQueue = /^\/api\/progress\/([^/]+)\/queue$/.exec(pathname);
        if (viewing && historyQueue) {
          if (request.method !== "POST") return methodNotAllowed("POST");
          const changes = await body(request);
          authorize();
          if (Object.keys(changes).length !== 1 || typeof changes.profileId !== "string") throw new RequestError("Choose the current watching profile.");
          if (changes.profileId !== viewing.session.state.activeProfile.id) throw new RequestError("Playback settings changed. Try again.", 409);
          let mediaId: string;
          try { mediaId = decodeURIComponent(historyQueue[1]!); }
          catch { throw new RequestError("Invalid media identity."); }
          if (!progressIdentity.test(mediaId)) throw new RequestError("Invalid media identity.");
          if (!viewing.store.sharedProgress(mediaId)) throw new RequestError("History item not found.", 404);
          const saved = viewing.session.state.queue.find(entry => playbackMediaId(entry) === mediaId) ?? viewing.store.historySource(mediaId);
          if (!saved || playbackMediaId(saved) !== mediaId) throw new RequestError("Open this item from its source again.", 409);
          viewing.session.loadQueue([saved], "append", authorize, playedBy);
          return Response.json({ ok: true });
        }
        const historyPlay = /^\/api\/progress\/([^/]+)\/play$/.exec(pathname);
        if (viewing && historyPlay) {
          if (request.method !== "POST") return methodNotAllowed("POST");
          const changes = await body(request);
          authorize();
          if (Object.keys(changes).some(key => !["fromStart", "profileId"].includes(key)) || typeof changes.profileId !== "string" || changes.fromStart !== undefined && typeof changes.fromStart !== "boolean") throw new RequestError("Choose resume or play from start.");
          const unchangedSettings = () => {
            authorize();
            if (changes.profileId !== viewing.session.state.activeProfile.id) throw new RequestError("Playback settings changed. Try again.", 409);
          };
          unchangedSettings();
          let mediaId: string;
          try { mediaId = decodeURIComponent(historyPlay[1]!); }
          catch { throw new RequestError("Invalid media identity."); }
          if (!progressIdentity.test(mediaId)) throw new RequestError("Invalid media identity.");
          viewing.session.playHistory(mediaId, changes.fromStart === true, unchangedSettings, playedBy);
          return Response.json({ ok: true });
        }
        if (viewing && pathname.startsWith("/api/progress/")) {
          if (!["GET", "POST", "DELETE"].includes(request.method)) return methodNotAllowed("GET, POST, DELETE");
          let mediaId: string;
          try { mediaId = decodeURIComponent(pathname.slice("/api/progress/".length)); }
          catch { throw new RequestError("Invalid media identity."); }
          if (!progressIdentity.test(mediaId)) throw new RequestError("Invalid media identity.");
          if (request.method === "GET") {
            const item = viewing.store.sharedProgress(mediaId);
            if (!item || item.lastPlayedAt === null) throw new RequestError("History item not found.", 404);
            return Response.json({ item: historyView(item) });
          }
          if (request.method === "DELETE") {
            authorize();
            const rows = viewing.session.removeHistory(mediaId);
            return Response.json({ ok: true, ...rememberProgress(rows) });
          }
          const changes = await body(request);
          authorize();
          if (Object.keys(changes).some(key => !["watched", "clearResume"].includes(key))
            || changes.watched !== undefined && typeof changes.watched !== "boolean"
            || changes.clearResume !== undefined && changes.clearResume !== true
            || changes.watched === undefined && changes.clearResume === undefined) throw new RequestError("Choose a watched state or clear the resume position.");
          const item = viewing.store.sharedProgress(mediaId);
          if (!item) throw new RequestError("Media item not found.", 404);
          const before = changes.clearResume ? viewing.store.sharedProgressRows(mediaId) : null;
          viewing.session.editProgress(mediaId, changes as { watched?: boolean; clearResume?: boolean }, { title: item.title });
          return Response.json({ progress: viewing.store.sharedProgress(mediaId), ...(before?.length ? rememberProgress(before, viewing.store.sharedProgressRows(mediaId)) : {}) });
        }
        const playlist = /^\/api\/radio\/playlists\/([\w-]{1,80})\/stations$/.exec(pathname);
        if (playlist) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          return Response.json({ stations: radio.playlistStations({ playlistId: playlist[1]!, q: queryText(searchParams, "q", 100) }) });
        }
        if (pathname === "/api/radio/stations") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          return Response.json({ stations: await radio.search({ q: queryText(searchParams, "q", 100), countrycode: queryText(searchParams, "countrycode", 2) }) });
        }
        const radioStation = /^\/api\/radio\/stations\/([\w-]{1,80})$/.exec(pathname);
        if (radioStation) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const station = await radio.getStation(radioStation[1]!);
          authorize();
          return Response.json({ station });
        }
        if (pathname === "/api/radio/favorites") {
          if (request.method === "GET") return Response.json({ favorites: radio.favorites() });
          if (request.method !== "POST") return methodNotAllowed("GET, POST");
          const input = await body(request);
          authorize();
          return Response.json({ station: radio.saveFavorite(input.station) });
        }
        if (pathname === "/api/radio/favorites/reorder") {
          if (request.method !== "POST") return methodNotAllowed("POST");
          const input = await body(request);
          authorize();
          radio.reorderFavorites(input.order);
          return Response.json({ ok: true });
        }
        const favorite = /^\/api\/radio\/favorites\/([\w-]{1,80})$/.exec(pathname);
        if (favorite) {
          if (request.method !== "DELETE") return methodNotAllowed("DELETE");
          radio.removeFavorite(favorite[1]!);
          return new Response(null, { status: 204 });
        }
        return Response.json({ error: "Not found." }, { status: 404 });
      } catch (error) {
        if (error instanceof RequestError || error instanceof RadioError || error instanceof ViewingError || error instanceof ControllerError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "The media catalog is temporarily unavailable." }, { status: 500 });
      }
    },
  };
}
