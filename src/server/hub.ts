import { ADMIN_ONLY, NO_LONGER_ADMIN, REMOTES_OFF, STORAGE_ERROR, VERSION_MISMATCH } from "./messages";
import { createLanListener, lanPeer, loopbackPeer } from "./lan-listener";
import { createStreamingCommunitySettings } from "./streamingcommunity-settings";
import { createStartup } from "./startup";
import { requestPeer, serve, type Listener, type Socket, type Upgrade } from "./http";
import { createFrontend } from "./frontend";
import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import type { Action, Domain, PlaybackActor, PlaybackCommand, QueueEntry, ServerMessage } from "../shared/protocol";
import type { ProviderId, ProviderPage, VideoQuality } from "../shared/providers";
import { createSession } from "./session";
import { createAppearance } from "./appearance";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import { createContinuationResolver } from "./continuation";
import { createRadio } from "./radio";
import { createRadioProgramme } from "./radio-programme";
import { createRadioSettings } from "./radio-settings";
import { createCatalog } from "./catalog";
import { createProviderMetadata, providerMetadata } from "./provider-metadata";
import { playbackMediaId } from "./progress";
import { inspectWebMedia, resolveWebMedia } from "./web-media";
import { createProviders } from "./providers";
import { loadProviderList } from "./providers";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";
import { createForLater } from "./for-later";
import { createPlaylists } from "./playlists";
import { ControllerError, createControllers, settingField } from "./controllers";
import type { ControllerIdentity } from "../shared/controllers";
import { buildInfo } from "./build-info";
import { buildKey } from "../shared/build";
import { desktopClientProtocol } from "../shared/desktop-protocol";
import { createGuide } from "./iptv";

import { createSoundRouting } from "./sound-routing";
import { bluetoothSettings } from "./bluetooth";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import { createSound } from "./sound";
import { macSound } from "./sound-mac";
import { windowsSound } from "./sound-windows";
import type { NativeSoundAction } from "./sound-native";
import { displaySettings } from "./display-settings";
import type { DisplayAction, DisplayState } from "../shared/display";

type HubOptions = {
  hostname?: string;
  managedLan?: boolean;
  onAddresses?: (urls: string[]) => void;
  port?: number;
  databasePath: string;
  hostToken: string;
  pairingCode?: string;
  remoteControlEnabled?: boolean;
  adminRecoveryCode?: string;
  sendPlayer: (command: PlaybackCommand) => void;
  nativeBluetooth?: (action: BluetoothAction) => Promise<BluetoothState>;
  nativeDisplay?: (action: DisplayAction) => Promise<DisplayState>;
  native?: boolean;
  nativeSound?: (action: NativeSoundAction) => Promise<unknown>;
  advertisedUrls?: string[];
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const tauriOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]);
const validOriginDomain = (domain: string) => domain.length <= 253 && !isIP(domain) && !/^\d+(?:\.\d+)*$/.test(domain)
  && domain.split(".").every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
const originDomainUrl = (value: string, port: number, legacy = false) => {
  const match = /^(?:http:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?\/?$/i.exec(value);
  if (!match || !validOriginDomain(match[1]!.toLowerCase()) || match[2] && ![80, port].includes(Number(match[2]))) throw new ControllerError("Enter an HTTP hostname, optionally with Couch's port, without a path.");
  const url = new URL(`http://${match[1]!.toLowerCase()}${match[2] ? `:${match[2]}` : legacy ? `:${port}` : ""}`);
  if (url.hostname !== match[1]!.toLowerCase()) throw new ControllerError("Enter a DNS hostname for this computer.");
  return url.origin;
};
type SocketData = { trusted: boolean; controllerId: string | null; authorize: () => void; window: number; count: number };
const providerListEntries = (page: ProviderPage, quality?: VideoQuality): QueueEntry[] => page.items.map(item => ({ id: crypto.randomUUID(), title: item.title, source: `web:${item.url}`, ...providerMetadata(item), ...(item.collection ? { collection: item.collection } : {}), ...(quality ? { quality } : {}), ...(item.duration === undefined ? {} : { duration: item.duration }) }));

export async function createHub(options: HubOptions) {
  if (options.hostToken.length < 32) throw new Error("The private host token must contain at least 32 characters.");
  const advertised = options.managedLan ? [] : (options.advertisedUrls ?? []).map(value => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Advertised LAN addresses must be HTTP or HTTPS origins without credentials or paths.");
    return url.origin;
  });
  const store = openStore(options.databasePath, options.remoteControlEnabled ?? true);
  const pairingCode = options.pairingCode ?? String(randomInt(100000, 1000000));
  const hostname = options.managedLan ? "127.0.0.1" : options.hostname ?? "0.0.0.0";
  let lan: ReturnType<typeof createLanListener<Listener>> | undefined;
  let lanError: string | null = null;
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
  const sockets = new Set<Socket<SocketData>>();
  // A client that stops reading is dropped rather than buffered without limit.
  const send = (socket: Socket<SocketData>, message: string) => socket.bufferedAmount > 4 * 1024 * 1024 ? socket.terminate() : socket.send(message);
  const streamingCommunitySettings = createStreamingCommunitySettings(store);
  const startup = createStartup(async () => null);
  let soundRouting: ReturnType<typeof createSoundRouting> | undefined;
  const macAudio = process.platform === "darwin" && options.nativeSound ? macSound(options.nativeSound) : null;
  const windowsAudio = process.platform === "win32" && options.nativeSound ? windowsSound(options.nativeSound) : null;
  const systemAudio = !!options.native && (process.platform === "linux" || !!macAudio || !!windowsAudio);
  let sound: ReturnType<typeof createSound> | undefined;
  let radioProgramme: ReturnType<typeof createRadioProgramme> | undefined;
  const session = createSession(store, options.sendPlayer, (state, clock) => {
    radioProgramme?.observe(state);
    sound?.interrupt();
    if (!closed && sockets.size) {
      const message = JSON.stringify(clock ? { type: "clock", ...clock } : { type: "state", state } satisfies ServerMessage);
      for (const socket of sockets) send(socket, message);
    }
  }, {
    systemAudio,
    resolveContinuation: (entry, signal) => continuation(entry, signal),
    ...(systemAudio ? { prepareAudio: () => soundRouting!.prepare() } : {}),
    resolveSource: (entry, playbackId, signal, fromStart, goLive) => {
      if (entry.source.startsWith("web:")) return resolveWebMedia(entry.source.slice(4), signal, entry.quality, store.streamingCommunityOrigin());
      if (entry.source.startsWith("iptv:")) return goLive ? guide.getLivePlayable(entry.source.slice(5), signal) : guide.getPlayable(entry.source.slice(5), signal);
      if (entry.source.startsWith("radio:")) {
        const station = radio.getPlayable(entry.source.slice(6));
        radioProgramme?.load(playbackId, entry.source, station.source);
        return { ...station, radio: true };
      }
      // Local files, the library and Jellyfin were removed; their saved entries stay readable but unplayable.
      if (!/^https?:/.test(entry.source)) throw new Error("This source is no longer supported. Remove it from the queue.");
      return { source: entry.source };
    },
    observe: player => subtitles.observe(player),
    stopped: playbackId => subtitles.stopped(playbackId),
  });
  const subtitles = createSubtitles(() => session.state.player, (playbackId, subtitle) => session.addSubtitle(playbackId, subtitle));
  const playlists = createPlaylists({ databasePath: options.databasePath, onChange: () => session.invalidate("playlists"), queue: () => session.state.queue,
    upNext: () => {
      const current = session.state.queue.findIndex(entry => entry.id === session.state.currentEntryId);
      const cursor = current >= 0 ? current : session.state.queue.findIndex(entry => entry.id === session.state.queueCursorEntryId);
      return session.state.queue.slice(cursor + 1);
    },
    loadQueue: (entries, mode, authorize, playedBy, title) => { session.loadQueue(entries, mode, authorize, playedBy, undefined, title); },
    resolveSource: async source => {
      const page = await loadProviderList(source.provider, source.url, shutdown.signal);
      return { name: page.title ?? "Playlist", entries: providerListEntries(page) };
    } });
  const continuation = createContinuationResolver();
  const radio = createRadio({ databasePath: options.databasePath, onChange: () => session.invalidate("radio") });
  radioProgramme = createRadioProgramme({ station: radio.programmeStation, metadata: radio.metadata, publish: (playbackId, programme) => session.updateRadioProgramme(playbackId, programme) });
  const radioSettings = createRadioSettings(radio);
  const guide = createGuide({ databasePath: options.databasePath, onChange: () => session.invalidate("iptv"),
    onSourcesChanged: channelIds => {
      const state = session.state;
      const current = state.queue.find(entry => entry.id === state.currentEntryId);
      if (current && channelIds.some(id => current.source === `iptv:${id}`)) session.command({ type: "stop" });
    },
    enqueue: (channel, playNow, authorize, playedBy) => {
      const existing = session.state.queue.find(entry => entry.source === `iptv:${channel.id}`);
      if (existing) { if (playNow) session.command({ type: "play", entryId: existing.id, fromStart: true }, authorize, playedBy); }
      else session.command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow }, authorize, playedBy);
    },
  });
  const providers = createProviders({ databasePath: options.databasePath, onChange: () => session.invalidate("providers"), streamingCommunityOrigin: () => store.streamingCommunityOrigin() });
  const forLater = createForLater({
    webMetadata: (url, collection) => providerMetadata(providers.cachedItem(url, collection), !!collection),
    databasePath: options.databasePath, onChange: () => session.invalidate("for-later"),
    lookup: async reference => {
      const entry = session.state.queue.find(item => item.id === reference.id);
      if (!entry) throw new ControllerError("This item is no longer in the queue.", 404);
      return entry;
    },
    prepare: async entry => {
      if (entry.source.startsWith("radio:")) radio.getPlayable(entry.source.slice(6));
    },
    reservePlay: () => session.reservePlay(),
    enqueue: (entry, intent, authorize, playedBy) => {
      if (intent !== undefined) session.playNewEntries([entry], { intent, authorize, playedBy });
      else session.command({ type: "enqueue", entry }, authorize, playedBy);
    },
  });
  const controllers = createControllers({ store, pairingCode, recoveryCode: options.adminRecoveryCode, onChange: controller => {
    if (controller?.role === "controller") void options.nativeBluetooth?.({ op: "cancel", owner: controller.id }).catch(() => {});
    session.invalidate("controllers");
  }, onRevoke: id => {
    void options.nativeBluetooth?.({ op: "cancel", owner: id }).catch(() => {});
    for (const socket of sockets) if (socket.data.controllerId === id) {
      sockets.delete(socket);
      socket.close(4001, "This remote's access was revoked. Pair again.");
    }
  } });
  if (systemAudio) soundRouting = createSoundRouting({
    saved: store.audioOutput, savedProfile: store.audioProfile, save: store.saveAudioOutput,
    active: () => ["loading", "playing", "paused"].includes(session.state.player.status),
    pin: output => options.sendPlayer({ type: "audioOutput", output }),
    lost: error => session.audioLost(error), changed: value => session.updateSystemAudio(value),
    ...(macAudio ? { backend: macAudio.routing, subscribe: macAudio.subscribe, platform: "mac" as const } : {}),
    ...(windowsAudio ? { backend: windowsAudio.routing, subscribe: windowsAudio.subscribe, platform: "windows" as const, setSystemDefault: false } : {}),
  });
  const reconnectBluetooth = store.audioProfile()?.bluetoothAddress;
  if (systemAudio && reconnectBluetooth) void options.nativeBluetooth?.({ op: "reconnect", owner: "boot", device: reconnectBluetooth }).catch(() => {});
  sound = createSound({ routing: soundRouting, delay: { get: () => session.state.preferences!.device.audioDelay, set: delay => session.saveAudioDelay(delay) }, available: systemAudio, idle: () => !closed && session.state.player.status === "idle", ...(macAudio ? { backend: macAudio.test, testAvailable: false, platform: "mac" as const } : {}), ...(windowsAudio ? { backend: windowsAudio.test, testAvailable: false, platform: "windows" as const } : {}) });
  const appearance = createAppearance(store, value => session.updateAppearance(value));
  const metadata = createProviderMetadata({ store, cachedItem: providers.cachedItem, onChange: () => session.invalidate("progress") });
  const catalog = createCatalog({ radio, viewing: { store, session, refreshHistory: metadata.refreshHistory } });
  let pairWindow = Date.now();
  let pairAttempts = 0;

  const allowed = (request: Request, requireOrigin: boolean): boolean => {
    if (options.managedLan && !loopbackPeer(requestPeer(request)) && (!store.remoteControlEnabled() || !lan?.network || !lanPeer(lan.network, requestPeer(request)))) return false;
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

  const playbackActor = (controllerId: string | null): PlaybackActor | undefined => {
    if (controllerId === null) return { deviceId: "host", name: store.installationName() };
    const device = store.controller(controllerId);
    return device ? { deviceId: device.id, name: device.name } : undefined;
  };

  // Catalog intake stays private to the hub. Callers do not reserve, normalize
  // or apply play intent; Session alone owns queue order and playback. Already
  // normalized enqueue/transport commands still go directly to Session.
  const enqueueMedia = (action: Action, authorize: () => void, playedBy?: PlaybackActor): Promise<void> | undefined => {
    type Intake = { entry: QueueEntry; fromStart?: boolean; inspectUrl?: string } | { entries: QueueEntry[]; title: string };
    const authorized = () => { if (closed) return false; authorize(); return true; };
    const web = (item: Omit<Extract<Action, { type: "enqueueWeb" }>, "type">): Intake => {
      const title = item.title?.trim();
      return { entry: { id: item.entryId, source: `web:${item.url}`, title: title || new URL(item.url).hostname, automaticTitle: !title, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), ...metadata.cached(item.url), ...(item.quality ? { quality: item.quality } : {}) }, fromStart: item.fromStart, ...(!title ? { inspectUrl: item.url } : {}) };
    };
    const list = async (provider: ProviderId, url: string, quality?: VideoQuality): Promise<Intake> => {
      const page = await loadProviderList(provider, url, shutdown.signal);
      return { entries: providerListEntries(page, quality), title: page.title || "Playlist" };
    };
    let prepare: () => Intake | null | Promise<Intake | null>;
    switch (action.type) {
      case "enqueueWeb": prepare = () => web(action); break;
      case "enqueueProvider":
        prepare = action.shape === "atom" ? () => web({ ...action, entryId: crypto.randomUUID() }) : () => list(action.provider, action.url, action.quality);
        break;
      case "enqueueRadio":
        prepare = () => {
          const station = radio.getPlayable(action.stationId);
          return { entry: { id: action.entryId, title: station.title, source: `radio:${action.stationId}`, kind: "radio", live: true, ...station.metadata } };
        };
        break;
      default: return;
    }
    return (async () => {
      if (!authorized()) return;
      const intent = action.playNow ? session.reservePlay() : undefined;
      const pending = prepare();
      // Do not yield for synchronous intake: a following Stop must not overtake
      // an already prepared atom/album/radio command before its queue mutation.
      const prepared = pending instanceof Promise ? await pending : pending;
      if (!prepared || !authorized()) return;
      for (const entry of "entry" in prepared ? [prepared.entry] : prepared.entries) {
        const mediaId = playbackMediaId(entry);
        if (mediaId && (entry.subtitle || entry.description || entry.thumbnail)) {
          const details = { ...(entry.subtitle ? { subtitle: entry.subtitle } : {}), ...(entry.description ? { description: entry.description } : {}), ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}), ...(entry.collection ? { collection: entry.collection } : {}) };
          try { if (store.enrichHistorySource(mediaId, entry.source, details)) session.invalidate("progress"); } catch { /* Optional catalogue refresh must not prevent playback. */ }
        }
      }
      if ("entry" in prepared) {
        const { entry, inspectUrl } = prepared;
        if (action.type === "enqueueProvider" && action.collection) entry.collection = action.collection;
        if (intent !== undefined) session.playNewEntries([entry], { intent, fromStart: prepared.fromStart, authorize, playedBy });
        else session.command({ type: "enqueue", entry, ...(action.placement ? { placement: action.placement } : {}) }, authorize, playedBy);
        if (entry.source.startsWith("web:")) {
          void metadata.load(entry.source.slice(4)).then(details => {
            if (!closed && Object.keys(details).length) { authorize(); session.enrichEntry(entry.id, entry.source, details, true); }
          }).catch(() => {});
        }
        if (inspectUrl) {
          const controller = new AbortController();
          inspections.set(entry.id, controller);
          void inspectWebMedia(inspectUrl, controller.signal, store.streamingCommunityOrigin()).then(metadata => {
            if (!closed && !controller.signal.aborted) { authorize(); session.enrichEntry(entry.id, entry.source, metadata); }
          }).catch(() => {}).finally(() => {
            if (inspections.get(entry.id) === controller) inspections.delete(entry.id);
          });
        }
      } else {
        if (intent !== undefined) {
          const entries = prepared.entries.map(entry => ({ ...entry, id: crypto.randomUUID() }));
          session.playNewEntries(entries.slice(0, 1), { intent, fromStart: true, authorize, playedBy, continuation: { title: prepared.title, entries: entries.slice(1) } });
        }
        else session.loadQueue(prepared.entries, "append", authorize, playedBy, action.placement);
      }
    })();
  };

  // Settings and device writes bump one revision so every remote refetches that view.
  const writes: [RegExp, Domain[]][] = [
    [/^\/api\/settings\/streamingcommunity$/, ["settings", "providers"]],
    [/^\/api\/settings\//, ["settings"]],
    [/^\/api\/sound(?:\/|$)/, ["sound"]],
    [/^\/api\/bluetooth(?:\/|$)/, ["bluetooth", "sound"]],
    [/^\/api\/display(?:\/|$)/, ["display"]],
  ];
  type Fetch = (request: Request, upgrade: Upgrade<SocketData>) => Promise<Response | undefined>;
  const publishWrites = (handle: Fetch): Fetch => async (request, upgrade) => {
    const response = await handle(request, upgrade);
    if (response?.ok && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const path = new URL(request.url).pathname;
      const domains = writes.find(([pattern]) => pattern.test(path))?.[1];
      if (domains) session.invalidate(...domains);
    }
    return response;
  };

  const frontend = createFrontend();
  const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
    "/api/health": request => allowed(request, false) ? json({ ok: true, player: session.state.player.status }) : json({ error: "Unrecognized host or origin." }, 403),
    "/api/connection": request => allowed(request, false) ? cors(request, json({ name: store.installationName(), installationId: store.installationId(), urls: connectionUrls, player: session.state.player.status, remoteControlEnabled: store.remoteControlEnabled(), ...(options.managedLan ? { lanError } : {}), desktopClientProtocol, tvPresentation: process.env.COUCH_TV_PRESENTATION === "1" })) : json({ error: "Unrecognized host or origin." }, 403),
    "POST /api/pair": async request => {
      if (!allowed(request, true)) return json({ error: "Unrecognized host or origin." }, 403);
      const respond = (body: unknown, status = 200) => cors(request, json(body, status));
      if (!store.remoteControlEnabled()) return respond({ error: REMOTES_OFF(store.installationName()) }, 503);
      if (Date.now() - pairWindow >= 60_000) { pairWindow = Date.now(); pairAttempts = 0; }
      if (++pairAttempts > 20) return respond({ error: "Too many pairing attempts. Try again in a minute." }, 429);
      if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return respond({ error: "Send a JSON pairing request." }, 415);
      let body: unknown;
      try { body = await request.json(); } catch { return respond({ error: "Invalid pairing request." }, 400); }
      if (!store.remoteControlEnabled()) return respond({ error: REMOTES_OFF(store.installationName()) }, 503);
      if (typeof body !== "object" || body === null || !("code" in body) || body.code !== pairingCode) return respond({ error: "The pairing code is incorrect." }, 401);
      try {
        const token = store.pair("name" in body ? body.name : undefined);
        session.invalidate("controllers");
        return respond({ token, controller: store.controllerForToken(token), installationId: store.installationId() });
      } catch (error) {
        return respond({ error: error instanceof ControllerError ? error.message : STORAGE_ERROR("this remote") }, error instanceof ControllerError ? error.status : 500);
      }
    },
  };
  const api = publishWrites(async (request, upgrade) => {
    const url = new URL(request.url);
    const websocket = url.pathname === "/api/ws";
    if (!allowed(request, websocket)) return json({ error: "Unrecognized host or origin." }, 403);
    if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" } }));
    const token = websocket ? url.searchParams.get("token") ?? "" : request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const trusted = token === options.hostToken && (!options.managedLan || loopbackPeer(requestPeer(request)));
    if (!trusted && !store.remoteControlEnabled()) return cors(request, json({ error: REMOTES_OFF(store.installationName()) }, 503));
    const identity = (): ControllerIdentity | null => {
      if (closed) return null;
      if (trusted) return { controller: null, authority: "host", claimAvailable: controllers.claimAvailable() };
      if (!store.remoteControlEnabled()) return null;
      const controller = store.controllerForToken(token);
      return controller ? { controller, authority: controller.role, claimAvailable: controllers.claimAvailable() } : null;
    };
    const caller = identity();
    if (!caller) return cors(request, json({ error: "Pair this remote first." }, 401));
    if (url.pathname === "/api/settings/sharing") {
      if (request.method === "GET") return cors(request, json({ enabled: store.remoteControlEnabled() }));
      if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
      if (!trusted) return cors(request, json({ error: `Change this on ${store.installationName()}.` }, 403));
      try {
        const enabled = await settingField(request, "enabled");
        if (typeof enabled !== "boolean") throw new ControllerError("Choose whether to allow remotes.");
        await lan?.setEnabled(enabled);
        store.saveRemoteControlEnabled(enabled);
        if (!enabled) for (const socket of sockets) if (!socket.data.trusted) {
          sockets.delete(socket);
          socket.close(4003, "Remotes are off. Your pairing is remembered.");
        }
        session.invalidate("controllers");
        return cors(request, json({ enabled }));
      } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Couldn't save Allow remotes." }, error instanceof ControllerError ? error.status : 500)); }
    }
    if (url.pathname === "/api/settings/origin-domain") {
      if (!options.managedLan || caller.authority === "controller") return cors(request, json({ error: ADMIN_ONLY }, 403));
      if (request.method === "GET") return cors(request, json({ domain: store.originDomain() }));
      if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
      try {
        const value = await settingField(request, "domain");
        if (typeof value !== "string") throw new ControllerError("Enter a network address.");
        const domain = value.trim();
        const alias = domain ? originDomainUrl(domain, port) : "";
        if (alias) try { await lan?.validateAlias(alias); }
        catch (error) { throw new ControllerError(error instanceof Error ? error.message : "The network address is unavailable."); }
        if (identity()?.authority === "controller" || !identity()) throw new ControllerError(NO_LONGER_ADMIN, 403);
        const previous = store.originDomain();
        const previousAlias = previous ? originDomainUrl(previous, port, !previous.startsWith("http://")) : "";
        store.saveOriginDomain(alias);
        // Keep only the address used by this administrator until Couch restarts.
        // Its browser can finish the save and continue using its paired session.
        const usingPreviousAlias = previousAlias && (request.headers.get("host")?.toLowerCase() === new URL(previousAlias).host || request.headers.get("origin") === previousAlias);
        if (usingPreviousAlias && previousAlias !== alias) retainedOrigins.add(previousAlias);
        await lan?.refresh().catch(() => {});
        return cors(request, json({ domain: alias }));
      } catch (error) { return cors(request, json({ error: error instanceof ControllerError ? error.message : "Couldn't save the network address." }, error instanceof ControllerError ? error.status : 500)); }
    }
    if (url.pathname === "/api/build" && request.method === "GET") return cors(request, json(buildInfo));
    if (url.pathname === "/api/controllers/me" && request.method === "GET") return cors(request, await controllers.handle(request, identity));
    {
      const playedBy = caller.controller ? { deviceId: caller.controller.id, name: caller.controller.name } : playbackActor(null);
      const currentIdentity = identity;
      const authorize = () => {
        if (!identity()) throw new ControllerError("This remote's access was revoked. Pair again.", 401);
      };
      if (websocket && buildInfo.packaged && (url.searchParams.has("clientProtocol") && tauriOrigins.has(request.headers.get("origin") ?? "")
        ? url.searchParams.get("clientProtocol") !== String(desktopClientProtocol)
        : buildKey(buildInfo) !== url.searchParams.get("build"))) return cors(request, json({ error: VERSION_MISMATCH }, 409));
      if (caller.controller) store.touchController(caller.controller.id);
      if (!websocket && url.pathname === "/api/settings/streamingcommunity") return cors(request, await streamingCommunitySettings.handle(request, currentIdentity));
      if (!websocket && url.pathname === "/api/settings/startup") return cors(request, await startup.handle(request, currentIdentity));
      if (!websocket && /^\/api\/bluetooth(?:\/|$)/.test(url.pathname)) return cors(request, await bluetoothSettings(request, currentIdentity, options.nativeBluetooth));
      if (!websocket && /^\/api\/sound(?:\/|$)/.test(url.pathname)) return cors(request, await sound!.handle(request, currentIdentity));
      if (!websocket && /^\/api\/display(?:\/|$)/.test(url.pathname)) return cors(request, await displaySettings(request, currentIdentity, options.nativeDisplay));
      if (!websocket && /^\/api\/appearance(?:\/|$)/.test(url.pathname)) return cors(request, await appearance.handle(request, currentIdentity));
      if (!websocket && /^\/api\/iptv(?:\/|$)/.test(url.pathname)) return cors(request, await guide.handle(request, currentIdentity, playedBy));
      if (!websocket && (/^\/api\/controllers(?:\/|$)/.test(url.pathname) || (url.pathname === "/api/settings" || url.pathname === "/api/settings/setup"))) return cors(request, await controllers.handle(request, currentIdentity));
      if (!websocket && /^\/api\/radio\/(?:avoid(?:\/programmes)?|sources|playlists(?:\/[\w-]{1,80}(?:\/refresh)?)?)$/.test(url.pathname)) return cors(request, await radioSettings.handle(request, currentIdentity));
      if (!websocket && /^\/api\/for-later(?:\/|$)/.test(url.pathname)) return cors(request, await forLater.handle(request, authorize, playedBy));
      if (!websocket) return cors(request, await (url.pathname === "/api/subtitles" ? subtitles.handle(request, authorize) : /^\/api\/playlists(?:\/|$)/.test(url.pathname) ? playlists.handle(request, authorize, playedBy) : url.pathname.startsWith("/api/providers/") ? providers.handle(request, authorize) : catalog.handle(request, trusted, authorize, playedBy)));
      return upgrade({ trusted, controllerId: caller.controller?.id ?? null, authorize, window: Date.now(), count: 0 }) ? undefined : json({ error: "WebSocket upgrade required." }, 400);
    }
  });
  const serveOptions = {
    hostname,
    port: options.port ?? 3800,
    maxRequestBodySize: subtitleSizeLimit,
    fetch: async (request: Request, upgrade: Upgrade<SocketData>) => {
      const { pathname } = new URL(request.url);
      const route = routes[pathname] ?? routes[`${request.method} ${pathname}`];
      if (route) return route(request);
      const page = ["GET", "HEAD"].includes(request.method) && !pathname.startsWith("/api/") ? await frontend(pathname) : null;
      return page ?? api(request, upgrade);
    },
    websocket: {
      maxPayload: 8192,
      open(socket: Socket<SocketData>) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        sockets.add(socket);
        send(socket, JSON.stringify({ type: "state", state: session.state } satisfies ServerMessage));
      },
      close(socket: Socket<SocketData>) { sockets.delete(socket); if (socket.data.controllerId) void options.nativeBluetooth?.({ op: "cancel", owner: socket.data.controllerId }).catch(() => {}); },
      async message(socket: Socket<SocketData>, message: string | null) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        if (socket.data.controllerId) store.touchController(socket.data.controllerId);
        if (Date.now() - socket.data.window >= 1000) { socket.data.window = Date.now(); socket.data.count = 0; }
        if (++socket.data.count > 60) { socket.close(1008, "Too many commands."); return; }
        if (message === null) { socket.close(1003, "JSON text messages required."); return; }
        let command;
        try { command = parseCommand(message); } catch {
          socket.close(1008, "Invalid command or unsupported media source.");
          return;
        }
        let result: ServerMessage = { type: "result", requestId: command.requestId, ok: true };
        try {
          const playedBy = playbackActor(socket.data.controllerId);
          const authorize = socket.data.authorize;
          const action = command.action;
          const before = session.state;
          const enqueued = enqueueMedia(action, authorize, playedBy);
          if (enqueued) {
            await enqueued;
            if (closed) return;
          } else if (action.type === "navigate") {
            const hosts = [...sockets].filter(socket => socket.data.trusted);
            if (!hosts.length) throw new Error("The TV interface is disconnected. Try again when it reconnects.");
            const navigation = JSON.stringify({ type: "navigation", key: action.key } satisfies ServerMessage);
            for (const host of hosts) send(host, navigation);
          } else {
            if (action.type === "remove") inspections.get(action.entryId)?.abort();
            if (soundRouting && action.type === "volume") await soundRouting.volume(action.volume, authorize);
            else if (soundRouting && action.type === "mute") await soundRouting.mute(action.muted, authorize);
            else {
              if (soundRouting && action.type === "pause" && !action.paused) options.sendPlayer({ type: "audioOutput", output: soundRouting.prepare() });
              await session.command(action, authorize, playedBy);
            }
          }
          if (playedBy && action.type !== "navigate") {
            const added = ["enqueue", "enqueueProvider", "enqueueRadio", "enqueueWeb"].includes(action.type);
            const label = action.type === "pause" ? action.paused ? "paused" : "resumed"
              : action.type === "stop" ? "stopped playback"
              : action.type === "remove" ? `removed ${before.queue.find(entry => entry.id === action.entryId)?.title || "an item"}`
              : added ? `queued ${action.type === "enqueue" ? action.entry.title : action.type === "enqueueProvider" || action.type === "enqueueWeb" ? action.title || "media" : "entryId" in action ? session.state.queue.find(entry => entry.id === action.entryId)?.title || "media" : "media"}`
              : action.type === "play" ? `played ${session.state.queue.find(entry => entry.id === action.entryId)?.title || "media"}` : null;
            if (label) session.notice(playedBy, `${playedBy.name} ${label}`);
          }
        } catch (error) {
          result = { ...result, ok: false, error: error instanceof Error ? error.message : "The command failed." };
        }
        send(socket, JSON.stringify(result));
      },
    },
  };
  const server = await serve(serveOptions);

  const port = server.port;
  const origin = urlFor(hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname, port);
  const allowedHosts = new Set(options.managedLan ? [new URL(origin).host] : [...addresses].map(address => new URL(urlFor(address, port)).host).concat(advertised.map(url => new URL(url).host)));
  const allowedOrigins = new Set(options.managedLan ? [origin] : [...addresses].map(address => new URL(urlFor(address, port)).origin).concat(advertised));
  const urls: string[] = advertised.length ? [...new Set(advertised)] : hostname === "0.0.0.0" || hostname === "::"
    ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port))
    : [origin];
  if (urls.length === 0) urls.push(origin);
  const connectionUrls: string[] = [...new Set([...urls, ...(hostname === "0.0.0.0" || hostname === "::" ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port)) : [origin])])];
  const retainedOrigins = new Set<string>();

  if (options.managedLan) {
    lan = createLanListener({
      port, enabled: store.remoteControlEnabled(), selected: process.env.COUCH_LAN_INTERFACE, address: process.env.COUCH_LAN_ADDRESS,
      advertised: () => [...(store.originDomain() ? [originDomainUrl(store.originDomain(), port, !store.originDomain().startsWith("http://"))] : []), ...retainedOrigins, ...options.advertisedUrls ?? []],
      start: (network, port) => serve({ ...serveOptions, hostname: network.address, port }),
      changed: (next, error) => {
        lanError = error;
        const current = store.originDomain();
        const currentAlias = current ? originDomainUrl(current, port, !current.startsWith("http://")) : "";
        const published = next.filter(url => !retainedOrigins.has(url) || url === currentAlias || options.advertisedUrls?.includes(url));
        urls.splice(0, urls.length, ...published);
        connectionUrls.splice(0, connectionUrls.length, ...published);
        allowedHosts.clear(); allowedOrigins.clear();
        for (const url of [origin, ...next]) { allowedHosts.add(new URL(url).host); allowedOrigins.add(new URL(url).origin); }
        options.onAddresses?.(published);
      },
    });
  }

  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    closed = true;
    shutdown.abort();
    for (const controller of inspections.values()) controller.abort();
    let progressError: unknown;
    try { session.close(); }
    catch (error) { progressError = error; }
    sound?.close();
    soundRouting?.close();
    appearance.close();
    guide.close();
    metadata.close();
    providers.close();
    subtitles.close();
    playlists.close();
    forLater.close();
    radioProgramme?.close();
    radio.close();
    // Start every producer's shutdown before waiting for any one producer.
    const results = await Promise.allSettled([lan?.close(), server.stop()]);
    store.close();
    if (progressError) throw progressError;
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  })();

  return { server, session, pairingCode, urls, origin, close };
}
