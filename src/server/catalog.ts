import { providerForUrl } from "../shared/providers";
import type { PlaybackActor } from "../shared/protocol";
import type { LibrarySource } from "../shared/library";
import type { JellyfinSource } from "./jellyfin";
import type { Library } from "./library";
import { RadioError, type createRadio } from "./radio";
import { playbackMediaId, ViewingError } from "./progress";
import type { Store } from "./store";
import type { createSession } from "./session";
import { ControllerError } from "./controllers";

type Services = {
  library: Pick<Library, "listSources" | "search" | "getItem" | "musicArtists" | "musicAlbums" | "albumTracks" | "artwork" | "videoShows" | "videoSeasons">;
  radio: Pick<ReturnType<typeof createRadio>, "search" | "favorites" | "saveFavorite" | "removeFavorite" | "playlistStations">;
  jellyfin: Pick<JellyfinSource, "status" | "items">;
  viewing?: { store: Store; session: ReturnType<typeof createSession> };
};

const progressIdentity = /^(library:[\w-]{1,80}|recording:[a-f0-9-]{36}|file:[a-f0-9]{64}|media:[a-f0-9]{64})$/;

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

function sourceView(source: LibrarySource, trusted: boolean): LibrarySource {
  if (trusted) return source;
  const { path: _path, ...view } = source;
  return { ...view, error: source.error ? "This folder needs attention on the TV." : null };
}

export function createCatalog({ library, radio, jellyfin, viewing }: Services) {
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
          const { activeProfile, queue } = viewing.session.state;
          const queued = new Map(queue.map(entry => [playbackMediaId(entry), entry]));
          const provider = searchParams.get("provider");
          if (provider !== null && !["youtube", "twitch", "raiplay", "bandcamp"].includes(provider)) throw new RequestError("Invalid provider.");
          const items = viewing.store.sharedHistory(queryInteger(searchParams, "limit", 40, 1, 100), mediaId => {
            if (!provider) return true;
            const source = queued.get(mediaId) ?? viewing.store.historySource(mediaId);
            return !!source && source.kind !== "radio" && providerForUrl(source.source.replace(/^web:/, "")) === provider;
          }).map(item => {
            const queueEntry = queued.get(item.mediaId);
            const source = queueEntry ?? viewing.store.historySource(item.mediaId);
            const sourceLabel = source?.source.startsWith("jellyfin:") ? "Jellyfin" : item.libraryItemId ? "Library" : source?.source.startsWith("file:") ? "Local file" : "Online";
            return { ...item, ...(queueEntry ? { queueEntryId: queueEntry.id } : {}), ...(source ? { playable: true, thumbnail: source.thumbnail, artworkId: source.artworkId, sourceLabel } : {}) };
          });
          return Response.json({ items, profile: activeProfile });
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
          if (request.method !== "POST" && request.method !== "DELETE") return methodNotAllowed("POST, DELETE");
          let mediaId: string;
          try { mediaId = decodeURIComponent(pathname.slice("/api/progress/".length)); }
          catch { throw new RequestError("Invalid media identity."); }
          if (!progressIdentity.test(mediaId)) throw new RequestError("Invalid media identity.");
          if (request.method === "DELETE") {
            authorize();
            viewing.session.removeHistory(mediaId);
            return Response.json({ ok: true });
          }
          const changes = await body(request);
          authorize();
          if (Object.keys(changes).some(key => !["watched", "clearResume"].includes(key))
            || changes.watched !== undefined && typeof changes.watched !== "boolean"
            || changes.clearResume !== undefined && changes.clearResume !== true
            || changes.watched === undefined && changes.clearResume === undefined) throw new RequestError("Choose a watched state or clear the resume position.");
          const existing = viewing.store.sharedProgress(mediaId);
          const libraryItemId = mediaId.startsWith("library:") ? mediaId.slice(8) : null;
          const item = existing ?? (libraryItemId ? library.getItem(libraryItemId) : null);
          if (!item) throw new RequestError("Media item not found.", 404);
          viewing.session.editProgress(mediaId, changes as { watched?: boolean; clearResume?: boolean }, { title: item.title, libraryItemId });
          return Response.json({ progress: viewing.store.sharedProgress(mediaId) });
        }
        if (pathname === "/api/library/sources") {
          if (request.method === "GET") return Response.json({ sources: library.listSources().map(source => sourceView(source, trusted)) });
          return methodNotAllowed("GET");
        }
        if (pathname === "/api/library/items") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const videoType = queryText(searchParams, "videoType", 10);
          if (videoType !== "" && videoType !== "movie" && videoType !== "episode") throw new RequestError("Invalid video type.");
          const showId = queryText(searchParams, "showId", 64);
          if (showId && !/^[a-f0-9]{64}$/.test(showId)) throw new RequestError("Invalid show identity.");
          const season = !searchParams.has("season") ? undefined : searchParams.get("season") === "unknown" ? "unknown" : queryInteger(searchParams, "season", 0, 0, 999);
          if (season !== undefined && !showId) throw new RequestError("Choose a show before a season.");
          const result = library.search({ query: queryText(searchParams, "q", 200), artistId: queryText(searchParams, "artistId", 80) || undefined,
            videoType: videoType || undefined, showId: showId || undefined, season,
            offset: queryInteger(searchParams, "offset", 0, 0, 1_000_000), limit: queryInteger(searchParams, "limit", 40, 1, 100) });
          if (viewing) {
            result.items = result.items.map(item => {
              const saved = viewing.store.sharedProgress(`library:${item.id}`);
              const progress = saved ? { position: saved.position, duration: saved.duration, watched: saved.watched, lastPlayedAt: saved.lastPlayedAt } : null;
              return { ...item, progress };
            });
          }
          return Response.json(result);
        }
        if (pathname === "/api/library/video/shows") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          return Response.json(library.videoShows({ query: queryText(searchParams, "q", 200), offset: queryInteger(searchParams, "offset", 0, 0, 1_000_000), limit: queryInteger(searchParams, "limit", 40, 1, 100) }));
        }
        const seasons = /^\/api\/library\/video\/shows\/([a-f0-9]{64})\/seasons$/.exec(pathname);
        if (seasons) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const items = library.videoSeasons(seasons[1]!);
          if (!items.length) throw new RequestError("Show not found.", 404);
          return Response.json({ items });
        }
        if (pathname === "/api/library/music/artists" || pathname === "/api/library/music/albums") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const options = { query: queryText(searchParams, "q", 200), offset: queryInteger(searchParams, "offset", 0, 0, 1_000_000), limit: queryInteger(searchParams, "limit", 40, 1, 100) };
          return Response.json(pathname.endsWith("artists") ? library.musicArtists(options) : library.musicAlbums({ ...options, artistId: queryText(searchParams, "artistId", 80) || undefined }));
        }
        const album = /^\/api\/library\/music\/albums\/([\w-]{1,80})$/.exec(pathname);
        if (album) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          try { return Response.json(library.albumTracks(album[1]!)); }
          catch { throw new RequestError("This album is unavailable or has more than 500 tracks. Browse its tracks in All media.", 404); }
        }
        const artwork = /^\/api\/library\/artwork\/([a-f0-9]{64})$/.exec(pathname);
        if (artwork) {
          if (request.method !== "GET") return methodNotAllowed("GET");
          const image = library.artwork(artwork[1]!);
          if (!image) throw new RequestError("Artwork not found.", 404);
          return new Response(Buffer.from(image.data), { headers: { "Content-Type": image.mimeType, "X-Content-Type-Options": "nosniff" } });
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
        if (pathname === "/api/radio/favorites") {
          if (request.method === "GET") return Response.json({ favorites: radio.favorites() });
          if (request.method !== "POST") return methodNotAllowed("GET, POST");
          const input = await body(request);
          authorize();
          return Response.json({ station: radio.saveFavorite(input.station) });
        }
        const favorite = /^\/api\/radio\/favorites\/([\w-]{1,80})$/.exec(pathname);
        if (favorite) {
          if (request.method !== "DELETE") return methodNotAllowed("DELETE");
          radio.removeFavorite(favorite[1]!);
          return new Response(null, { status: 204 });
        }
        if (pathname === "/api/jellyfin/items") {
          if (request.method !== "GET") return methodNotAllowed("GET");
          if (searchParams.has("resume") && !["true", "false"].includes(searchParams.get("resume")!)) throw new RequestError("Invalid resume query.");
          const options = { query: queryText(searchParams, "q", 200), startIndex: queryInteger(searchParams, "startIndex", 0, 0, 1_000_000), resume: searchParams.get("resume") === "true" };
          if (!jellyfin.status().connected) throw new RequestError("Connect Jellyfin in Settings > Sources first.", 409);
          try { return Response.json(await jellyfin.items(options)); }
          catch { throw new RequestError("Could not load the Jellyfin library. Check the server connection.", 502); }
        }
        return Response.json({ error: "Not found." }, { status: 404 });
      } catch (error) {
        if (error instanceof RequestError || error instanceof RadioError || error instanceof ViewingError || error instanceof ControllerError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "The media catalog is temporarily unavailable." }, { status: 500 });
      }
    },
  };
}
