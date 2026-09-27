import { libraryMetadata } from "./library-metadata";
import { ADMIN_ONLY, NO_LONGER_ADMIN, RECORDINGS_UNSUPPORTED, REMOTES_OFF, STORAGE_ERROR, UPDATING_PAUSED, VERSION_MISMATCH } from "./messages";
import { createLanListener, lanNetworks, lanPeer, loopbackPeer } from "./lan-listener";
import { frontendPaths } from "../shared/page-paths";
import { createStreamingCommunitySettings } from "./streamingcommunity-settings";
import { createStartup } from "./startup";
import type { HTMLBundle, ServerWebSocket } from "bun";
import { mkdirSync } from "node:fs";
import { createHash, randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { createUpdateIdle } from "./update-idle";
import { createManualUpdate } from "./manual-update";
import type { UpdateRequest } from "../shared/updates";
import { createUpdates } from "./updates";
import type { UpdateFeed, UpdateRelease } from "./update-feed";
import { createToolHealth } from "./tool-health";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import type { Action, Domain, PlaybackActor, PlaybackCommand, QueueEntry, ServerMessage } from "../shared/protocol";
import type { ProviderId, ProviderPage, VideoQuality } from "../shared/providers";
import { browserCompatible, createPlaybackTargetRegistry } from "./playback-targets";
import { parseRendererMessage } from "./renderer-validation";
import { createSession } from "./session";
import { createAppearance } from "./appearance";
import { createSessionStore } from "./session-store";
import { openPlaybackCatalog, type PlaybackRecord } from "./playback-catalog";
import { createPlaybackDevices } from "./playback-devices";
import { openStore } from "./store";
import { parseCommand } from "./validation";
import { createMediaFolders } from "./media-folders";
import { createFolderSettings } from "./folder-settings";
import { createLibrary } from "./library";
import { createContinuationResolver } from "./continuation";
import { createRadio } from "./radio";
import { createRadioProgramme } from "./radio-programme";
import { createRadioSettings } from "./radio-settings";
import { createJellyfin } from "./jellyfin";
import { createJellyfinSettings } from "./jellyfin-settings";
import { createCatalog } from "./catalog";
import { createProviderMetadata, providerMetadata } from "./provider-metadata";
import { playbackMediaId } from "./progress";
import { inspectWebMedia, resolveWebMedia } from "./web-media";
import { createProviders } from "./providers";
import { loadProviderList } from "./providers";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";
import { createCollections } from "./collections";
import { createForLater, type ForLaterPlaybackContext } from "./for-later";
import { createPlaylists, type PlaylistPlaybackContext } from "./playlists";
import { ControllerError, createControllers, settingField, settingFields } from "./controllers";
import type { ControllerIdentity } from "../shared/controllers";
import { createDiagnostics } from "./diagnostics";
import type { NativeDiagnostics } from "../shared/diagnostics";
import { buildInfo } from "./build-info";
import { buildKey } from "../shared/build";
import { desktopClientProtocol } from "../shared/desktop-protocol";
import { createGuide, type GuidePlaybackContext } from "./iptv";
import { createHttpsProxy } from "./https-proxy";

import { createSoundRouting } from "./sound-routing";
import { bluetoothSettings } from "./bluetooth";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import { createSound } from "./sound";
import { macSound } from "./sound-mac";
import { windowsSound } from "./sound-windows";
import type { NativeSoundAction } from "./sound-native";
import { displaySettings } from "./display-settings";
import { createSendspin, validateSendspinConfig, type SendspinConfig } from "./sendspin";
import { openSendspinIdentity } from "./sendspin-identity";
import type { SendspinHostingState } from "../shared/sendspin";
import type { DisplayAction, DisplayState } from "../shared/display";

type HubOptions = {
  observePlayer?: () => void;
  hostname?: string;
  managedLan?: boolean;
  httpsProxy?: { origin: string; trustedProxyIps: string[] };
  sendspin?: SendspinConfig;
  sendspinConfigError?: string;
  onAddresses?: (urls: string[]) => void;
  port?: number;
  databasePath: string;
  initialName?: string;
  hostToken: string;
  pairingCode?: string;
  remoteControlEnabled?: boolean;
  adminRecoveryCode?: string;
  sendPlayer?: (command: PlaybackCommand) => void;
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
type Runtime = { id: string; mode: "household" | "personal"; owner: string | null; disposed: boolean; sourceGeneration: number; store: ReturnType<typeof createSessionStore>; privateStore?: ReturnType<typeof openStore>; session: ReturnType<typeof createSession>; targets: ReturnType<ReturnType<typeof createPlaybackTargetRegistry>["bind"]>; subtitles: ReturnType<typeof createSubtitles>; radioProgramme: ReturnType<typeof createRadioProgramme>; playback: ReturnType<ReturnType<typeof createJellyfin>["createPlayback"]>; catalog: ReturnType<typeof createCatalog> };
type SocketData = { runtime: Runtime; audioReady?: boolean; rendererSessionId?: string; renderer?: ReturnType<ReturnType<typeof createPlaybackTargetRegistry>["register"]>; receiver?: ReturnType<ReturnType<typeof createPlaybackTargetRegistry>["registerReceiver"]>; playbackClock: boolean; trusted: boolean; controllerId: string | null; authorize: () => void; window: number; count: number };
const providerListEntries = (page: ProviderPage, quality?: VideoQuality): QueueEntry[] => page.items.map(item => ({ id: crypto.randomUUID(), title: item.title, source: `web:${item.url}`, ...providerMetadata(item), ...(item.collection ? { collection: item.collection } : {}), ...(quality ? { quality } : {}), ...(item.duration === undefined ? {} : { duration: item.duration }) }));

export function createHub(options: HubOptions) {
  if (options.hostToken.length < 32) throw new Error("The private host token must contain at least 32 characters.");
  const httpsProxy = createHttpsProxy(options.httpsProxy);
  const advertised = options.managedLan ? [] : (options.advertisedUrls ?? []).map(value => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Advertised LAN addresses must be HTTP or HTTPS origins without credentials or paths.");
    return url.origin;
  });
  const store = openStore(options.databasePath, options.remoteControlEnabled ?? true, options.initialName);
  const configuredExternally = !!(options.sendspin || options.sendspinConfigError);
  const sendspinConfig: SendspinConfig = options.sendspin ?? { host: "0.0.0.0", port: 0, name: store.installationName() };
  let sendspinError: string | null = null;
  const sendspinIdentity = openSendspinIdentity(options.databasePath);
  const sessionId = store.installationId();
  const playbackCatalog = openPlaybackCatalog(options.databasePath, sessionId, options.sendPlayer ? "native" : undefined);
  const runtimes = new Map<string, Runtime>();
  const playbackStates = new Map<string, { status: import("../shared/protocol").PlayerState["status"]; retry: boolean }>();
  const retiring = new Set<Promise<void>>();
  const invalidateAll = (...domains: Domain[]) => { for (const runtime of runtimes.values()) if (!runtime.disposed) runtime.session.invalidate(...domains); };
  const topic = (runtime: Runtime, clock: boolean) => `${clock ? "session-clock" : "session"}:${runtime.id}`;
  const snapshot = (runtime: Runtime) => ({ ...runtime.session.state, sessionMode: runtime.mode, ...devices.snapshot(runtime) });
  let publishQueued = false;
  const publishPlaybacks = () => {
    if (publishQueued || closed) return;
    publishQueued = true;
    queueMicrotask(() => {
      publishQueued = false;
      if (closed) return;
      for (const runtime of runtimes.values()) {
        const message = JSON.stringify({ type: "state", state: snapshot(runtime) } satisfies ServerMessage);
        for (const listener of [server, ...lan?.servers ?? []]) {
          listener.publish(topic(runtime, false), message);
          listener.publish(topic(runtime, true), message);
        }
      }
    });
  };
  const pairingCode = options.pairingCode ?? String(randomInt(100000, 1000000));
  const hostname = options.managedLan ? "127.0.0.1" : options.hostname ?? "0.0.0.0";
  let lan: ReturnType<typeof createLanListener<Bun.Server<SocketData>>> | undefined;
  let lanError: string | null = null;
  const addresses = new Set(["localhost", "127.0.0.1", "::1"]);
  const lanAddresses = new Set(lanNetworks(networkInterfaces()).map(network => network.address));
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.address.includes("%")) continue;
      addresses.add(entry.address);
    }
  }
  const urlFor = (address: string, port: number) => `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
  const idle = createUpdateIdle(options.idleNow);
  const updatePlaybackActivity = () => {
    const activity = [...playbackStates.values()];
    const active = activity.find(value => ["loading", "playing", "paused"].includes(value.status) || value.retry);
    idle.playback(active?.status ?? playbackStates.get(sessionId)?.status ?? "unavailable", activity.some(value => value.retry));
  };
  let closed = false;
  let restarting = false;
  const instanceId = crypto.randomUUID();
  const admitted = () => !closed && !restarting && (options.admitted?.() ?? true);
  const shutdown = new AbortController();
  const inspections = new Map<string, AbortController>();
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const pendingAudioOutputs = new Map<string, { socket: ServerWebSocket<SocketData>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const jellyfin = createJellyfin(options.databasePath, { onWarning: message => { console.error(message); diagnostics.log.add("Jellyfin", message); }, onProgress: () => invalidateAll("jellyfin") });
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
  const registry = createPlaybackTargetRegistry(options.sendPlayer, { observeNative: options.observePlayer, recoveringReceiver: store.nativeReceiverUsed(), recoveringGroup: store.bufferedOutputUsed() });
  registry.rename("native", store.installationName());
  function createRuntime(record: PlaybackRecord): Runtime {
    const { id, owner, storageKey } = record;
    const mode = storageKey ? "personal" : "household";
    const existing = runtimes.get(id);
    if (existing) return existing;
    let privateStore: ReturnType<typeof openStore> | undefined;
    if (storageKey) {
      if (options.databasePath === ":memory:") privateStore = openStore(":memory:");
      else {
        const directory = join(dirname(options.databasePath), "sessions");
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        privateStore = openStore(join(directory, `${createHash("sha256").update(`${sessionId}:${storageKey}`).digest("hex")}.sqlite`));
      }
    }
    const viewingStore = createSessionStore(store, privateStore ?? store);
    const playback = jellyfin.createPlayback();
    const targets = registry.bind(id, () => session, { defaultNative: record.deviceIds.length === 1 && record.deviceIds[0] === "native", kind: mode });
    let radioProgramme: ReturnType<typeof createRadioProgramme> | undefined;
    const runtime = { id, mode, owner, disposed: false, sourceGeneration: 0, store: viewingStore, privateStore } as Runtime;
    const session = createSession(viewingStore, targets.send, (state, clock) => {
      playbackStates.set(id, { status: state.player.status, retry: !!state.radioRetry });
      updatePlaybackActivity();
      radioProgramme?.observe(state);
      sound?.interrupt();
      if (state.player.error) diagnostics.log.add("Playback", mode === "household" ? state.player.error : "Personal playback reported an error.");
      if (!clock && !closed) {
        const message = JSON.stringify({ type: "state", state: snapshot(runtime) } satisfies ServerMessage);
        for (const listener of [server, ...lan?.servers ?? []]) {
          listener.publish(topic(runtime, false), message);
          listener.publish(topic(runtime, true), message);
        }
        publishPlaybacks();
      } else if (clock && !closed) {
        for (const listener of [server, ...lan?.servers ?? []]) {
          listener.publish(topic(runtime, true), JSON.stringify({ type: "clock", ...clock } satisfies ServerMessage));
          if (listener.subscriberCount(topic(runtime, false))) listener.publish(topic(runtime, false), JSON.stringify({ type: "state", state: snapshot(runtime) } satisfies ServerMessage));
        }
      }
    }, {
      sessionId: id, admitted: () => admitted() && !runtime.disposed, systemAudio, transferBusy: () => targets.busy, nativeTarget: () => targets.nativeAssigned, nativeRenderer: () => targets.nativeRenderer,
      preflightLoad: () => targets.destination?.backend === "sendspin",
      validateCommand: command => {
        if (targets.nativeRenderer) return;
        if (command.type === "load" && targets.destination?.backend === "browser") browserCompatible(command);
        if (command.type === "load" && targets.destination?.backend === "sendspin") devices.validateLoad(runtime, command);
        if (!["load", "stop", "prepare", "pause", "seek", "volume", "speed", "track"].includes(command.type) && !(devices.hasVideoScreen(runtime) && ["subtitleDelay", "addSubtitle"].includes(command.type))) throw new Error("This playback setting is not supported by the selected output.");
      },
      resolveContinuation: (entry, signal) => continuation(entry, signal),
      ...(systemAudio ? { prepareAudio: () => soundRouting!.prepare() } : {}),
      resolveSource: (entry, playbackId, signal, fromStart, goLive, preparing, destination = targets.destination) => {
        const browser = destination?.backend === "browser";
        if ((browser || destination?.remote) && /^(library|recording):/.test(entry.source)) throw new Error("This source is currently available on the Core's own player only.");
        if (entry.source.startsWith("web:")) return resolveWebMedia(entry.source.slice(4), signal, entry.quality, store.streamingCommunityOrigin(), {
          browser: browser || destination?.backend === "sendspin" && devices.videoTarget(runtime)?.backend === "browser",
          videoOnly: destination?.backend === "sendspin", capabilities: destination?.capabilities,
        });
        if (entry.source.startsWith("jellyfin:")) {
          if (browser) throw new Error("Open Jellyfin directly on this device.");
          return playback.resolve(entry.source.slice(9), playbackId, signal, fromStart, preparing).then(media => preparing || destination?.remote ? media : subtitles.prepare(media, playbackId, signal));
        }
        if (entry.source.startsWith("library:")) return library.getPlayable(entry.source.slice(8));
        if (entry.source.startsWith("recording:")) throw new Error(RECORDINGS_UNSUPPORTED);
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
      deactivate: () => { void playback.deactivate(); },
      activatePrepared: (playbackId, previous) => { if (!playback.activatePrepared(playbackId, previous)) void playback.deactivate(); },
      activateHandoff: (playbackId, previous) => playback.activatePrepared(playbackId, previous, true),
      releaseHandoff: playbackId => { void playback.release(playbackId); },
      observe: player => { subtitles.observe(player); void playback.observe(player); },
      stopped: playbackId => subtitles.stopped(playbackId),
    });
    const subtitles = createSubtitles(() => session.state.player, (playbackId, subtitle) => session.addSubtitle(playbackId, subtitle));
    radioProgramme = createRadioProgramme({ station: radio.programmeStation, metadata: radio.metadata, publish: (playbackId, programme) => session.updateRadioProgramme(playbackId, programme) });
    const catalog = createCatalog({ library, radio, jellyfin, viewing: { store: viewingStore, session, refreshHistory: items => metadata.refreshHistory(items, viewingStore, () => { if (!runtime.disposed) session.invalidate("progress"); }) } });
    Object.assign(runtime, { session, targets, subtitles, radioProgramme, playback, catalog });
    runtimes.set(id, runtime);
    return runtime;
  }
  function stopSources(matches: (source: string) => boolean) {
    for (const runtime of runtimes.values()) {
      const state = runtime.session.state;
      const source = state.queue.find(entry => entry.id === state.currentEntryId)?.source;
      if (!source || !matches(source) || runtime.disposed) continue;
      runtime.sourceGeneration++;
      try { runtime.session.stopForSourceChange(); }
      catch { diagnostics.log.add("Playback", "An output could not confirm the changed source stopped."); }
    }
  }
  let sendspin: ReturnType<typeof createSendspin> | undefined;
  let sendspinSettingsTail = Promise.resolve();
  const sendspinHostingState = (): SendspinHostingState => ({
    enabled: store.sendspinEnabled() ?? true,
    active: !!sendspin?.listening,
    restartRequired: false,
    configuredExternally,
    error: (store.sendspinEnabled() ?? true) ? sendspin?.listenerError ?? sendspinError : null,
  });
  const playlists = createPlaylists({ databasePath: options.databasePath, onChange: () => invalidateAll("playlists"), queue: () => session.state.queue,
    upNext: () => {
      const current = session.state.queue.findIndex(entry => entry.id === session.state.currentEntryId);
      const cursor = current >= 0 ? current : session.state.queue.findIndex(entry => entry.id === session.state.queueCursorEntryId);
      return session.state.queue.slice(cursor + 1);
    },
    loadQueue: async (entries, mode, authorize, playedBy, title) => { await session.loadQueue(entries, mode, authorize, playedBy, undefined, title); },
    resolveSource: async source => {
      const page = await loadProviderList(source.provider, source.url, shutdown.signal);
      return { name: page.title ?? "Playlist", entries: providerListEntries(page) };
    } });
  const folders = createMediaFolders();
  const library = createLibrary({ folders, ffprobePath: buildInfo.packaged ? process.env.COUCH_FFPROBE ?? null : undefined, databasePath: options.databasePath, onChange: () => { idle.activity(); invalidateAll("library"); } });
  const continuation = createContinuationResolver({ library, jellyfin });
  const collections = createCollections({ databasePath: options.databasePath, library, onChange: () => invalidateAll("library"), queue: () => session.state.queue, loadQueue: async (entries, mode, authorize, playedBy, title) => { await session.loadQueue(entries, mode, authorize, playedBy, undefined, title); } });
  const radio = createRadio({ databasePath: options.databasePath, onChange: () => invalidateAll("radio") });
  const folderSettings = createFolderSettings(library, folders);
  const radioSettings = createRadioSettings(radio);
  const guide = createGuide({ databasePath: options.databasePath, onChange: () => invalidateAll("iptv"),
    onSourcesChanged: channelIds => {
      stopSources(source => channelIds.some(id => source === `iptv:${id}`));
    },
    enqueue: async (channel, playNow, authorize, playedBy) => {
      const existing = session.state.queue.find(entry => entry.source === `iptv:${channel.id}`);
      if (existing) { if (playNow) await session.command({ type: "play", entryId: existing.id, fromStart: true }, authorize, playedBy); }
      else await session.command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow }, authorize, playedBy);
    },
  });
  const providers = createProviders({ databasePath: options.databasePath, onChange: () => invalidateAll("providers"), streamingCommunityOrigin: () => store.streamingCommunityOrigin() });
  const forLater = createForLater({
    webMetadata: (url, collection) => providerMetadata(providers.cachedItem(url, collection), !!collection),
    databasePath: options.databasePath, onChange: () => invalidateAll("for-later"),
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
      return { id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...libraryMetadata(item) };
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
    enqueue: async (entry, intent, authorize, playedBy) => {
      if (intent !== undefined) await session.playNewEntries([entry], { intent, authorize, playedBy });
      else await session.command({ type: "enqueue", entry }, authorize, playedBy);
    },
  });
  const metadata = createProviderMetadata({ store: createSessionStore(store), cachedItem: providers.cachedItem, onChange: () => invalidateAll("progress") });
  const household = createRuntime(playbackCatalog.defaultFor(null));
  for (const record of playbackCatalog.all()) createRuntime(record);
  const { session, targets } = household;
  const nativeRuntime = () => [...runtimes.values()].find(runtime => !runtime.disposed && runtime.targets.nativeAssigned) ?? household;
  const resolvePlayback = (selection: string | null, controllerId: string | null) => {
    const record = selection === "default" || selection === "personal" ? playbackCatalog.defaultFor(controllerId)
      : selection === null || selection === "household" ? playbackCatalog.get(sessionId) : playbackCatalog.get(selection);
    if (!record) throw new ControllerError("This playback is no longer available.", 404);
    const existing = runtimes.get(record.id);
    const runtime = existing ?? createRuntime(record);
    if (!existing) runtime.targets.publish();
    return runtime;
  };
  const audioSocket = (deviceId: string) => [...sockets].find(socket => socket.data.renderer?.id === deviceId || deviceId === "native" && socket.data.trusted);
  const reserveAudioOutput = (deviceId: string, playbackId: string, acquire: boolean, retiringPlaybackId?: string) => {
    const socket = audioSocket(deviceId);
    if (!socket) {
      if (!acquire) return Promise.resolve(); // A disconnected client releases its own output.
      throw new Error("Open Couch on this device before adding it.");
    }
    socket.data.authorize();
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { pendingAudioOutputs.delete(requestId); reject(new Error("This device did not confirm audio output. Keep Couch open there and try again.")); }, 5000);
      pendingAudioOutputs.set(requestId, { socket, resolve, reject, timer });
      if (!socket.send(JSON.stringify({ type: "deviceAudioOutput", requestId, playbackId, acquire, ...(retiringPlaybackId ? { retiringPlaybackId } : {}) } satisfies ServerMessage))) {
        clearTimeout(timer); pendingAudioOutputs.delete(requestId); reject(new Error("The audio device disconnected. Open Couch there and try again."));
      }
    });
  };
  const devices = createPlaybackDevices({
    registry, catalog: playbackCatalog, runtimes: () => [...runtimes.values()], host: () => sendspin,
    changed: publishPlaybacks,
    name: id => id === "native" ? store.installationName() : store.controller(id.replace(/^(browser|receiver)-/, ""))?.name,
    ready: deviceId => !!audioSocket(deviceId)?.data.audioReady,
    reserve: reserveAudioOutput,
    activate: async deviceId => {
      const socket = audioSocket(deviceId);
      if (!socket) throw new Error("Open Couch on this device before adding it.");
      if (socket.data.audioReady) return;
      socket.send(JSON.stringify({ type: "audioActivationRequired" } satisfies ServerMessage));
      for (let attempt = 0; attempt < 120 && sockets.has(socket) && !socket.data.audioReady; attempt++) await Bun.sleep(250);
      if (!socket.data.audioReady) throw new Error("Tap Enable audio in Couch on the selected device, then try again.");
    },
    localLevel: systemAudio ? () => soundRouting!.state : undefined,
    localVolume: systemAudio ? async (volume, muted, authorize) => { await soundRouting!.volume(volume, authorize); await soundRouting!.mute(muted, authorize); } : undefined,
  });
  const controllers = createControllers({ store, pairingCode, recoveryCode: options.adminRecoveryCode, onChange: controller => {
    if (controller?.role === "controller") void options.nativeBluetooth?.({ op: "cancel", owner: controller.id }).catch(() => {});
    if (controller) {
      registry.rename(`browser-${controller.id}`, controller.name);
      registry.rename(`receiver-${controller.id}`, controller.name);
    } else registry.rename("native", store.installationName());
    sendspin?.refresh();
    invalidateAll("controllers");
  }, onRevoke: id => {
    for (const clientId of sendspinIdentity?.revoke(id) ?? []) sendspin?.disconnectClient(clientId);
    void options.nativeBluetooth?.({ op: "cancel", owner: id }).catch(() => {});
    for (const socket of sockets) if (socket.data.controllerId === id) {
      socket.unsubscribe(topic(socket.data.runtime, socket.data.playbackClock));
      socket.close(4001, "This remote's access was revoked. Pair again.");
    }
  } });
  const updateDirectory = join(dirname(options.databasePath), "updates");
  if (systemAudio) soundRouting = createSoundRouting({
    saved: store.audioOutput, savedProfile: store.audioProfile, save: store.saveAudioOutput,
    active: () => { const runtime = nativeRuntime(); return runtime.targets.nativeAssigned && ["loading", "playing", "paused"].includes(runtime.session.state.player.status); },
    pin: output => options.sendPlayer?.({ type: "audioOutput", output }),
    lost: error => { const runtime = nativeRuntime(); if (runtime.targets.nativeAssigned) runtime.session.audioLost(error); }, changed: value => { nativeRuntime().session.updateSystemAudio(value); publishPlaybacks(); },
    ...(macAudio ? { backend: macAudio.routing, subscribe: macAudio.subscribe, platform: "mac" as const } : {}),
    ...(windowsAudio ? { backend: windowsAudio.routing, subscribe: windowsAudio.subscribe, platform: "windows" as const, setSystemDefault: false } : {}),
  });
  const reconnectBluetooth = store.audioProfile()?.bluetoothAddress;
  if (systemAudio && reconnectBluetooth) void options.nativeBluetooth?.({ op: "reconnect", owner: "boot", device: reconnectBluetooth }).catch(() => {});
  sound = createSound({ routing: soundRouting, delay: { get: () => nativeRuntime().session.state.preferences!.device.audioDelay, set: delay => nativeRuntime().session.saveAudioDelay(delay) }, available: systemAudio, idle: () => admitted() && nativeRuntime().session.state.player.status === "idle", begin: () => idle.begin("Waiting for the sound test to stop."), ...(macAudio ? { backend: macAudio.test, testAvailable: macAudio.canTest, platform: "mac" as const } : {}), ...(windowsAudio ? { backend: windowsAudio.test, testAvailable: false, platform: "windows" as const } : {}) });
  const toolHealth = createToolHealth({ packaged: !!(buildInfo.packaged && options.nativeDiagnostics && process.platform === "linux"), helpers: buildInfo.helpers });
  let manual: ReturnType<typeof createManualUpdate> | undefined;
  const updateWork = () => {
    return idle.workReason() ?? (library.scanning() ? "Waiting for the library scan to finish." : inspections.size ? "Waiting for source inspection to finish." : null);
  };
  const idleReason = () => idle.reason(updateWork());
  const idleAdmission = () => manual?.needsRefresh() ? "Refresh update status before auto-install." : updates.state.policy === "idle" ? idleReason() : "Auto-install is off.";
  const updates = createUpdates(updateDirectory, { version: buildInfo.version, revision: buildInfo.revision }, options.updateFeed, undefined, admitted, options.updater ? {
    busy: () => !!manual?.busy(), idle: idleAdmission,
    status: requestId => manual!.status(requestId), install: (candidateId, requestId, guard) => manual!.automatic(candidateId, requestId, guard),
  } : undefined);
  manual = options.updater ? createManualUpdate(options.updater, admitted, updates.candidateReady, updates.canRepair) : undefined;
  const appearance = createAppearance(store, value => { for (const runtime of runtimes.values()) runtime.session.updateAppearance(value); });
  const jellyfinSettings = createJellyfinSettings({ jellyfin, invalidate: () => {
    stopSources(source => source.startsWith("jellyfin:"));
    invalidateAll("jellyfin");
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

  const peer = (request: Request): string => server.requestIP(request)?.address ?? lan?.servers.map(listener => listener.requestIP(request)?.address).find(Boolean) ?? "";
  const access = (request: Request) => httpsProxy.classify(request, peer(request));
  const allowed = (request: Request, requireOrigin: boolean): boolean => {
    const context = access(request);
    if (context === "rejected") return false;
    if (context === "proxied") return store.remoteControlEnabled() && (!requireOrigin || request.headers.get("origin") === httpsProxy.origin);
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
  const localSetup = (request: Request) => !options.managedLan && !options.sendPlayer && access(request) === "direct"
    && loopbackPeer(peer(request)) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)
    && allowed(request, false);

  const playbackActor = (controllerId: string | null): PlaybackActor | undefined => {
    if (controllerId === null) return { deviceId: "host", name: store.installationName() };
    const device = store.controller(controllerId);
    return device ? { deviceId: device.id, name: device.name } : undefined;
  };

  // Catalog intake stays private to the hub. Callers do not reserve, normalize
  // or apply play intent; Session alone owns queue order and playback. Already
  // normalized enqueue/transport commands still go directly to Session.
  const enqueueMedia = (runtime: Runtime, action: Action, authorize: () => void, playedBy?: PlaybackActor): Promise<void> | undefined => {
    const { session } = runtime;
    const inspectionKey = (entryId: string) => `${runtime.id}:${entryId}`;
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
      case "enqueueLibrary":
        prepare = async () => {
          const media = await library.getPlayable(action.itemId);
          // The local metadata read also needs the guard after asynchronous I/O.
          if (!authorized()) return null;
          const item = library.getItem(action.itemId);
          return { entry: { id: action.entryId, title: media.title.slice(0, 300), source: `library:${action.itemId}`, ...libraryMetadata(item) }, fromStart: action.fromStart };
        };
        break;
      case "enqueueAlbum":
        prepare = () => {
          const { album, items } = library.albumTracks(action.albumId);
          if (items.some(item => !item.available)) throw new Error("Some album tracks are unavailable. Reconnect their drive and scan again.");
          return { title: album.title, entries: items.map(item => ({ id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...libraryMetadata(item) })) };
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
      for (const entry of "entry" in prepared ? [prepared.entry] : prepared.entries) {
        const mediaId = playbackMediaId(entry);
        if (mediaId && (entry.subtitle || entry.description || entry.thumbnail)) {
          const details = { ...(entry.subtitle ? { subtitle: entry.subtitle } : {}), ...(entry.description ? { description: entry.description } : {}), ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}), ...(entry.collection ? { collection: entry.collection } : {}) };
          try { if (runtime.store.enrichHistorySource(mediaId, entry.source, details)) session.invalidate("progress"); } catch { /* Optional catalogue refresh must not prevent playback. */ }
        }
      }
      if ("entry" in prepared) {
        const { entry, inspectUrl } = prepared;
        if (action.type === "enqueueProvider" && action.collection) entry.collection = action.collection;
        if (intent !== undefined) await session.playNewEntries([entry], { intent, fromStart: prepared.fromStart, authorize, playedBy });
        else session.command({ type: "enqueue", entry, ...(action.placement ? { placement: action.placement } : {}) }, authorize, playedBy);
        if (entry.source.startsWith("web:")) {
          void metadata.load(entry.source.slice(4)).then(details => {
            if (!closed && Object.keys(details).length) { authorize(); session.enrichEntry(entry.id, entry.source, details, true); }
          }).catch(() => {});
        }
        if (inspectUrl) {
          const controller = new AbortController();
          inspections.set(inspectionKey(entry.id), controller);
          void inspectWebMedia(inspectUrl, controller.signal, store.streamingCommunityOrigin()).then(metadata => {
            if (!closed && !controller.signal.aborted) { authorize(); session.enrichEntry(entry.id, entry.source, metadata); }
          }).catch(() => {}).finally(() => {
            if (inspections.get(inspectionKey(entry.id)) === controller) { inspections.delete(inspectionKey(entry.id)); idle.activity(); }
          });
        }
      } else {
        if (intent !== undefined) {
          const entries = prepared.entries.map(entry => ({ ...entry, id: crypto.randomUUID() }));
          await session.playNewEntries(entries.slice(0, 1), { intent, fromStart: true, authorize, playedBy, continuation: { title: prepared.title, entries: entries.slice(1) } });
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
    [/^\/api\/updates(?:\/|$)/, ["updates"]],
    [/^\/api\/tools(?:\/|$)/, ["tools"]],
  ];
  type Fetch = (request: Request, server: Bun.Server<SocketData>) => Promise<Response | undefined>;
  const publishWrites = (handle: Fetch): Fetch => async (request, server) => {
    const response = await handle(request, server);
    if (response?.ok && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const path = new URL(request.url).pathname;
      const domains = writes.find(([pattern]) => pattern.test(path))?.[1];
      if (domains) invalidateAll(...domains);
    }
    return response;
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
      "/api/connection": request => allowed(request, false) ? cors(request, json({ name: store.installationName(), installationId: store.installationId(), urls: access(request) === "proxied" ? [httpsProxy.origin] : connectionUrls, player: session.state.player.status, remoteControlEnabled: store.remoteControlEnabled(), capabilities: { browserPlayback: true, nativePlayback: !!options.sendPlayer, restart: !!options.restart }, ...(options.managedLan ? { lanError } : {}), ...(localSetup(request) ? { localSetupAvailable: store.controllers().length === 0 } : {}), desktopRemoteUi: 1, desktopClientProtocol, playbackClock: 1, tvPresentation: process.env.COUCH_TV_PRESENTATION === "1" })) : json({ error: "Unrecognized host or origin." }, 403),
      "/api/setup-local": {
        POST: async request => {
          if (!localSetup(request) || request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Set up Couch from its local page." }, 403);
          if (!admitted()) return json({ error: UPDATING_PAUSED }, 503);
          try {
            const name = await settingField(request, "name");
            if (!admitted()) return json({ error: UPDATING_PAUSED }, 503);
            const token = store.pair(name, true);
            invalidateAll("controllers");
            return json({ token, controller: store.controllerForToken(token), installationId: store.installationId() });
          } catch (error) {
            return json({ error: error instanceof ControllerError ? error.message : STORAGE_ERROR("this device") }, error instanceof ControllerError ? error.status : 500);
          }
        },
      },
      "/api/pair": {
        POST: async request => {
          if (!allowed(request, true)) return json({ error: "Unrecognized host or origin." }, 403);
          const respond = (body: unknown, status = 200) => cors(request, json(body, status));
          if (!store.remoteControlEnabled()) return respond({ error: REMOTES_OFF(store.installationName()) }, 503);
          if (!admitted()) return respond({ error: UPDATING_PAUSED }, 503);
          if (Date.now() - pairWindow >= 60_000) { pairWindow = Date.now(); pairAttempts = 0; }
          if (++pairAttempts > 20) return respond({ error: "Too many pairing attempts. Try again in a minute." }, 429);
          if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return respond({ error: "Send a JSON pairing request." }, 415);
          let body: unknown;
          try { body = await request.json(); } catch { return respond({ error: "Invalid pairing request." }, 400); }
          if (!store.remoteControlEnabled()) return respond({ error: REMOTES_OFF(store.installationName()) }, 503);
          if (!admitted()) return respond({ error: UPDATING_PAUSED }, 503);
          if (typeof body !== "object" || body === null || !("code" in body) || body.code !== pairingCode) return respond({ error: "The pairing code is incorrect." }, 401);
          try {
            idle.activity();
            const token = store.pair("name" in body ? body.name : undefined);
            invalidateAll("controllers");
            return respond({ token, controller: store.controllerForToken(token), installationId: store.installationId() });
          } catch (error) {
            return respond({ error: error instanceof ControllerError ? error.message : STORAGE_ERROR("this remote") }, error instanceof ControllerError ? error.status : 500);
          }
        },
      },
    },
    fetch: publishWrites(async (request, server) => {
      const url = new URL(request.url);
      const websocket = url.pathname === "/api/ws";
      if (!allowed(request, websocket)) return json({ error: "Unrecognized host or origin." }, 403);
      if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, POST, DELETE", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Couch-Session, X-Couch-Playback", "Access-Control-Max-Age": "600" } }));
      const token = websocket ? url.searchParams.get("token") ?? "" : request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
      const trusted = access(request) === "direct" && token === options.hostToken && (!options.managedLan || loopbackPeer(peer(request)));
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
      const selection = websocket ? url.searchParams.get("playback") ?? url.searchParams.get("session") : request.headers.get("X-Couch-Playback") ?? request.headers.get("X-Couch-Session");
      let runtime: Runtime;
      try { runtime = resolvePlayback(selection, caller.controller?.id ?? null); }
      catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Playback is unavailable." }, 404)); }
      const { session, targets, subtitles, catalog } = runtime;
      if (url.pathname === "/api/settings/sharing") {
        if (request.method === "GET") return cors(request, json({ enabled: store.remoteControlEnabled() }));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        if (!trusted) return cors(request, json({ error: `Change this on ${store.installationName()}.` }, 403));
        try {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          const enabled = await settingField(request, "enabled");
          if (typeof enabled !== "boolean") throw new ControllerError("Choose whether to allow remotes.");
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          await lan?.setEnabled(enabled);
          store.saveRemoteControlEnabled(enabled);
          if (!enabled) for (const socket of sockets) if (!socket.data.trusted) {
            socket.unsubscribe(topic(socket.data.runtime, socket.data.playbackClock));
            socket.close(4003, "Remotes are off. Your pairing is remembered.");
          }
          if (!enabled) for (const device of sendspin?.devices ?? []) if (sendspinIdentity.owner(device.id) !== "host") sendspin?.disconnectClient(device.id);
          invalidateAll("controllers");
          return cors(request, json({ enabled }));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Couldn't save Allow remotes." }, error instanceof ControllerError ? error.status : 500)); }
      }
      if (url.pathname === "/api/settings/lan-network") {
        if (!options.managedLan || !trusted) return cors(request, json({ error: `Change this on ${store.installationName()}.` }, 403));
        const state = () => ({ selected: store.lanNetwork(), active: lan?.network?.address ?? null, networks: lanNetworks(networkInterfaces()).map(({ name, address }) => ({ name, address })) });
        if (request.method === "GET") return cors(request, json(state()));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        try {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          const value = await settingField(request, "address");
          if (value !== null && (typeof value !== "string" || !lanNetworks(networkInterfaces()).some(network => network.address === value))) throw new ControllerError("Choose an available home network.");
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          await lan?.setNetwork(value);
          store.saveLanNetwork(value);
          invalidateAll("controllers");
          return cors(request, json(state()));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Couldn't choose the network." }, error instanceof ControllerError ? error.status : 500)); }
      }
      if (url.pathname === "/api/settings/sendspin") {
        if (caller.authority === "controller") return cors(request, json({ error: ADMIN_ONLY }, 403));
        if (request.method === "GET") return cors(request, json(sendspinHostingState()));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        try {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          const enabled = await settingField(request, "enabled");
          if (typeof enabled !== "boolean") throw new ControllerError("Choose whether to host Sendspin.");
          const mutation = sendspinSettingsTail.then(async () => {
            if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
            if (!identity() || identity()?.authority === "controller") throw new ControllerError(NO_LONGER_ADMIN, 403);
            store.saveSendspinEnabled(enabled);
            if (enabled) await startSendspin();
            else await stopSendspin();
            invalidateAll("controllers");
            return sendspinHostingState();
          });
          sendspinSettingsTail = mutation.then(() => {}, () => {});
          return cors(request, json(await mutation));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Couldn't save Sendspin hosting." }, error instanceof ControllerError ? error.status : 500)); }
      }
      if (url.pathname === "/api/settings/origin-domain") {
        if (!options.managedLan || caller.authority === "controller") return cors(request, json({ error: ADMIN_ONLY }, 403));
        if (request.method === "GET") return cors(request, json({ domain: store.originDomain() }));
        if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
        try {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          const value = await settingField(request, "domain");
          if (typeof value !== "string") throw new ControllerError("Enter a network address.");
          const domain = value.trim();
          const alias = domain ? originDomainUrl(domain, port) : "";
          if (alias) try { await lan?.validateAlias(alias); }
          catch (error) { throw new ControllerError(error instanceof Error ? error.message : "The network address is unavailable."); }
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
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
      if (url.pathname === "/api/sendspin/enrollment") {
        if (sendspinHostingState().enabled && !sendspin?.listening) await ensureSendspin();
        if (request.method === "GET" && (!sendspin?.listening || !sendspinHostingState().enabled)) return cors(request, json({ available: false }));
        if (!sendspin?.listening || !sendspinIdentity || !sendspinConfig || !sendspinHostingState().enabled) return cors(request, json({ error: "Sendspin hosting is not enabled on this Couch." }, 503));
        try {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          const address = sendspinConfig.publicUrl ? new URL(sendspinConfig.publicUrl) : new URL(access(request) === "proxied" ? httpsProxy.origin! : url.origin);
          if (!sendspinConfig.publicUrl) {
            if (address.protocol === "https:") throw new ControllerError("Configure this Couch's secure Sendspin address before connecting.", 503);
            address.protocol = "ws:"; address.port = String(sendspin.port); address.pathname = "/sendspin";
          }
          const configuration = { available: true, url: address.href, name: sendspinConfig.name, serverId: sendspinIdentity.serverId };
          if (request.method === "GET") return cors(request, json(configuration));
          if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
          const { clientId, rendererTargetId } = await settingFields(request, ["clientId", "rendererTargetId"]);
          const current = identity();
          if (!current || !admitted()) throw new ControllerError("Pair this remote first.", 401);
          if (!sendspin?.listening || !sendspinHostingState().enabled) throw new ControllerError("Sendspin hosting is not enabled on this Couch.", 503);
          if (typeof clientId !== "string") throw new ControllerError("Choose a Sendspin client identity.");
          // A live, same-owner Couch renderer qualifies software transfer only; it cannot attest a speaker's acoustic state.
          if (rendererTargetId !== undefined && (typeof rendererTargetId !== "string" || !(rendererTargetId === "native" && trusted && registry.targets.some(target => target.id === "native" && target.connected))
            && ![...sockets].some(socket => socket.data.renderer?.id === rendererTargetId && socket.data.controllerId === (current.controller?.id ?? null) && socket.data.trusted === trusted))) throw new ControllerError("Connect this Couch renderer before qualifying its Sendspin output.");
          const enrollment = sendspinIdentity.enroll(current.controller?.id ?? "host", clientId, rendererTargetId);
          sendspin.refresh();
          return cors(request, json({ ...configuration, ...enrollment }));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Sendspin enrollment failed." }, error instanceof ControllerError ? error.status : 400)); }
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
      if (url.pathname === "/api/settings/restart" && request.method === "GET") return cors(request, caller.authority !== "controller" ? json({ instanceId, available: !!options.restart, ready: admitted() }) : json({ error: ADMIN_ONLY }, 403));
      if (url.pathname === "/api/settings/restart" && request.method === "POST") {
        if (caller.authority === "controller") return cors(request, json({ error: ADMIN_ONLY }, 403));
        try {
          const confirmed = await settingField(request, "confirmInterrupt");
          if (confirmed !== true) return cors(request, json({ error: "Confirm interruption before restarting Couch." }, 400));
          if (!["host", "administrator"].includes(identity()?.authority ?? "")) return cors(request, json({ error: NO_LONGER_ADMIN }, 403));
          if (!options.restart) return cors(request, json({ error: "Restart needs the installed Couch app." }, 409));
          await options.restart(true);
          return cors(request, json({ ok: true, instanceId }, 202));
        } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Restart failed." }, 409)); }
      }
      if (manual && url.pathname === "/api/updates/install" && request.method === "POST") return cors(request, await manual.install(request, identity));
      if (manual && url.pathname === "/api/updates/repair" && request.method === "POST") return cors(request, await manual.repair(request, identity));
      if (!admitted()) return cors(request, json({ error: UPDATING_PAUSED }, 503));
      if (url.pathname === "/api/activity" && request.method === "POST") {
        try {
          if (await settingField(request, "activity") !== true || !admitted() || !identity()) return cors(request, json({ error: "Controls are paused." }, 503));
          idle.activity(); return cors(request, new Response(null, { status: 204 }));
        } catch { return cors(request, json({ error: "Invalid activity signal." }, 400)); }
      }
      const finishWork = !websocket && !["GET", "HEAD"].includes(request.method) ? idle.begin("Waiting for a settings, scan or import request to finish.") : undefined;
      try {
        const playedBy = caller.controller ? { deviceId: caller.controller.id, name: caller.controller.name } : playbackActor(null);
        const currentIdentity = () => admitted() ? identity() : null;
        const authorize = () => {
          if (!admitted()) throw new ControllerError(UPDATING_PAUSED, 503);
          if (!identity()) throw new ControllerError("This remote's access was revoked. Pair again.", 401);
        };
        const joining = /^\/api\/playbacks\/([^/]+)\/join$/.exec(url.pathname);
        if (joining && request.method === "POST") {
          try {
            const { deviceId } = await settingFields(request, ["deviceId"], false);
            if (typeof deviceId !== "string") throw new ControllerError("Choose this device to join playback.");
            const destination = resolvePlayback(decodeURIComponent(joining[1]!), caller.controller?.id ?? null);
            await devices.join(destination, deviceId, authorize);
            publishPlaybacks();
            return cors(request, json({ id: destination.id }));
          } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Could not join playback." }, 409)); }
        }
        if (url.pathname === "/api/playbacks" && request.method === "POST") {
          try {
            const { deviceId } = await settingFields(request, ["deviceId"], false);
            if (deviceId !== undefined && (typeof deviceId !== "string" || !devices.snapshot(runtime).devices.some(device => device.id === deviceId))) throw new ControllerError("Choose an available device.");
            authorize();
            const next = createRuntime(playbackCatalog.create(caller.controller?.id ?? null));
            next.targets.publish();
            if (typeof deviceId === "string") await devices.assign(next, [deviceId], authorize);
            playbackCatalog.select(caller.controller?.id ?? null, next.id);
            publishPlaybacks();
            return cors(request, json({ id: next.id }));
          } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Could not create playback." }, 409)); }
        }
        if (websocket && buildInfo.packaged && (url.searchParams.has("clientProtocol") && tauriOrigins.has(request.headers.get("origin") ?? "")
          ? url.searchParams.get("clientProtocol") !== String(desktopClientProtocol)
          : buildKey(buildInfo) !== url.searchParams.get("build"))) return cors(request, json({ error: VERSION_MISMATCH }, 409));
        const queueContext: PlaylistPlaybackContext = {
          queue: () => session.state.queue,
          upNext: () => { const state = session.state; const cursor = state.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId)); return state.queue.slice(cursor + 1); },
          loadQueue: async (entries, mode, authorize, actor, title) => { await session.loadQueue(entries, mode, authorize, actor, undefined, title); },
        };
        const laterContext: ForLaterPlaybackContext = {
          lookup: async reference => {
            if (reference.kind === "queue") { const entry = session.state.queue.find(entry => entry.id === reference.id); if (!entry) throw new ControllerError("This item is no longer in the queue.", 404); return entry; }
            if (reference.kind === "jellyfin") return jellyfin.entry(reference.id, crypto.randomUUID());
            if (reference.kind !== "library") throw new ControllerError("Choose a library or queue item to save.");
            const item = library.getItem(reference.id);
            if (!item) throw new ControllerError("This item is no longer in the library.", 404);
            return { id: item.id, title: item.title.slice(0, 300), source: `library:${item.id}`, ...libraryMetadata(item) };
          },
          reservePlay: () => session.reservePlay(),
          enqueue: async (entry, intent, guard, actor) => { if (intent !== undefined) await session.playNewEntries([entry], { intent, authorize: guard, playedBy: actor }); else await session.command({ type: "enqueue", entry }, guard, actor); },
        };
        const guideContext: GuidePlaybackContext = { enqueue: async (channel, playNow, guard, actor) => {
          const existing = session.state.queue.find(entry => entry.source === `iptv:${channel.id}`);
          if (existing) { if (playNow) await session.command({ type: "play", entryId: existing.id, fromStart: true }, guard, actor); }
          else await session.command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow }, guard, actor);
        } };
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
        if (!websocket && /^\/api\/iptv(?:\/|$)/.test(url.pathname)) return cors(request, await guide.handle(request, currentIdentity, playedBy, guideContext));
        if (!websocket && (/^\/api\/controllers(?:\/|$)/.test(url.pathname) || (url.pathname === "/api/settings" || url.pathname === "/api/settings/setup"))) return cors(request, await controllers.handle(request, currentIdentity));
        if (!websocket && /^\/api\/jellyfin(?:\/(?:connection|test))?$/.test(url.pathname)) return cors(request, await jellyfinSettings.handle(request, currentIdentity));
        if (!websocket && (/^\/api\/library\/folders(?:\/browse)?$/.test(url.pathname) || /^\/api\/library\/sources\/[\w-]{1,80}(?:\/(?:scan|test|verify))?$/.test(url.pathname) || url.pathname === "/api/library/sources" && request.method !== "GET")) return cors(request, await folderSettings.handle(request, currentIdentity));
        if (!websocket && /^\/api\/radio\/(?:avoid(?:\/programmes)?|sources|playlists(?:\/[\w-]{1,80}(?:\/refresh)?)?)$/.test(url.pathname)) return cors(request, await radioSettings.handle(request, currentIdentity));
        if (!websocket && /^\/api\/for-later(?:\/|$)/.test(url.pathname)) return cors(request, await forLater.handle(request, authorize, playedBy, laterContext));
        if (!websocket) return cors(request, await (/^\/api\/collections(?:\/|$)/.test(url.pathname) ? collections.handle(request, authorize, playedBy, queueContext) : url.pathname === "/api/subtitles" ? subtitles.handle(request, authorize) : /^\/api\/playlists(?:\/|$)/.test(url.pathname) ? playlists.handle(request, authorize, playedBy, queueContext) : url.pathname.startsWith("/api/providers/") ? providers.handle(request, authorize) : catalog.handle(request, trusted, authorize, playedBy)));
        return server.upgrade(request, { data: { runtime, playbackClock: url.searchParams.get("playbackClock") === "1", trusted, controllerId: caller.controller?.id ?? null, authorize, window: Date.now(), count: 0 } }) ? undefined : json({ error: "WebSocket upgrade required." }, 400);
      } finally { finishWork?.(); }
    }),
    websocket: {
      data: {} as SocketData,
      maxPayloadLength: 64 * 1024,
      backpressureLimit: 4 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 60,
      sendPings: true,
      open(socket) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        sockets.add(socket);
        socket.subscribe(topic(socket.data.runtime, socket.data.playbackClock));
        if (socket.data.trusted) socket.subscribe("navigation");
        socket.send(JSON.stringify({ type: "state", state: snapshot(socket.data.runtime) } satisfies ServerMessage));
      },
      close(socket) { for (const [id, pending] of pendingAudioOutputs) if (pending.socket === socket) { clearTimeout(pending.timer); pendingAudioOutputs.delete(id); pending.reject(new Error("The audio device disconnected. Open Couch there and try again.")); } socket.data.renderer?.close(); sockets.delete(socket); if (socket.data.controllerId) void options.nativeBluetooth?.({ op: "cancel", owner: socket.data.controllerId }).catch(() => {}); },
      async message(socket, message) {
        const runtime = socket.data.runtime;
        const { session, targets, id: sessionId } = runtime;
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this remote again."); return; }
        if (Date.now() - socket.data.window >= 1000) { socket.data.window = Date.now(); socket.data.count = 0; }
        if (++socket.data.count > 60) { socket.close(1008, "Too many commands."); return; }
        if (typeof message !== "string") { socket.close(1003, "JSON text messages required."); return; }
        let command;
        try {
          const value = JSON.parse(message);
          if (value?.type === "deviceAudioOutputResult") {
            const pending = typeof value.requestId === "string" ? pendingAudioOutputs.get(value.requestId) : undefined;
            if (!pending || pending.socket !== socket || value.error !== undefined && (typeof value.error !== "string" || value.error.length > 500)) throw new Error("Invalid audio output response.");
            clearTimeout(pending.timer); pendingAudioOutputs.delete(value.requestId);
            if (value.error) pending.reject(new Error(value.error)); else pending.resolve();
            return;
          }
          if (value?.type === "selectPlayback" || value?.type === "selectSession") {
            const selection = value.type === "selectPlayback" ? value.playbackId : value.mode;
            if (typeof selection !== "string") throw new Error("Invalid playback selection.");
            const next = resolvePlayback(selection, socket.data.controllerId);
            socket.unsubscribe(topic(runtime, socket.data.playbackClock));
            socket.data.runtime = next;
            socket.subscribe(topic(next, socket.data.playbackClock));
            socket.send(JSON.stringify({ type: "state", state: snapshot(next) } satisfies ServerMessage));
            return;
          }
          const renderer = parseRendererMessage(value);
          if (renderer) {
            const sendRenderer = (command: PlaybackCommand) => {
              // Revocation still retires playback on the socket before closing it.
              if (command.type !== "stop") socket.data.authorize();
              if (socket.send(JSON.stringify({ type: "rendererCommand", sessionId: socket.data.rendererSessionId!, command } satisfies ServerMessage)) === 0) throw new Error("The renderer disconnected.");
            };
            if (renderer.type === "registerNativeRenderer" || renderer.type === "registerRenderer") socket.data.rendererSessionId ??= sessionId;
            if (renderer.type === "deviceAudioReady") {
              if (!socket.data.renderer && !socket.data.trusted) throw new Error("Unregistered audio device.");
              socket.data.audioReady = renderer.ready;
              publishPlaybacks();
            } else if (renderer.type === "registerNativeRenderer") {
              if (!socket.data.controllerId || socket.data.renderer) throw new Error("Native receiver enrollment requires its own paired connection.");
              store.markNativeReceiverUsed();
              socket.data.receiver = registry.registerReceiver(socket.data.controllerId, playbackActor(socket.data.controllerId)?.name ?? "Couch computer", sendRenderer, socket.data.authorize, () => socket.close(4000, "Native receiver lease expired."));
              socket.data.renderer = socket.data.receiver;
              socket.send(JSON.stringify({ type: "nativeLease", nonce: renderer.nonce } satisfies ServerMessage));
              socket.send(JSON.stringify({ type: "rendererRegistered", targetId: socket.data.renderer.id, sessionId: socket.data.rendererSessionId! } satisfies ServerMessage));
            } else if (renderer.type === "nativeLease") {
              if (!socket.data.receiver) throw new Error("Unregistered native receiver.");
              socket.data.receiver.renew();
              socket.send(JSON.stringify({ type: "nativeLease", nonce: renderer.nonce } satisfies ServerMessage));
            } else if (renderer.type === "registerRenderer") {
              if (socket.data.receiver) throw new Error("A native receiver cannot also register as a browser.");
              const targetId = socket.data.controllerId ? `browser-${socket.data.controllerId}` : undefined;
              if (!targetId || !registry.targets.some(target => target.id === targetId)) socket.data.renderer ??= registry.register(playbackActor(socket.data.controllerId)?.name ?? "Couch browser", sendRenderer, renderer.capabilities, socket.data.authorize, targetId);
              socket.send(JSON.stringify({ type: "rendererRegistered", targetId: socket.data.renderer?.id ?? targetId!, sessionId: socket.data.rendererSessionId!, attached: !!socket.data.renderer } satisfies ServerMessage));
            } else if (renderer.type === "rendererObservation" && socket.data.renderer && renderer.sessionId === socket.data.rendererSessionId) socket.data.renderer.observe(renderer.state);
            else throw new Error("Unregistered renderer.");
            return;
          }
          command = parseCommand(message, socket.data.trusted);
          idle.activity();
          if (socket.data.controllerId) store.touchController(socket.data.controllerId);
        } catch {
          socket.close(1008, "Invalid command or unsupported media source.");
          return;
        }
        const finishWork = idle.begin("Waiting for a remote command to finish.");
        let result: ServerMessage = { type: "result", requestId: command.requestId, ok: true };
        try {
          const playedBy = playbackActor(socket.data.controllerId);
          const authorize = socket.data.authorize;
          const action = command.action;
          const before = session.state;
          if (targets.busy) throw new Error("Playback is moving. Wait for it to finish.");
          const enqueued = enqueueMedia(runtime, action, authorize, playedBy);
          if (enqueued) {
            await enqueued;
            if (closed) return;
          } else if (action.type === "assignDevices") {
            await devices.assign(runtime, action.deviceIds, authorize, action.takeover);
          } else if (action.type === "deviceVolume") {
            await devices.volume(runtime, action.deviceId, action.volume, action.muted, authorize);
          } else if (action.type === "volume" || action.type === "mute") {
            const playback = devices.snapshot(runtime);
            await Promise.all(playback.devices.filter(device => playback.deviceIds.includes(device.id)).map(device => devices.volume(runtime, device.id, action.type === "volume" ? action.volume : device.volume, action.type === "mute" ? action.muted : device.muted, authorize)));
          } else if (action.type === "selectTarget") {
            await devices.assign(runtime, [action.targetId], authorize, action.takeover);
          } else if (action.type === "navigate") {
            if (!targets.nativeAssigned) throw new Error("Select playback on this computer to control its TV interface.");
            const listeners = [server, ...lan?.servers ?? []];
            if (!listeners.some(listener => listener.subscriberCount("navigation"))) throw new Error("The TV interface is disconnected. Try again when it reconnects.");
            const navigation = JSON.stringify({ type: "navigation", key: action.key } satisfies ServerMessage);
            for (const listener of listeners) listener.publish("navigation", navigation);
          } else {
            if (action.type === "remove") inspections.get(`${runtime.id}:${action.entryId}`)?.abort();
            if (targets.nativeAssigned && soundRouting && action.type === "pause" && !action.paused) options.sendPlayer?.({ type: "audioOutput", output: soundRouting.prepare() });
            await session.command(action, authorize, playedBy);
          }
          if (playedBy && action.type !== "navigate") {
            const added = ["enqueue", "enqueueLibrary", "enqueueJellyfin", "enqueueProvider", "enqueueRadio", "enqueueWeb", "enqueueAlbum"].includes(action.type);
            const label = action.type === "pause" ? action.paused ? "paused" : "resumed"
              : action.type === "stop" ? "stopped playback"
              : action.type === "remove" ? `removed ${before.queue.find(entry => entry.id === action.entryId)?.title || "an item"}`
              : added ? `queued ${action.type === "enqueue" ? action.entry.title : action.type === "enqueueProvider" || action.type === "enqueueWeb" ? action.title || "media" : "entryId" in action ? session.state.queue.find(entry => entry.id === action.entryId)?.title || "media" : "media"}`
              : action.type === "play" ? `played ${session.state.queue.find(entry => entry.id === action.entryId)?.title || "media"}` : null;
            if (label) session.notice(playedBy, `${playedBy.name} ${label}`);
          }
        } catch (error) {
          result = { ...result, ok: false, error: error instanceof Error ? error.message : "The command failed." };
          diagnostics.log.add("Controller command", runtime.mode === "household" ? result.error : "A personal playback command failed.");
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
  const retainedOrigins = new Set<string>();

  if (options.managedLan) {
    lan = createLanListener({
      port, enabled: store.remoteControlEnabled(), selected: store.lanNetwork() ? undefined : process.env.COUCH_LAN_INTERFACE, address: store.lanNetwork() ?? process.env.COUCH_LAN_ADDRESS,
      advertised: () => [...(store.originDomain() ? [originDomainUrl(store.originDomain(), port, !store.originDomain().startsWith("http://"))] : []), ...retainedOrigins, ...options.advertisedUrls ?? []],
      start: (network, port) => Bun.serve({ ...serveOptions, hostname: network.address, port }),
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
  let requiredCheckpoint = false;
  const close = (requiredProgress = false) => closing ??= (async () => {
    requiredCheckpoint = requiredProgress;
    closed = true;
    shutdown.abort();
    for (const controller of inspections.values()) controller.abort();
    let progressError: unknown;
    for (const runtime of runtimes.values()) {
      try { if (requiredProgress) runtime.session.quiesce(); else runtime.session.close(); }
      catch (error) { progressError ??= error; }
      runtime.disposed = true;
      runtime.subtitles.close(); runtime.radioProgramme.close();
    }
    registry.close();
    const toolsStopped = toolHealth.close();
    sound?.close();
    soundRouting?.close();
    appearance.close();
    guide.close();
    metadata.close();
    providers.close();
    playlists.close();
    forLater.close();
    collections.close();
    radio.close();
    // Start every producer's shutdown before waiting for any one producer.
    const results = await Promise.allSettled([...retiring, ...[...runtimes.values()].map(runtime => runtime.playback.close()), toolsStopped, updates.close(), library.close(), jellyfin.close(), sendspinSettingsTail.then(() => sendspin?.close()), lan?.close(), server.stop(true)]);
    diagnostics.close();
    sendspinIdentity?.close();
    playbackCatalog.close();
    for (const runtime of runtimes.values()) runtime.privateStore?.close();
    store.close();
    if (progressError) throw progressError;
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  })();

  for (const runtime of runtimes.values()) runtime.targets.publish();
  async function stopSendspin() {
    const host = sendspin;
    if (!host) return;
    try { await host.close(); }
    finally { if (sendspin === host) sendspin = undefined; }
  }
  async function startSendspin() {
    if (sendspin?.listening) return;
    if (sendspin) await stopSendspin();
    sendspinError = options.sendspinConfigError ?? null;
    if (sendspinError) return;
    try { validateSendspinConfig(sendspinConfig); }
    catch (error) { sendspinError = error instanceof Error ? error.message : "Invalid Sendspin host configuration."; return; }
    if (!sendspinIdentity) { sendspinError = "Sendspin identity is unavailable."; return; }
    store.markBufferedOutputUsed();
    let settled = false;
    const ready = Promise.withResolvers<void>();
    const timeout = setTimeout(() => { if (!settled) { settled = true; ready.resolve(); } }, 3000);
    let host: ReturnType<typeof createSendspin>;
    try { host = createSendspin(sendspinConfig, { identity: sendspinIdentity.privateKey, lookupPsk: clientId => admitted() && (store.remoteControlEnabled() || sendspinIdentity.owner(clientId) === "host") && (store.sendspinEnabled() ?? true) ? sendspinIdentity.lookup(clientId) : null,
      isQualified: clientId => sendspinIdentity.softwareOutputQualified(clientId) || !!sendspinConfig.qualifiedClientIds?.includes(clientId),
      describeClient: clientId => {
        const deviceId = sendspinIdentity.deviceId(clientId);
        if (!deviceId) return undefined;
        const owner = sendspinIdentity.owner(clientId);
        return { deviceId, name: owner === "host" ? store.installationName() : owner ? store.controller(owner)?.name : undefined };
      },
      devicesChanged: publishPlaybacks,
      listenerChanged: () => { invalidateAll("controllers"); if (!settled) { settled = true; ready.resolve(); } },
      control: async (runtimeId, clientId, command) => {
        const owner = sendspinIdentity.owner(clientId);
        const runtime = runtimes.get(runtimeId);
        if (!owner || !admitted() || !runtime) throw new Error("This client cannot control that playback session.");
        const authorize = () => { if (!admitted() || sendspinIdentity.owner(clientId) !== owner || !store.remoteControlEnabled() && owner !== "host" || !(store.sendspinEnabled() ?? true)) throw new Error("This client's access was revoked."); };
        const playbackId = runtime.session.state.player.playbackId;
        if (command === "stop") await runtime.session.command({ type: "stop" }, authorize);
        else if (playbackId && command === "next") await runtime.session.command({ type: "next", playbackId }, authorize);
        else if (playbackId && (command === "play" || command === "pause")) await runtime.session.command({ type: "pause", playbackId, paused: command === "pause" }, authorize);
      } }); }
    catch (error) { clearTimeout(timeout); sendspinError = error instanceof Error ? error.message : "Sendspin could not start."; invalidateAll("controllers"); return; }
    sendspin = host;
    await ready.promise;
    clearTimeout(timeout);
    if (host.listening && admitted()) { sendspinError = null; return; }
    sendspinError = host.listenerError ?? "Sendspin did not start listening in time.";
    await stopSendspin();
  }
  function ensureSendspin() {
    const start = sendspinSettingsTail.then(() => startSendspin());
    sendspinSettingsTail = start.catch(error => { sendspinError = error instanceof Error ? error.message : "Audio sharing could not start."; });
    return sendspinSettingsTail;
  }
  if (configuredExternally && sendspinHostingState().enabled) void ensureSendspin();
  return {
    server, session: { ...session, get state() { return closed ? session.state : snapshot(household); }, observe: registry.observeNative }, pairingCode, urls, origin, idleReason, idleAdmission, updateWork,
    close: () => close(),
    prepareRestart: () => {
      if (!admitted()) throw new Error("Already updating or restarting.");
      // The strict write happens before any irreversible shutdown. On failure the
      // authenticated listener and playback remain usable and the dirty save is retained.
      for (const runtime of runtimes.values()) runtime.session.checkpoint();
      for (const runtime of runtimes.values()) runtime.session.quiesce();
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
