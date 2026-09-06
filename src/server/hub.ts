import type { HTMLBundle, ServerWebSocket } from "bun";
import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { PlaybackCommand, ServerMessage } from "../shared/protocol";
import { createSession } from "./session";
import { createAppearance } from "./appearance";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import { createMediaFolders } from "./media-folders";
import { createFolderSettings } from "./folder-settings";
import { createLibrary } from "./library";
import { createRadio } from "./radio";
import { createRadioSettings } from "./radio-settings";
import { createJellyfin } from "./jellyfin";
import { createJellyfinSettings } from "./jellyfin-settings";
import { createCatalog } from "./catalog";
import { inspectWebMedia, resolveWebMedia } from "./web-media";
import { createProviders } from "./providers";
import { loadBandcampAlbum } from "./providers/bandcamp";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";
import { createPlaylists } from "./playlists";
import { ControllerError, createControllers } from "./controllers";
import type { ControllerIdentity } from "../shared/controllers";
import { buildInfo } from "./build-info";
import { createGuide } from "./iptv";

type HubOptions = {
  hostname?: string;
  port?: number;
  databasePath: string;
  hostToken: string;
  pairingCode?: string;
  adminRecoveryCode?: string;
  sendPlayer: (command: PlaybackCommand) => void;
  frontend?: HTMLBundle;
  development?: boolean;
  advertisedUrls?: string[];
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const tauriOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);
type SocketData = { trusted: boolean; controllerId: string | null; authorize: () => void; window: number; count: number };

export function createHub(options: HubOptions) {
  if (options.hostToken.length < 32) throw new Error("The private host token must contain at least 32 characters.");
  const advertised = (options.advertisedUrls ?? []).map(value => {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Advertised LAN addresses must be plain HTTP origins without credentials or paths.");
    return url.origin;
  });
  const store = openStore(options.databasePath);
  const pairingCode = options.pairingCode ?? String(randomInt(100000, 1000000));
  const hostname = options.hostname ?? "0.0.0.0";
  const addresses = new Set(["localhost", "127.0.0.1", "::1"]);
  const lanAddresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.address.includes("%")) continue;
      addresses.add(entry.address);
      if (!entry.internal) lanAddresses.add(entry.address);
    }
  }
  const urlFor = (address: string, port: number) => `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
  let closed = false;
  const shutdown = new AbortController();
  const inspections = new Map<string, AbortController>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const jellyfin = createJellyfin(options.databasePath, { onWarning: message => console.error(message), onProgress: () => session.invalidate("jellyfin") });
  const session = createSession(store, options.sendPlayer, state => {
    if (!closed) server.publish("session", JSON.stringify({ type: "state", state } satisfies ServerMessage));
  }, {
    resolveSource: (entry, playbackId, signal, fromStart, goLive) => {
      if (entry.source.startsWith("web:")) return resolveWebMedia(entry.source.slice(4), signal, entry.quality);
      if (entry.source.startsWith("jellyfin:")) return jellyfin.resolve(entry.source.slice(9), playbackId, signal, fromStart).then(media => subtitles.prepare(media, playbackId, signal));
      if (entry.source.startsWith("library:")) return library.getPlayable(entry.source.slice(8));
      if (entry.source.startsWith("iptv:")) return goLive ? guide.getLivePlayable(entry.source.slice(5), signal) : guide.getPlayable(entry.source.slice(5));
      if (entry.source.startsWith("radio:")) return { ...radio.getPlayable(entry.source.slice(6)), radio: true };
      // Older directory favorites were queued as direct URLs before radio had
      // its own playback policy. Recognize their saved station on the next play.
      if (radio.favorites().some(station => station.url === entry.source)) return { source: entry.source, radio: true };
      return { source: entry.source };
    },
    deactivate: () => { void jellyfin.deactivate(); },
    observe: player => { subtitles.observe(player); void jellyfin.observe(player); },
  });
  const subtitles = createSubtitles(() => session.state.player, (playbackId, subtitle) => session.addSubtitle(playbackId, subtitle));
  const playlists = createPlaylists({ databasePath: options.databasePath, onChange: () => session.invalidate("playlist"), queue: () => session.state.queue, loadQueue: (entries, mode, authorize) => { session.loadQueue(entries, mode, authorize); } });
  const folders = createMediaFolders();
  const library = createLibrary({ folders, databasePath: options.databasePath, onChange: () => session.invalidate("library") });
  const radio = createRadio({ databasePath: options.databasePath, onChange: () => session.invalidate("radio") });
  const folderSettings = createFolderSettings(library, folders);
  const radioSettings = createRadioSettings(radio);
  const guide = createGuide({ databasePath: options.databasePath, onChange: () => session.invalidate("iptv"),
    onSourcesChanged: channelIds => {
      const state = session.state;
      const current = state.queue.find(entry => entry.id === state.currentEntryId);
      if (current && channelIds.some(id => current.source === `iptv:${id}`)) session.command({ type: "stop" });
    },
    enqueue: (channel, playNow) => {
      const existing = session.state.queue.find(entry => entry.source === `iptv:${channel.id}`);
      if (existing) { if (playNow) session.command({ type: "play", entryId: existing.id, fromStart: true }); }
      else session.command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow });
    },
  });
  const providers = createProviders({ databasePath: options.databasePath, onChange: () => session.invalidate("provider") });
  const controllers = createControllers({ store, recoveryCode: options.adminRecoveryCode, onChange: () => session.invalidate("controller"), onRevoke: id => {
    for (const socket of sockets) if (socket.data.controllerId === id) {
      socket.unsubscribe("session");
      socket.close(4001, "This remote's access was revoked. Pair again.");
    }
  } });
  const appearance = createAppearance(store, value => session.updateAppearance(value));
  const catalog = createCatalog({ library, radio, jellyfin, viewing: { store, session } });
  const jellyfinSettings = createJellyfinSettings({ jellyfin, invalidate: () => {
    const state = session.state;
    if (state.queue.find(entry => entry.id === state.currentEntryId)?.source.startsWith("jellyfin:")) session.command({ type: "stop" });
    session.invalidate("jellyfin");
  } });
  let pairWindow = Date.now();
  let pairAttempts = 0;

  const allowed = (request: Request, requireOrigin: boolean): boolean => {
    const host = request.headers.get("host");
    if (!host || !allowedHosts.has(host.toLowerCase())) return false;
    const origin = request.headers.get("origin");
    return origin === null ? !requireOrigin : allowedOrigins.has(origin) || tauriOrigins.has(origin);
  };
  const cors = (request: Request, response: Response) => {
    response.headers.set("Cache-Control", "no-store");
    const origin = request.headers.get("origin");
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Vary", "Origin");
    }
    return response;
  };

  const server = Bun.serve({
    hostname,
    port: options.port ?? 3800,
    development: options.development ? { hmr: true, console: true } : false,
    maxRequestBodySize: subtitleSizeLimit,
    routes: {
      "/": options.frontend ?? new Response("Couch media server"),
      "/api/health": request => allowed(request, false) ? json({ ok: true, player: session.state.player.status }) : json({ error: "Unrecognized host or origin." }, 403),
      "/api/connection": request => allowed(request, false) ? cors(request, json({ name: store.installationName(), urls: connectionUrls, player: session.state.player.status })) : json({ error: "Unrecognized host or origin." }, 403),
      "/api/pair": {
        POST: async request => {
          if (!allowed(request, true)) return json({ error: "Unrecognized host or origin." }, 403);
          const respond = (body: unknown, status = 200) => cors(request, json(body, status));
          if (Date.now() - pairWindow >= 60_000) { pairWindow = Date.now(); pairAttempts = 0; }
          if (++pairAttempts > 20) return respond({ error: "Too many pairing attempts. Try again in a minute." }, 429);
          if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return respond({ error: "Send a JSON pairing request." }, 415);
          let body: unknown;
          try { body = await request.json(); } catch { return respond({ error: "Invalid pairing request." }, 400); }
          if (typeof body !== "object" || body === null || !("code" in body) || body.code !== pairingCode) return respond({ error: "The pairing code is incorrect." }, 401);
          try {
            const token = store.pair("name" in body ? body.name : undefined);
            session.invalidate("controller");
            return respond({ token, controller: store.controllerForToken(token) });
          } catch (error) {
            return respond({ error: error instanceof ControllerError ? error.message : "Could not save this remote. Check the TV's storage." }, error instanceof ControllerError ? error.status : 500);
          }
        },
      },
    },
    async fetch(request, server) {
      const url = new URL(request.url);
      const websocket = url.pathname === "/api/ws";
      if (!allowed(request, websocket)) return json({ error: "Unrecognized host or origin." }, 403);
      if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" } }));
      const token = websocket ? url.searchParams.get("token") ?? "" : request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const trusted = token === options.hostToken;
      const identity = (): ControllerIdentity | null => {
        if (closed) return null;
        if (trusted) return { controller: null, authority: "host", claimAvailable: controllers.claimAvailable() };
        const controller = store.controllerForToken(token);
        return controller ? { controller, authority: controller.role, claimAvailable: controllers.claimAvailable() } : null;
      };
      const caller = identity();
      if (!caller) return cors(request, json({ error: "Pair this device before connecting." }, 401));
      if (url.pathname === "/api/build" && request.method === "GET") return cors(request, json(buildInfo));
      const authorize = () => { if (!identity()) throw new ControllerError("This remote's access was revoked. Pair again.", 401); };
      if (caller.controller) store.touchController(caller.controller.id);
      if (!websocket && /^\/api\/appearance(?:\/|$)/.test(url.pathname)) return cors(request, await appearance.handle(request, identity));
      if (!websocket && /^\/api\/iptv(?:\/|$)/.test(url.pathname)) return cors(request, await guide.handle(request, identity));
      if (!websocket && (/^\/api\/controllers(?:\/|$)/.test(url.pathname) || url.pathname === "/api/settings")) return cors(request, await controllers.handle(request, identity));
      if (!websocket && /^\/api\/jellyfin(?:\/(?:connection|test))?$/.test(url.pathname)) return cors(request, await jellyfinSettings.handle(request, identity));
      if (!websocket && (/^\/api\/library\/folders(?:\/browse)?$/.test(url.pathname) || /^\/api\/library\/sources\/[\w-]{1,80}(?:\/(?:scan|test|verify))?$/.test(url.pathname) || url.pathname === "/api/library/sources" && request.method !== "GET")) return cors(request, await folderSettings.handle(request, identity));
      if (!websocket && /^\/api\/radio\/(?:sources|playlists(?:\/[\w-]{1,80}(?:\/refresh)?)?)$/.test(url.pathname)) return cors(request, await radioSettings.handle(request, identity));
      if (!websocket) return cors(request, await (url.pathname === "/api/subtitles" ? subtitles.handle(request, authorize) : /^\/api\/playlists(?:\/|$)/.test(url.pathname) ? playlists.handle(request, authorize) : url.pathname.startsWith("/api/providers/") ? providers.handle(request, authorize) : catalog.handle(request, trusted, authorize)));
      return server.upgrade(request, { data: { trusted, controllerId: caller.controller?.id ?? null, authorize, window: Date.now(), count: 0 } }) ? undefined : json({ error: "WebSocket upgrade required." }, 400);
    },
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: 8192,
      backpressureLimit: 4 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 60,
      sendPings: true,
      open(socket) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        sockets.add(socket);
        socket.subscribe("session");
        if (socket.data.trusted) socket.subscribe("navigation");
        socket.send(JSON.stringify({ type: "state", state: session.state } satisfies ServerMessage));
      },
      close(socket) { sockets.delete(socket); },
      async message(socket, message) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        if (socket.data.controllerId) store.touchController(socket.data.controllerId);
        if (Date.now() - socket.data.window >= 1000) { socket.data.window = Date.now(); socket.data.count = 0; }
        if (++socket.data.count > 60) { socket.close(1008, "Too many commands."); return; }
        if (typeof message !== "string") { socket.close(1003, "JSON text messages required."); return; }
        let command;
        try { command = parseCommand(message, socket.data.trusted); } catch {
          socket.close(1008, "Invalid command or unsupported media source.");
          return;
        }
        let result: ServerMessage = { type: "result", requestId: command.requestId, ok: true };
        try {
          const authorize = socket.data.authorize;
          const action = command.action;
          const playIntent = (action.type === "enqueueWeb" || action.type === "enqueueLibrary" || action.type === "enqueueJellyfin" || action.type === "enqueueAlbum" || action.type === "enqueueProviderAlbum" || action.type === "enqueueRadio") && action.playNow
            ? session.reservePlay() : undefined;
          if (action.type === "navigate") {
            if (server.subscriberCount("navigation") === 0) throw new Error("The TV interface is disconnected. Try again when it reconnects.");
            server.publish("navigation", JSON.stringify({ type: "navigation", key: action.key } satisfies ServerMessage));
          } else if (action.type === "enqueueWeb") {
            const source = `web:${action.url}`;
            const title = action.title?.trim();
            session.command({ type: "enqueue", entry: { id: action.entryId, source, title: title || new URL(action.url).hostname, automaticTitle: !title, ...(action.thumbnail ? { thumbnail: action.thumbnail } : {}), ...(action.quality ? { quality: action.quality } : {}) } });
            if (!title) {
              const controller = new AbortController();
              inspections.set(action.entryId, controller);
              void inspectWebMedia(action.url, controller.signal).then(metadata => {
                if (!closed && !controller.signal.aborted) { authorize(); session.enrichEntry(action.entryId, source, metadata); }
              }).catch(() => {}).finally(() => {
                if (inspections.get(action.entryId) === controller) inspections.delete(action.entryId);
              });
            }
          } else if (action.type === "enqueueLibrary") {
            const media = await library.getPlayable(action.itemId);
            if (closed) return;
            authorize();
            const item = library.getItem(action.itemId);
            session.command({ type: "enqueue", entry: { id: action.entryId, title: media.title.slice(0, 300), source: `library:${action.itemId}`, ...(item?.artworkId ? { artworkId: item.artworkId } : {}), ...(item?.duration ? { duration: item.duration } : {}) } });
          } else if (action.type === "enqueueAlbum") {
            const { items } = library.albumTracks(action.albumId);
            if (items.some(item => !item.available)) throw new Error("Some album tracks are unavailable. Reconnect their drive and scan again.");
            const entries = session.loadQueue(items.map(item => ({ id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration ? { duration: item.duration } : {}) })), "append");
            if (action.playNow && entries[0]) session.command({ type: "play", entryId: entries[0].id, fromStart: true }, authorize);
          } else if (action.type === "enqueueProviderAlbum") {
            const page = await loadBandcampAlbum(action.url, shutdown.signal);
            if (closed) return;
            authorize();
            const entries = session.loadQueue(page.items.map(item => ({ id: item.id, title: item.title, source: `web:${item.url}`, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), ...(item.duration === undefined ? {} : { duration: item.duration }) })), "append");
            if (playIntent !== undefined && entries[0]) session.playIfCurrent(playIntent, entries[0].id, true, authorize);
          } else if (action.type === "enqueueRadio") {
            const station = radio.getPlayable(action.stationId);
            session.command({ type: "enqueue", entry: { id: action.entryId, title: station.title, source: `radio:${action.stationId}`, kind: "radio", live: true, ...station.metadata } });
            if (action.playNow) session.command({ type: "play", entryId: action.entryId }, authorize);
          } else if (action.type === "enqueueJellyfin") {
            const entry = await jellyfin.entry(action.itemId, action.entryId);
            if (closed) return;
            authorize();
            session.command({ type: "enqueue", entry });
          } else {
            if (action.type === "remove") inspections.get(action.entryId)?.abort();
            session.command(action, authorize);
          }
          if (playIntent !== undefined && (action.type === "enqueueWeb" || action.type === "enqueueLibrary" || action.type === "enqueueJellyfin")) {
            session.playIfCurrent(playIntent, action.entryId, action.fromStart, authorize);
          }
        } catch (error) {
          result = { ...result, ok: false, error: error instanceof Error ? error.message : "The command failed." };
        }
        socket.send(JSON.stringify(result));
      },
    },
  });

  const port = server.port!;
  const allowedHosts = new Set([...addresses].map(address => new URL(urlFor(address, port)).host).concat(advertised.map(url => new URL(url).host)));
  const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
  const origin = urlFor(hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname, port);
  const urls: string[] = advertised.length ? [...new Set(advertised)] : hostname === "0.0.0.0" || hostname === "::"
    ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port))
    : [origin];
  if (urls.length === 0) urls.push(origin);
  const connectionUrls: string[] = [...new Set([...urls, ...(hostname === "0.0.0.0" || hostname === "::" ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port)) : [origin])])];

  return {
    server, session, pairingCode, urls, origin,
    async close() {
      if (closed) return;
      closed = true;
      shutdown.abort();
      guide.close();
      for (const controller of inspections.values()) controller.abort();
      session.close();
      appearance.close();
      providers.close();
      await server.stop(true);
      subtitles.close();
      playlists.close();
      await Promise.all([library.close(), jellyfin.close()]);
      radio.close();
      store.close();
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
