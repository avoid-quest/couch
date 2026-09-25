import { createLanListener, lanPeer, loopbackPeer } from "./lan-listener";
import { frontendPaths } from "../shared/page-paths";
import { createStreamingCommunitySettings } from "./streamingcommunity-settings";
import { createStartup } from "./startup";
import type { HTMLBundle, ServerWebSocket } from "bun";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { createUpdateIdle } from "./update-idle";
import { createManualUpdate } from "./manual-update";
import type { UpdateRequest } from "../shared/updates";
import { createUpdates } from "./updates";
import type { UpdateFeed, UpdateRelease } from "./update-feed";
import { createToolHealth } from "./tool-health";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import type { Action, PlaybackActor, PlaybackCommand, QueueEntry, ServerMessage } from "../shared/protocol";
import type { ProviderId, ProviderPage, VideoQuality } from "../shared/providers";
import { createSession } from "./session";
import { createAppearance } from "./appearance";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import { createMediaFolders } from "./media-folders";
import { createFolderSettings } from "./folder-settings";
import { createLibrary } from "./library";
import { createRadio } from "./radio";
import { createRadioProgramme } from "./radio-programme";
import { createRadioSettings } from "./radio-settings";
import { createJellyfin } from "./jellyfin";
import { createJellyfinSettings } from "./jellyfin-settings";
import { createCatalog } from "./catalog";
import { inspectWebMedia, resolveWebMedia } from "./web-media";
import { createProviders } from "./providers";
import { loadProviderList } from "./providers";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";
import { createCollections } from "./collections";
import { createForLater } from "./for-later";
import { createPlaylists } from "./playlists";
import { ControllerError, createControllers, settingField } from "./controllers";
import type { ControllerIdentity } from "../shared/controllers";
import { createDiagnostics } from "./diagnostics";
import type { NativeDiagnostics } from "../shared/diagnostics";
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
  restart?: (confirmInterrupt: boolean) => Promise<unknown>;
  nativeBluetooth?: (action: BluetoothAction) => Promise<BluetoothState>;
  nativeDisplay?: (action: DisplayAction) => Promise<DisplayState>;
  nativeDiagnostics?: () => Promise<NativeDiagnostics | null>;
  nativeSound?: (action: NativeSoundAction) => Promise<unknown>;
  frontend?: HTMLBundle | Response;
  assets?: Record<string, Response>;
  development?: boolean;
  advertisedUrls?: string[];
  publishedLan?: boolean;
  updateFeed?: UpdateFeed<UpdateRelease>;
  updater?: { request: (request: UpdateRequest) => Promise<unknown> };
  admitted?: () => boolean;
  frontendReady?: (build: unknown) => boolean;
  idleNow?: () => number;
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
const providerListEntries = (page: ProviderPage, quality?: VideoQuality): QueueEntry[] => page.items.map(item => ({ id: crypto.randomUUID(), title: item.title, source: `web:${item.url}`, ...(quality ? { quality } : {}), ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), ...(item.duration === undefined ? {} : { duration: item.duration }) }));

export function createHub(options: HubOptions) {
  if (options.hostToken.length < 32) throw new Error("The private host token must contain at least 32 characters.");
  const advertised = options.managedLan ? [] : (options.advertisedUrls ?? []).map(value => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Advertised LAN addresses must be HTTP or HTTPS origins without credentials or paths.");
    return url.origin;
  });
  const store = openStore(options.databasePath, options.remoteControlEnabled ?? true);
  const pairingCode = options.pairingCode ?? String(randomInt(100000, 1000000));
  const hostname = options.managedLan ? "127.0.0.1" : options.hostname ?? "0.0.0.0";
  let lan: ReturnType<typeof createLanListener<Bun.Server<SocketData>>> | undefined;
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
  const idle = createUpdateIdle(options.idleNow);
  let closed = false;
  let restarting = false;
  const instanceId = crypto.randomUUID();
  const admitted = () => !closed && !restarting && (options.admitted?.() ?? true);
  const shutdown = new AbortController();
  const inspections = new Map<string, AbortController>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const jellyfin = createJellyfin(options.databasePath, { onWarning: message => { console.error(message); diagnostics.log.add("Jellyfin", message); }, onProgress: () => session.invalidate("jellyfin") });
  const streamingCommunitySettings = createStreamingCommunitySettings(store);
  const startup = createStartup(async () => {
    const value = (await options.nativeDiagnostics?.())?.facts.find(fact => fact.name === "Fullscreen now")?.value;
    return value === "true" ? true : value === "false" ? false : null;
  });
  let soundRouting: ReturnType<typeof createSoundRouting> | undefined;
  const macAudio = process.platform === "darwin" && options.nativeSound ? macSound(options.nativeSound) : null;
  const windowsAudio = process.platform === "win32" && options.nativeSound ? windowsSound(options.nativeSound) : null;
  const systemAudio = !!options.nativeDiagnostics && (process.platform === "linux" || !!macAudio || !!windowsAudio);
  let sound: ReturnType<typeof createSound> | undefined;
  let radioProgramme: ReturnType<typeof createRadioProgramme> | undefined;
  const session = createSession(store, options.sendPlayer, state => {
    idle.playback(state.player.status, !!state.radioRetry);
    radioProgramme?.observe(state);
    sound?.interrupt();
    if (state.player.error) diagnostics.log.add("Playback", state.player.error);
    if (!closed) {
      const message = JSON.stringify({ type: "state", state } satisfies ServerMessage);
      server.publish("session", message);
      lan?.server?.publish("session", message);
    }
  }, {
    admitted, systemAudio,
    ...(systemAudio ? { prepareAudio: () => soundRouting!.prepare() } : {}),
    resolveSource: (entry, playbackId, signal, fromStart, goLive, preparing) => {
      if (entry.source.startsWith("web:")) return resolveWebMedia(entry.source.slice(4), signal, entry.quality, store.streamingCommunityOrigin());
      if (entry.source.startsWith("jellyfin:")) return jellyfin.resolve(entry.source.slice(9), playbackId, signal, fromStart, preparing).then(media => preparing ? media : subtitles.prepare(media, playbackId, signal));
      if (entry.source.startsWith("library:")) return library.getPlayable(entry.source.slice(8));
      if (entry.source.startsWith("recording:")) throw new Error("Couch recordings are no longer supported. Open the saved media file through a folder source or Open file.");
      if (entry.source.startsWith("iptv:")) return goLive ? guide.getLivePlayable(entry.source.slice(5), signal) : guide.getPlayable(entry.source.slice(5), signal);
      if (entry.source.startsWith("radio:")) {
        const station = radio.getPlayable(entry.source.slice(6));
        radioProgramme?.load(playbackId, entry.source, station.source);
        return { ...station, radio: true };
      }
      // Older directory favorites were queued as direct URLs before radio had
      // its own playback policy. Recognize their saved station on the next play.
      if (radio.favorites().some(station => station.url === entry.source)) return { source: entry.source, radio: true };
      return { source: entry.source };
    },
    deactivate: () => { void jellyfin.deactivate(); },
    activatePrepared: (playbackId, previous) => jellyfin.activatePrepared(playbackId, previous),
    observe: player => { subtitles.observe(player); void jellyfin.observe(player); },
    stopped: playbackId => subtitles.stopped(playbackId),
  });
  const subtitles = createSubtitles(() => session.state.player, (playbackId, subtitle) => session.addSubtitle(playbackId, subtitle));
  const playlists = createPlaylists({ databasePath: options.databasePath, onChange: () => session.invalidate("playlist"), queue: () => session.state.queue,
    upNext: () => {
      const current = session.state.queue.findIndex(entry => entry.id === session.state.currentEntryId);
      const cursor = current >= 0 ? current : session.state.queue.findIndex(entry => entry.id === session.state.queueCursorEntryId);
      return session.state.queue.slice(cursor + 1);
    },
    loadQueue: (entries, mode, authorize, playedBy) => { session.loadQueue(entries, mode, authorize, playedBy); },
    resolveSource: async source => {
      const page = await loadProviderList(source.provider, source.url, shutdown.signal);
      return { name: page.title ?? "Playlist", entries: providerListEntries(page) };
    } });
  const folders = createMediaFolders();
  const library = createLibrary({ folders, ffprobePath: buildInfo.packaged ? process.env.COUCH_FFPROBE ?? null : undefined, databasePath: options.databasePath, onChange: () => { idle.activity(); session.invalidate("library"); } });
  const collections = createCollections({ databasePath: options.databasePath, library, onChange: () => session.invalidate("library"), queue: () => session.state.queue, loadQueue: (entries, mode, authorize, playedBy) => { session.loadQueue(entries, mode, authorize, playedBy); } });
  const radio = createRadio({ databasePath: options.databasePath, onChange: () => session.invalidate("radio") });
  radioProgramme = createRadioProgramme({ station: radio.programmeStation, metadata: radio.metadata, publish: (playbackId, programme) => session.updateRadioProgramme(playbackId, programme) });
  const folderSettings = createFolderSettings(library, folders);
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
  const providers = createProviders({ databasePath: options.databasePath, onChange: () => session.invalidate("provider"), streamingCommunityOrigin: () => store.streamingCommunityOrigin() });
  const forLater = createForLater({
    databasePath: options.databasePath, onChange: () => session.invalidate("forLater"),
    lookup: async reference => {
      if (reference.kind === "jellyfin") return jellyfin.entry(reference.id, crypto.randomUUID());
      if (reference.kind === "queue") {
        const entry = session.state.queue.find(item => item.id === reference.id);
        if (!entry) throw new ControllerError("This item is no longer in the queue.", 404);
        return entry;
      }
      if (reference.kind !== "library") throw new ControllerError("Choose a library or queue item to save.");
      const item = library.getItem(reference.id);
      if (!item) throw new ControllerError("This item is no longer in the library.", 404);
      return { id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration ? { duration: item.duration } : {}) };
    },
    prepare: async entry => {
      if (entry.source.startsWith("library:")) await library.getPlayable(entry.source.slice(8));
      if (entry.source.startsWith("jellyfin:")) {
        const current = await jellyfin.entry(entry.source.split(":")[2]!, entry.id);
        if (current.source !== entry.source) throw new ControllerError("This item belongs to another Jellyfin server or account. Save it again from the current library.", 409);
      }
      if (entry.source.startsWith("radio:")) radio.getPlayable(entry.source.slice(6));
    },
    reservePlay: () => session.reservePlay(),
    enqueue: (entry, intent, authorize, playedBy) => {
      session.command({ type: "enqueue", entry }, authorize, playedBy);
      if (intent !== undefined) session.playIfCurrent(intent, entry.id, false, authorize, playedBy);
    },
  });
  const controllers = createControllers({ store, pairingCode, recoveryCode: options.adminRecoveryCode, onChange: controller => {
    if (controller?.role === "controller") void options.nativeBluetooth?.({ op: "cancel", owner: controller.id }).catch(() => {});
    session.invalidate("controller");
  }, onRevoke: id => {
    void options.nativeBluetooth?.({ op: "cancel", owner: id }).catch(() => {});
    for (const socket of sockets) if (socket.data.controllerId === id) {
      socket.unsubscribe("session");
      socket.close(4001, "This remote's access was revoked. Pair again.");
    }
  } });
  const updateDirectory = join(dirname(options.databasePath), "updates");
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
  sound = createSound({ routing: soundRouting, delay: { get: () => session.state.preferences!.device.audioDelay, set: delay => session.saveAudioDelay(delay) }, available: systemAudio, idle: () => admitted() && session.state.player.status === "idle", begin: () => idle.begin("Waiting for the sound test to stop."), ...(macAudio ? { backend: macAudio.test, testAvailable: macAudio.canTest, platform: "mac" as const } : {}), ...(windowsAudio ? { backend: windowsAudio.test, testAvailable: false, platform: "windows" as const } : {}) });
  const toolHealth = createToolHealth({ packaged: !!(buildInfo.packaged && options.nativeDiagnostics && process.platform === "linux"), helpers: buildInfo.helpers });
  let manual: ReturnType<typeof createManualUpdate> | undefined;
  const updateWork = () => {
    return idle.workReason() ?? (library.scanning() ? "Waiting for the library scan to finish." : inspections.size ? "Waiting for source inspection to finish." : null);
  };
  const idleReason = () => idle.reason(updateWork());
  const idleAdmission = () => manual?.needsRefresh() ? "Check this Couch installation before automatic installation." : updates.state.policy === "idle" ? idleReason() : "Automatic installation is disabled.";
  const updates = createUpdates(updateDirectory, { version: buildInfo.version, revision: buildInfo.revision }, options.updateFeed, undefined, admitted, options.updater ? {
    busy: () => !!manual?.busy(), idle: idleAdmission,
    status: requestId => manual!.status(requestId), install: (candidateId, requestId, guard) => manual!.automatic(candidateId, requestId, guard),
  } : undefined);
  manual = options.updater ? createManualUpdate(options.updater, admitted, updates.candidateReady, updates.canRepair) : undefined;
  const appearance = createAppearance(store, value => session.updateAppearance(value));
  const catalog = createCatalog({ library, radio, jellyfin, viewing: { store, session } });
  const jellyfinSettings = createJellyfinSettings({ jellyfin, invalidate: () => {
    const state = session.state;
    if (state.queue.find(entry => entry.id === state.currentEntryId)?.source.startsWith("jellyfin:")) session.command({ type: "stop" });
    session.invalidate("jellyfin");
  } });
  const diagnostics = createDiagnostics({
    databasePath: options.databasePath,
    runtime: () => ({ hostname, port: server.port!, native: !!options.nativeDiagnostics }),
    native: options.nativeDiagnostics ?? (() => Promise.resolve(null)),
    secrets: [options.hostToken, pairingCode, options.adminRecoveryCode ?? ""],
    sources: () => [
      ...library.listSources(),
      ...guide.sources().map(source => ({ name: source.name, status: source.error ? "Error" : source.updatedAt ? "Loaded" : "Not loaded", error: source.error })),
      ...radio.playlists().map(source => ({ name: source.name, status: source.error ? "Error" : source.updatedAt ? "Loaded" : "Not loaded", error: source.error })),
      { name: "Jellyfin", status: jellyfin.status().connected ? "Configured" : "Not connected" },
    ],
  });
  let pairWindow = Date.now();
  let pairAttempts = 0;

  const peer = (request: Request): string => server.requestIP(request)?.address ?? lan?.server?.requestIP(request)?.address ?? "";
  const allowed = (request: Request, requireOrigin: boolean): boolean => {
    if (options.managedLan && !loopbackPeer(peer(request)) && (!store.remoteControlEnabled() || !lan?.network || !lanPeer(lan.network, peer(request)))) return false;
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
    type Intake = { entry: QueueEntry; fromStart?: boolean; inspectUrl?: string } | { entries: QueueEntry[] };
    const authorized = () => { if (closed) return false; authorize(); return true; };
    const web = (item: Omit<Extract<Action, { type: "enqueueWeb" }>, "type">): Intake => {
      const title = item.title?.trim();
      return { entry: { id: item.entryId, source: `web:${item.url}`, title: title || new URL(item.url).hostname, automaticTitle: !title, ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}), ...(item.quality ? { quality: item.quality } : {}) }, fromStart: item.fromStart, ...(!title ? { inspectUrl: item.url } : {}) };
    };
    const list = async (provider: ProviderId, url: string, quality?: VideoQuality): Promise<Intake> => {
      const page = await loadProviderList(provider, url, shutdown.signal);
      return { entries: providerListEntries(page, quality) };
    };
    let prepare: () => Intake | null | Promise<Intake | null>;
    switch (action.type) {
      case "enqueueWeb": prepare = () => web(action); break;
      case "enqueueProvider":
        prepare = action.shape === "atom" ? () => web({ ...action, entryId: crypto.randomUUID() }) : () => list(action.provider, action.url, action.quality);
        break;
      case "enqueueLibrary":
        prepare = async () => {
          const media = await library.getPlayable(action.itemId);
          // The local metadata read also needs the guard after asynchronous I/O.
          if (!authorized()) return null;
          const item = library.getItem(action.itemId);
          return { entry: { id: action.entryId, title: media.title.slice(0, 300), source: `library:${action.itemId}`, ...(item?.artworkId ? { artworkId: item.artworkId } : {}), ...(item?.duration ? { duration: item.duration } : {}) }, fromStart: action.fromStart };
        };
        break;
      case "enqueueAlbum":
        prepare = () => {
          const { items } = library.albumTracks(action.albumId);
          if (items.some(item => !item.available)) throw new Error("Some album tracks are unavailable. Reconnect their drive and scan again.");
          return { entries: items.map(item => ({ id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...(item.artworkId ? { artworkId: item.artworkId } : {}), ...(item.duration ? { duration: item.duration } : {}) })) };
        };
        break;
      case "enqueueRadio":
        prepare = () => {
          const station = radio.getPlayable(action.stationId);
          return { entry: { id: action.entryId, title: station.title, source: `radio:${action.stationId}`, kind: "radio", live: true, ...station.metadata } };
        };
        break;
      case "enqueueJellyfin": prepare = async () => ({ entry: await jellyfin.entry(action.itemId, action.entryId), fromStart: action.fromStart }); break;
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
      let entries: QueueEntry[], fromStart: boolean | undefined, selectedEntryIds: string[] = [];
      if ("entry" in prepared) {
        const { entry, inspectUrl } = prepared;
        session.command({ type: "enqueue", entry, ...(action.placement ? { placement: action.placement } : {}) }, authorize, playedBy);
        entries = [entry];
        fromStart = prepared.fromStart;
        if (inspectUrl) {
          const controller = new AbortController();
          inspections.set(entry.id, controller);
          void inspectWebMedia(inspectUrl, controller.signal, store.streamingCommunityOrigin()).then(metadata => {
            if (!closed && !controller.signal.aborted) { authorize(); session.enrichEntry(entry.id, entry.source, metadata); }
          }).catch(() => {}).finally(() => {
            if (inspections.get(entry.id) === controller) { inspections.delete(entry.id); idle.activity(); }
          });
        }
      } else {
        entries = session.loadQueue(prepared.entries, "append", authorize, playedBy, action.placement);
        fromStart = true;
        selectedEntryIds = entries.map(entry => entry.id);
      }
      if (intent !== undefined && entries[0]) session.playIfCurrent(intent, entries[0].id, fromStart, authorize, playedBy, selectedEntryIds);
    })();
  };

  const serveOptions: Bun.Serve.Options<SocketData> = {
    hostname,
    port: options.port ?? 3800,
    development: options.development ? { hmr: true, console: true } : false,
    maxRequestBodySize: subtitleSizeLimit,
    routes: {
      ...options.assets,
      ...Object.fromEntries(frontendPaths.map(path => [path, options.frontend ?? new Response("Couch media server")])),
      "/api/health": request => allowed(request, false) ? json({ ok: true, player: session.state.player.status }) : json({ error: "Unrecognized host or origin." }, 403),
      "/api/connection": request => allowed(request, false) ? cors(request, json({ name: store.installationName(), installationId: store.installationId(), urls: connectionUrls, player: session.state.player.status, remoteControlEnabled: store.remoteControlEnabled(), ...(options.managedLan ? { lanError } : {}), desktopRemoteUi: 1, desktopClientProtocol, tvPresentation: process.env.COUCH_TV_PRESENTATION === "1" })) : json({ error: "Unrecognized host or origin." }, 403),
      "/api/pair": {
        POST: async request => {
          if (!allowed(request, true)) return json({ error: "Unrecognized host or origin." }, 403);
          const respond = (body: unknown, status = 200) => cors(request, json(body, status));
          if (!store.remoteControlEnabled()) return respond({ error: "Remote control is off. Enable Allow remote control on the playback computer." }, 503);
          if (!admitted()) return respond({ error: "The TV is preparing an update. Pairing is paused." }, 503);
          if (Date.now() - pairWindow >= 60_000) { pairWindow = Date.now(); pairAttempts = 0; }
          if (++pairAttempts > 20) return respond({ error: "Too many pairing attempts. Try again in a minute." }, 429);
          if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return respond({ error: "Send a JSON pairing request." }, 415);
          let body: unknown;
          try { body = await request.json(); } catch { return respond({ error: "Invalid pairing request." }, 400); }
          if (!store.remoteControlEnabled()) return respond({ error: "Remote control is off. Enable Allow remote control on the playback computer." }, 503);
          if (!admitted()) return respond({ error: "The TV is preparing an update. Pairing is paused." }, 503);
          if (typeof body !== "object" || body === null || !("code" in body) || body.code !== pairingCode) return respond({ error: "The pairing code is incorrect." }, 401);
          try {
            idle.activity();
            const token = store.pair("name" in body ? body.name : undefined);
            session.invalidate("controller");
            return respond({ token, controller: store.controllerForToken(token), installationId: store.installationId() });
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
      const trusted = token === options.hostToken && (!options.managedLan || loopbackPeer(peer(request)));
      if (!trusted && !store.remoteControlEnabled()) return cors(request, json({ error: "Remote control is off. Enable Allow remote control on the playback computer." }, 503));
      const identity = (): ControllerIdentity | null => {
        if (closed) return null;
        if (trusted) return { controller: null, authority: "host", claimAvailable: controllers.claimAvailable() };
        if (!store.remoteControlEnabled()) return null;
        const controller = store.controllerForToken(token);
        return controller ? { controller, authority: controller.role, claimAvailable: controllers.claimAvailable() } : null;
      };
      const caller = identity();
      if (!caller) return cors(request, json({ error: "Pair this device before connecting." }, 401));
      if (url.pathname === "/api/settings/sharing") {
        if (request.method === "GET") return cors(request, json({ enabled: store.remoteControlEnabled() }));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        if (!trusted) return cors(request, json({ error: "Change remote control on the playback computer." }, 403));
        try {
          if (!admitted()) throw new ControllerError("The TV is preparing an update. Controls are paused.", 503);
          const enabled = await settingField(request, "enabled");
          if (typeof enabled !== "boolean") throw new ControllerError("Choose whether to allow remote control.");
          if (!admitted()) throw new ControllerError("The TV is preparing an update. Controls are paused.", 503);
          await lan?.setEnabled(enabled);
          store.saveRemoteControlEnabled(enabled);
          if (!enabled) for (const socket of sockets) if (!socket.data.trusted) {
            socket.unsubscribe("session");
            socket.close(4003, "Remote control is off. Your pairing is remembered.");
          }
          session.invalidate("controller");
          return cors(request, json({ enabled }));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Could not save remote control settings." }, error instanceof ControllerError ? error.status : 500)); }
      }
      if (url.pathname === "/api/settings/origin-domain") {
        if (!options.managedLan || caller.authority === "controller") return cors(request, json({ error: "An administrator is required." }, 403));
        if (request.method === "GET") return cors(request, json({ domain: store.originDomain() }));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        try {
          if (!admitted()) throw new ControllerError("The TV is preparing an update. Controls are paused.", 503);
          const value = await settingField(request, "domain");
          if (typeof value !== "string") throw new ControllerError("Enter a network address.");
          const domain = value.trim();
          const alias = domain ? originDomainUrl(domain, server.port!) : "";
          if (alias) try { await lan?.validateAlias(alias); }
          catch (error) { throw new ControllerError(error instanceof Error ? error.message : "The network address is unavailable."); }
          if (!admitted()) throw new ControllerError("The TV is preparing an update. Controls are paused.", 503);
          if (identity()?.authority === "controller" || !identity()) throw new ControllerError("Administrator access changed.", 403);
          store.saveOriginDomain(alias);
          await lan?.refresh().catch(() => {});
          return cors(request, json({ domain: alias }));
        } catch (error) { return cors(request, json({ error: error instanceof ControllerError ? error.message : "Could not save the LAN origin domain." }, error instanceof ControllerError ? error.status : 500)); }
      }
      if (url.pathname === "/api/build" && request.method === "GET") return cors(request, json(buildInfo));
      if (url.pathname === "/api/maintenance/frontend" && request.method === "POST" && options.frontendReady) {
        if (!trusted) return cors(request, json({ error: "The native frontend is required." }, 403));
        try {
          const build = await settingField(request, "build");
          if (closed || !options.frontendReady(build)) return cors(request, json({ error: "The frontend build does not match this server." }, 409));
          return cors(request, json({ ok: true }));
        } catch { return cors(request, json({ error: "Invalid frontend build acknowledgment." }, 400)); }
      }
      if (request.method !== "GET" && request.method !== "HEAD") idle.activity();
      if (url.pathname === "/api/controllers/me" && request.method === "GET") return cors(request, await controllers.handle(request, identity));
      if (manual && url.pathname === "/api/updates" && request.method === "GET") {
        try { return cors(request, json({ ...updates.state, installation: await manual.read(identity, url.searchParams.get("requestId") ?? undefined) })); }
        catch (error) { return cors(request, json({ error: error instanceof ControllerError ? error.message : "The update worker is unavailable." }, error instanceof ControllerError ? error.status : 503)); }
      }
      if (url.pathname === "/api/settings/restart" && request.method === "GET") return cors(request, caller.authority !== "controller" ? json({ instanceId, available: !!options.restart, ready: admitted() }) : json({ error: "An administrator is required." }, 403));
      if (url.pathname === "/api/settings/restart" && request.method === "POST") {
        if (caller.authority === "controller") return cors(request, json({ error: "An administrator is required." }, 403));
        try {
          const confirmed = await settingField(request, "confirmInterrupt");
          if (confirmed !== true) return cors(request, json({ error: "Confirm interruption before restarting Couch." }, 400));
          if (!["host", "administrator"].includes(identity()?.authority ?? "")) return cors(request, json({ error: "Administrator access changed." }, 403));
          if (!options.restart) return cors(request, json({ error: "Restart requires the installed systemd application." }, 409));
          await options.restart(true);
          return cors(request, json({ ok: true, instanceId }, 202));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Restart failed." }, 409)); }
      }
      if (manual && url.pathname === "/api/updates/install" && request.method === "POST") return cors(request, await manual.install(request, identity));
      if (manual && url.pathname === "/api/updates/repair" && request.method === "POST") return cors(request, await manual.repair(request, identity));
      if (!admitted()) return cors(request, json({ error: "The TV is preparing an update. Controls are paused." }, 503));
      if (url.pathname === "/api/activity" && request.method === "POST") {
        try {
          if (await settingField(request, "activity") !== true || !admitted() || !identity()) return cors(request, json({ error: "Controls are paused." }, 503));
          idle.activity(); return cors(request, new Response(null, { status: 204 }));
        } catch { return cors(request, json({ error: "Send a controller activity signal." }, 400)); }
      }
      const finishWork = !websocket && !["GET", "HEAD"].includes(request.method) ? idle.begin("Waiting for a settings, scan or import request to finish.") : undefined;
      try {
        const playedBy = caller.controller ? { deviceId: caller.controller.id, name: caller.controller.name } : playbackActor(null);
        const currentIdentity = () => admitted() ? identity() : null;
        const authorize = () => {
          if (!admitted()) throw new ControllerError("The TV is preparing an update. Controls are paused.", 503);
          if (!identity()) throw new ControllerError("This remote's access was revoked. Pair again.", 401);
        };
        if (websocket && buildInfo.packaged && (url.searchParams.has("clientProtocol") && tauriOrigins.has(request.headers.get("origin") ?? "")
          ? url.searchParams.get("clientProtocol") !== String(desktopClientProtocol)
          : buildKey(buildInfo) !== url.searchParams.get("build"))) return cors(request, json({ error: "Update this desktop client or playback computer to a compatible protocol, or refresh the browser page." }, 409));
        if (caller.controller) store.touchController(caller.controller.id);
        if (!websocket && url.pathname === "/api/settings/streamingcommunity") return cors(request, await streamingCommunitySettings.handle(request, currentIdentity));
        if (!websocket && url.pathname === "/api/settings/startup") return cors(request, await startup.handle(request, currentIdentity));
        if (!websocket && /^\/api\/updates(?:\/|$)/.test(url.pathname)) return cors(request, await updates.handle(request, currentIdentity));
        if (!websocket && /^\/api\/tools(?:\/|$)/.test(url.pathname)) return cors(request, await toolHealth.handle(request, currentIdentity));
        if (!websocket && /^\/api\/bluetooth(?:\/|$)/.test(url.pathname)) return cors(request, await bluetoothSettings(request, currentIdentity, options.nativeBluetooth));
        if (!websocket && /^\/api\/sound(?:\/|$)/.test(url.pathname)) return cors(request, await sound!.handle(request, currentIdentity));
        if (!websocket && /^\/api\/display(?:\/|$)/.test(url.pathname)) return cors(request, await displaySettings(request, currentIdentity, options.nativeDisplay));
        if (!websocket && /^\/api\/diagnostics(?:\/|$)/.test(url.pathname)) return cors(request, await diagnostics.handle(request, currentIdentity));
        if (!websocket && /^\/api\/metadata(?:\/|$)/.test(url.pathname)) return cors(request, await library.metadata.handle(request, currentIdentity));
        if (!websocket && /^\/api\/appearance(?:\/|$)/.test(url.pathname)) return cors(request, await appearance.handle(request, currentIdentity));
        if (!websocket && /^\/api\/iptv(?:\/|$)/.test(url.pathname)) return cors(request, await guide.handle(request, currentIdentity, playedBy));
        if (!websocket && (/^\/api\/controllers(?:\/|$)/.test(url.pathname) || (url.pathname === "/api/settings" || url.pathname === "/api/settings/setup"))) return cors(request, await controllers.handle(request, currentIdentity));
        if (!websocket && /^\/api\/jellyfin(?:\/(?:connection|test))?$/.test(url.pathname)) return cors(request, await jellyfinSettings.handle(request, currentIdentity));
        if (!websocket && (/^\/api\/library\/folders(?:\/browse)?$/.test(url.pathname) || /^\/api\/library\/sources\/[\w-]{1,80}(?:\/(?:scan|test|verify))?$/.test(url.pathname) || url.pathname === "/api/library/sources" && request.method !== "GET")) return cors(request, await folderSettings.handle(request, currentIdentity));
        if (!websocket && /^\/api\/radio\/(?:avoid(?:\/programmes)?|sources|playlists(?:\/[\w-]{1,80}(?:\/refresh)?)?)$/.test(url.pathname)) return cors(request, await radioSettings.handle(request, currentIdentity));
        if (!websocket && /^\/api\/for-later(?:\/|$)/.test(url.pathname)) return cors(request, await forLater.handle(request, authorize, playedBy));
        if (!websocket) return cors(request, await (/^\/api\/collections(?:\/|$)/.test(url.pathname) ? collections.handle(request, authorize, playedBy) : url.pathname === "/api/subtitles" ? subtitles.handle(request, authorize) : /^\/api\/playlists(?:\/|$)/.test(url.pathname) ? playlists.handle(request, authorize, playedBy) : url.pathname.startsWith("/api/providers/") ? providers.handle(request, authorize) : catalog.handle(request, trusted, authorize, playedBy)));
        return server.upgrade(request, { data: { trusted, controllerId: caller.controller?.id ?? null, authorize, window: Date.now(), count: 0 } }) ? undefined : json({ error: "WebSocket upgrade required." }, 400);
      } finally { finishWork?.(); }
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
      close(socket) { sockets.delete(socket); if (socket.data.controllerId) void options.nativeBluetooth?.({ op: "cancel", owner: socket.data.controllerId }).catch(() => {}); },
      async message(socket, message) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        idle.activity();
        if (socket.data.controllerId) store.touchController(socket.data.controllerId);
        if (Date.now() - socket.data.window >= 1000) { socket.data.window = Date.now(); socket.data.count = 0; }
        if (++socket.data.count > 60) { socket.close(1008, "Too many commands."); return; }
        if (typeof message !== "string") { socket.close(1003, "JSON text messages required."); return; }
        let command;
        try { command = parseCommand(message, socket.data.trusted); } catch {
          socket.close(1008, "Invalid command or unsupported media source.");
          return;
        }
        const finishWork = idle.begin("Waiting for a controller command to finish.");
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
            if (server.subscriberCount("navigation") === 0) throw new Error("The TV interface is disconnected. Try again when it reconnects.");
            server.publish("navigation", JSON.stringify({ type: "navigation", key: action.key } satisfies ServerMessage));
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
            const added = ["enqueue", "enqueueLibrary", "enqueueJellyfin", "enqueueProvider", "enqueueRadio", "enqueueWeb", "enqueueAlbum"].includes(action.type);
            const label = action.type === "pause" ? action.paused ? "paused" : "resumed"
              : action.type === "stop" ? "stopped playback"
              : action.type === "remove" ? `removed ${before.queue.find(entry => entry.id === action.entryId)?.title || "an item"}`
              : added ? `added ${action.type === "enqueue" ? action.entry.title : action.type === "enqueueProvider" || action.type === "enqueueWeb" ? action.title || "media" : "entryId" in action ? session.state.queue.find(entry => entry.id === action.entryId)?.title || "media" : "media"}`
              : action.type === "play" ? `started ${session.state.queue.find(entry => entry.id === action.entryId)?.title || "media"}` : null;
            if (label) session.notice(playedBy, `${playedBy.name} ${label}`);
          }
        } catch (error) {
          result = { ...result, ok: false, error: error instanceof Error ? error.message : "The command failed." };
          diagnostics.log.add("Controller command", result.error);
        } finally { finishWork(); }
        socket.send(JSON.stringify(result));
      },
    },
  };
  const server: Bun.Server<SocketData> = Bun.serve(serveOptions);

  const port = server.port!;
  const origin = urlFor(hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname, port);
  const allowedHosts = new Set(options.managedLan ? [new URL(origin).host] : [...addresses].map(address => new URL(urlFor(address, port)).host).concat(advertised.map(url => new URL(url).host)));
  const allowedOrigins = new Set(options.managedLan ? [origin] : [...addresses].map(address => new URL(urlFor(address, port)).origin).concat(advertised));
  const urls: string[] = advertised.length ? [...new Set(advertised)] : hostname === "0.0.0.0" || hostname === "::"
    ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port))
    : [origin];
  if (urls.length === 0) urls.push(origin);
  const connectionUrls: string[] = options.publishedLan ? [...urls] : [...new Set([...urls, ...(hostname === "0.0.0.0" || hostname === "::" ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port)) : [origin])])];

  if (options.managedLan) {
    lan = createLanListener({
      port, enabled: store.remoteControlEnabled(), selected: process.env.COUCH_LAN_INTERFACE, address: process.env.COUCH_LAN_ADDRESS,
      advertised: () => [...(store.originDomain() ? [originDomainUrl(store.originDomain(), port, !store.originDomain().startsWith("http://"))] : []), ...options.advertisedUrls ?? []],
      start: (network, port) => Bun.serve({ ...serveOptions, hostname: network.address, port }),
      changed: (next, error) => {
        lanError = error;
        urls.splice(0, urls.length, ...next);
        connectionUrls.splice(0, connectionUrls.length, ...next);
        allowedHosts.clear(); allowedOrigins.clear();
        for (const url of [origin, ...next]) { allowedHosts.add(new URL(url).host); allowedOrigins.add(new URL(url).origin); }
        options.onAddresses?.(next);
      },
    });
  }

  let closing: Promise<void> | undefined;
  let requiredCheckpoint = false;
  const close = (requiredProgress = false) => closing ??= (async () => {
    requiredCheckpoint = requiredProgress;
    closed = true;
    shutdown.abort();
    for (const controller of inspections.values()) controller.abort();
    let progressError: unknown;
    try { if (requiredProgress) session.quiesce(); else session.close(); }
    catch (error) { progressError = error; }
    const toolsStopped = toolHealth.close();
    sound?.close();
    soundRouting?.close();
    appearance.close();
    guide.close();
    providers.close();
    subtitles.close();
    playlists.close();
    forLater.close();
    collections.close();
    radioProgramme?.close();
    radio.close();
    // Start every producer's shutdown before waiting for any one producer.
    const results = await Promise.allSettled([toolsStopped, updates.close(), library.close(), jellyfin.close(), lan?.close(), server.stop(true)]);
    diagnostics.close();
    store.close();
    if (progressError) throw progressError;
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  })();

  return {
    server, session, pairingCode, urls, origin, idleReason, idleAdmission, updateWork,
    close: () => close(),
    prepareRestart: () => {
      if (!admitted()) throw new Error("The TV is already preparing an update or restart.");
      // The strict write happens before any irreversible shutdown. On failure the
      // authenticated listener and playback remain usable and the dirty save is retained.
      session.checkpoint();
      session.quiesce();
      restarting = true;
      return { progressSaved: true, admissionClosed: true };
    },
    quiesce: async () => {
      if (closing && !requiredCheckpoint) throw new Error("The TV was stopped without an update checkpoint.");
      await close(true);
      return { progressSaved: true, admissionClosed: true };
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
