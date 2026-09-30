import { ADMIN_ONLY, NO_LONGER_ADMIN, REMOTES_OFF, STORAGE_ERROR, VERSION_MISMATCH } from "./messages";
import { createLanListener, lanPeer, loopbackPeer, secureOrigin } from "./lan-listener";
import { certificate } from "./certificate";
import { createStreamingCommunitySettings } from "./streamingcommunity-settings";
import { healStreamingCommunityOrigin } from "./streamingcommunity";
import { createStartup } from "./startup";
import { requestPeer, serve, type Listener, type Socket, type Upgrade } from "./http";
import { createFrontend } from "./frontend";
import { randomInt } from "node:crypto";
import { hostname as machineName, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import type { Action, Domain, Output, PlaybackActor, PlaybackClock, PlaybackCommand, PlaybackSummary, PlayerState, QueueEntry, ServerMessage, SessionState } from "../shared/protocol";
import type { WatchingProfile } from "../shared/viewing";
import { providerForUrl, type ProviderId, type ProviderPage, type VideoQuality } from "../shared/providers";
import { createSession, type MediaSource } from "./session";
import { createAppearance } from "./appearance";
import { openStore } from "./store";
import { parseCommand, parsePlayer } from "./validation";
import { createContinuationResolver } from "./continuation";
import { createRadio } from "./radio";
import { createRadioProgramme } from "./radio-programme";
import { createRadioSettings } from "./radio-settings";
import { createCatalog, type Viewing } from "./catalog";
import { createProviderMetadata, providerMetadata } from "./provider-metadata";
import { playbackMediaId, ViewingError } from "./progress";
import { inspectWebMedia, resolveWebMedia } from "./web-media";
import { createProviders } from "./providers";
import { loadProviderList } from "./providers";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";
import { createPassThrough } from "./pass-through";
import { createForLater } from "./for-later";
import { createPlaylists } from "./playlists";
import { ControllerError, createDevices, settingField } from "./devices";
import type { DeviceIdentity } from "../shared/devices";
import { buildInfo } from "./build-info";
import { buildKey } from "../shared/build";
import { createGuide } from "./iptv";

import { createSoundRouting } from "./sound-routing";
import { createMpv } from "./mpv";
import { bluetoothSettings } from "./bluetooth";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import { createSound } from "./sound";
import { displaySettings } from "./display-settings";
import { updateSettings } from "./updates-settings";
import { createNativeUpdates } from "./updates-native";
import type { UpdateAction, UpdateState, UpdateTarget } from "../shared/app-bridge";
import { audioRendition, createSendspin, liveHls, type SyncedLoad } from "./sendspin";
import { helper } from "./helpers";
import { Identity } from "@sonn-audio/node-sendspin";
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
  nativeBluetooth?: (action: BluetoothAction) => Promise<BluetoothState>;
  nativeDisplay?: (action: DisplayAction) => Promise<DisplayState>;
  nativeUpdates?: (action: UpdateAction) => Promise<UpdateState>;
  native?: boolean;
  advertisedUrls?: string[];
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const validOriginDomain = (domain: string) => domain.length <= 253 && !isIP(domain) && !/^\d+(?:\.\d+)*$/.test(domain)
  && domain.split(".").every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
const originDomainUrl = (value: string, port: number, legacy = false) => {
  const match = /^(?:http:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?\/?$/i.exec(value);
  if (!match || !validOriginDomain(match[1]!.toLowerCase()) || match[2] && ![80, port].includes(Number(match[2]))) throw new ControllerError("Enter an HTTP hostname, optionally with Couch's port, without a path.");
  const url = new URL(`http://${match[1]!.toLowerCase()}${match[2] ? `:${match[2]}` : legacy ? `:${port}` : ""}`);
  if (url.hostname !== match[1]!.toLowerCase()) throw new ControllerError("Enter a DNS hostname for this computer.");
  return url.origin;
};
// vp9: the tab's engine is Chromium, which plays YouTube's VP9 (#644 ticket 1); others get H.264.
// origin and userAgent: what the tab sends when it fetches a source (Pass-through, #644 ticket 7).
// sendspin: this tab plays its Device's synced sound (#644 ticket 10), or follows its clock for a picture (ticket 11).
type SocketData = { trusted: boolean; deviceId: string | null; vp9: boolean; updates: boolean; tv: boolean; origin: string; userAgent: string; authorize: () => void; window: number; count: number; sendspin?: string };
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
  // Synced sound (#644 ticket 10). Admits the app window's Device and, while remotes are allowed, paired ones.
  const sendspin = createSendspin({ identity: store.sendspinKey(() => Identity.generate().privateB64u), name: store.installationName(), ffmpeg: () => helper("ffmpeg"),
    admit: id => id === store.hostDevice()?.id || !!store.device(id) && store.remoteControlEnabled(), changed: () => broadcast() });
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
  // This machine keeps plain HTTP, because localhost is a secure context; the LAN gets HTTPS (#644 ticket 8).
  const urlFor = (address: string, port: number) => `${address === "localhost" || loopbackPeer(address) ? "http" : "https"}://${address.includes(":") ? `[${address}]` : address}:${port}`;
  // The certificate names this machine, its addresses and its LAN names.
  const tls = () => {
    const name = machineName().toLowerCase();
    const aliases = [store.originDomain(), ...options.advertisedUrls ?? []].flatMap(value => { try { return value ? [new URL(value.includes("://") ? value : `http://${value}`).hostname] : []; } catch { return []; } });
    const addresses = Object.values(networkInterfaces()).flatMap(entries => (entries ?? []).filter(entry => !entry.address.includes("%")).map(entry => entry.address));
    return certificate(join(dirname(options.databasePath), "tls"), [...new Set(["localhost", name, ...name.includes(".") ? [] : [`${name}.local`], ...addresses, ...aliases])]);
  };
  let closed = false;
  const shutdown = new AbortController();
  const inspections = new Map<string, AbortController>();
  const sockets = new Set<Socket<SocketData>>();
  const clientUpdates = new Map<Socket<SocketData>, ReturnType<typeof createNativeUpdates>>();
  const updateSocket = (id: string) => [...sockets].findLast(socket => socket.data.deviceId === id && clientUpdates.has(socket));
  const updateTargets = (): UpdateTarget[] => [
    ...options.nativeUpdates ? [{ id: "host", name: store.installationName(), tv: process.env.COUCH_TV_PRESENTATION === "1" }] : [],
    ...store.devices().flatMap(device => { const socket = updateSocket(device.id); return socket ? [{ id: device.id, name: device.name, tv: socket.data.tv }] : []; }),
  ];
  const invokeUpdate = (action: UpdateAction, id: string) => {
    if (id === "host" && options.nativeUpdates) return options.nativeUpdates(action);
    const socket = updateSocket(id);
    if (!socket) return Promise.reject(new Error("This Couch app is offline. Wait for it to reconnect."));
    return clientUpdates.get(socket)!.request(action);
  };
  // A client that stops reading is dropped rather than buffered without limit. A pending state goes
  // first, so every message still follows the state it was sent after.
  const send = (socket: Socket<SocketData>, message: string) => { if (pending) flush(); return socket.bufferedAmount > 4 * 1024 * 1024 ? socket.terminate() : socket.send(message); };
  const streamingCommunitySettings = createStreamingCommunitySettings(store);
  // Checked at start so saved pages load from the current address; afterwards only
  // StreamingCommunity requests wait for the check.
  void healStreamingCommunityOrigin(store);
  const streamingCommunityOrigin = async (url: string) => providerForUrl(url) === "streamingcommunity" ? healStreamingCommunityOrigin(store) : undefined;
  const startup = createStartup(async () => null);
  let soundRouting: ReturnType<typeof createSoundRouting> | undefined;
  const systemAudio = !!options.native && process.platform === "linux";
  let sound: ReturnType<typeof createSound> | undefined;
  let radioProgramme: ReturnType<typeof createRadioProgramme> | undefined;
  // Playbacks (#644 ticket 9). Each Playback is one session with its own queue, current item,
  // position, pause state, speed and tracks, and its own outputs. A Device's screen and speakers
  // serve one Playback at a time, and every window controls one Device and the Playback it serves.
  // When a Playback's outputs are on one Device, its newest tab fetches the source itself and
  // reports back (Direct, ticket 6). Sources Chromium can't decode play in Core's own mpv, on the
  // Device that runs Core (ticket 1). When they span Devices, its Sendspin group plays the sound on
  // every speaker and reports back, and every picture Device's newest tab shows the picture, muted,
  // following the group's clock (Synced, ticket 11).
  // next and joining: the tab and output a Solo is moving to, while the source is resolved for it.
  // loaded and media: the last load, and its source as Core fetches it, for the Sendspin group.
  // resolved: the last resolution, which a screen with the same engine reuses.
  // screens: while Synced, the tabs showing the picture and the item each loaded; heard and seen:
  // the group's last report and a screen's, whose subtitles join it.
  type Playback = { id: string; session: ReturnType<typeof createSession>; outputs: Output[]; renderer: Socket<SocketData> | null; next?: Socket<SocketData>; joining?: Output; state?: SessionState;
    synced?: ReturnType<typeof sendspin.group>; loaded?: Extract<PlaybackCommand, { type: "load" }>; media?: Pick<SyncedLoad, "playbackId" | "source" | "audioSource" | "headers" | "live"> & { audioOnly?: boolean };
    resolved?: { playbackId: string; vp9: boolean; media: ReturnType<typeof resolveEntry> }; screens: Map<Socket<SocketData>, string>; heard?: PlayerState; seen?: PlayerState };
  const playbacks = new Map<string, Playback>();
  // The Device each Device's windows control, when it isn't their own.
  const controlling = new Map<string, string>();
  let mpvPlayback: Playback | null = null;
  let radioPlayback: Playback | null = null;
  const all = () => [...playbacks.values()];
  const hostId = () => store.hostDevice()?.id ?? "host";
  const deviceOf = (socket: Socket<SocketData>) => socket.data.deviceId ?? hostId();
  const newest = (deviceId: string) => [...sockets].findLast(socket => deviceOf(socket) === deviceId);
  const nameOf = (deviceId: string) => playbackActor(deviceId === hostId() ? null : deviceId)?.name ?? "A Device";
  const stateOf = (playback: Playback) => playback.state ??= playback.session.state;
  const servedBy = (deviceId: string) => all().find(playback => playback.outputs.some(output => output.deviceId === deviceId));
  const holding = (entryId: string) => all().find(playback => stateOf(playback).queue.some(entry => entry.id === entryId));
  const playing = (playbackId: string) => all().find(playback => stateOf(playback).player.playbackId === playbackId);
  const controlled = (deviceId: string) => controlling.get(deviceId) ?? deviceId;
  const control = (deviceId: string, target: string) => { if (target === deviceId) controlling.delete(deviceId); else controlling.set(deviceId, target); };
  // A window looks at the Playback its controlled Device serves. An idle one looks at the newest
  // Playback waiting for a Device (a saved Up next, or one whose last output was switched off).
  const lookedAt = (deviceId: string) => servedBy(controlled(deviceId)) ?? all().findLast(playback => !playback.outputs.length);
  // Windows controlling a Device that the Playback moved off follow it (Solo or mpv fallback).
  const follow = (left: string[], to: string) => {
    for (const deviceId of new Set([...[...sockets].map(deviceOf), ...controlling.keys()])) if (left.includes(controlled(deviceId))) control(deviceId, to);
  };
  const known = (deviceId: string) => { if (deviceId !== hostId() && !store.device(deviceId)) throw new Error("That device is no longer paired."); };
  const playerCommand = (command: PlaybackCommand) => JSON.stringify({ type: "player", command } satisfies ServerMessage);
  // Every Device has one volume and mute; on the TV with system audio they are the system's.
  const soundOf = (deviceId: string) => systemAudio && deviceId === hostId() ? { volume: common.systemAudio?.volume ?? 0, muted: !!common.systemAudio?.muted } : store.deviceSound(deviceId);
  const heard = (deviceId: string) => { const { volume, muted } = soundOf(deviceId); return muted ? 0 : volume; };
  // What an output's player plays at. On the TV the system volume does the rest; the stream stays at 100.
  const rendered = (output: Output | undefined) => !output?.sound ? 0 : systemAudio && output.deviceId === hostId() ? 100 : heard(output.deviceId);
  const levelOf = (playback: Playback) => rendered(playback.outputs[0]);
  const spans = (playback: Playback) => new Set(playback.outputs.map(output => output.deviceId)).size > 1;
  const members = (playback: Playback) => playback.outputs.flatMap(output => output.sound ? [{ deviceId: output.deviceId, level: rendered(output) }] : []);
  // The Devices a volume without a Device acts on: those in the Playback's sound, else the window's own.
  const sounding = (playback: Playback | undefined, deviceId: string) => { const ids = playback?.outputs.flatMap(output => output.sound ? [output.deviceId] : []) ?? []; return ids.length ? ids : [deviceId]; };
  const active = (status: string) => ["loading", "playing", "paused"].includes(status);
  const deliver = (playback: Playback, command: PlaybackCommand) => {
    if (mpvPlayback === playback) mpv.send(command);
    else if (playback.renderer) send(playback.renderer, playerCommand(command));
  };
  const sendPlayer = (playback: Playback, command: PlaybackCommand) => {
    if (command.type === "load") playback.loaded = command;
    if (command.type === "load" && !!command.mpv !== (mpvPlayback === playback)) {
      if (command.mpv) {
        // Only the Device that runs Core has mpv, so its outputs move to this Playback.
        const left = playback.outputs.map(output => output.deviceId);
        if (playback.renderer) send(playback.renderer, playerCommand({ type: "stop" }));
        assign(playback, [{ deviceId: hostId(), picture: true, sound: playback.outputs[0]?.sound ?? true }]);
        follow(left, hostId());
        mpvPlayback = playback;
      } else { mpv.send({ type: "stop" }); mpvPlayback = null; }
    }
    if (playback.synced) {
      playback.synced.send(command.type === "load" && playback.media?.playbackId === command.playbackId ? { ...command, ...playback.media } : command);
      // Screens follow the clock; only what they show reaches them.
      if (command.type === "load") show(playback);
      else if (command.type === "stop") hide(playback);
      else if (command.type === "addSubtitle" || command.type === "subtitleDelay" || command.type === "track" && command.kind === "subtitle") for (const tab of playback.screens.keys()) send(tab, playerCommand(command));
      return;
    }
    if (mpvPlayback !== playback && !playback.renderer) {
      if (command.type === "load") throw new Error(playback.outputs[0] ? `${nameOf(playback.outputs[0].deviceId)} is offline.` : "Send this to a Device to play it.");
      return; // The Playback waits for an output.
    }
    deliver(playback, command);
    if (command.type === "load") deliver(playback, { type: "volume", volume: levelOf(playback) });
  };
  // Devices join `playback` with these outputs. A Device that joins leaves the Playback it served,
  // which continues on its other outputs or pauses and waits (#644 Outputs).
  const assign = (playback: Playback, outputs: Output[]) => {
    for (const output of outputs) {
      const previous = servedBy(output.deviceId);
      if (previous && previous !== playback) { release(previous, output.deviceId); reconcile(previous); }
    }
    for (const output of playback.outputs) if (!outputs.some(item => item.deviceId === output.deviceId)) release(playback, output.deviceId, false);
    playback.outputs = outputs;
    // Solo hands everything to one Device, which plays it directly.
    if (playback.synced && !spans(playback)) { playback.synced.close(); playback.synced = undefined; hide(playback); }
    if (!playback.renderer && outputs[0]) playback.renderer = newest(outputs[0].deviceId) ?? null;
  };
  const release = (playback: Playback, deviceId: string, wait = true) => {
    playback.outputs = playback.outputs.filter(output => output.deviceId !== deviceId);
    if (mpvPlayback === playback && deviceId === hostId()) { mpv.send({ type: "stop" }); mpvPlayback = null; }
    if (playback.renderer && deviceOf(playback.renderer) === deviceId) {
      send(playback.renderer, playerCommand({ type: "stop" }));
      playback.renderer = null;
    }
    if (wait && !playback.outputs.length) playback.session.wait("Waiting for a Device.");
  };
  // The newest tab of an output Device plays (#644 Tabs); an output back online resumes, paused.
  // In a synced Playback the picture Devices' newest tabs show the picture.
  const handOver = (playback: Playback, socket: Socket<SocketData>) => {
    if (playback.synced) return show(playback);
    if (playback.renderer && playback.renderer !== socket && sockets.has(playback.renderer)) send(playback.renderer, playerCommand({ type: "stop" }));
    playback.renderer = socket;
    playback.session.reload();
  };
  // The clock a screen of this Playback follows: the source's timestamps for a live item.
  const followOf = (playback: Playback) => ({ group: playback.id, pts: !!playback.media?.live });
  // Synced picture (#644 ticket 11): each picture Device's newest tab shows the current item as
  // resolved for its own engine and origin, muted, following the group's clock. Nothing else moves.
  const show = (playback: Playback) => {
    const { player, queue, currentEntryId } = stateOf(playback);
    const loaded = playback.loaded?.playbackId === player.playbackId && active(player.status) ? playback.loaded : undefined;
    const pictured = !!loaded && !loaded.radio && !playback.media?.audioOnly;
    const wanted = new Set(playback.synced && pictured ? playback.outputs.flatMap(output => { const tab = output.picture && newest(output.deviceId); return tab ? [tab] : []; }) : []);
    for (const tab of playback.screens.keys()) if (!wanted.has(tab)) { playback.screens.delete(tab); if (sockets.has(tab)) send(tab, playerCommand({ type: "stop" })); }
    playback.synced?.screens([...wanted].map(deviceOf));
    const entry = queue.find(item => item.id === currentEntryId);
    if (!loaded || !entry) return;
    for (const tab of wanted) {
      if (playback.screens.get(tab) === loaded.playbackId) continue;
      playback.screens.set(tab, loaded.playbackId);
      void screenLoad(playback, entry, loaded, tab).then(command => {
        if (playback.screens.get(tab) !== loaded.playbackId || !sockets.has(tab)) return;
        send(tab, playerCommand(command));
        send(tab, playerCommand({ type: "volume", volume: 0 }));
      }, () => { if (playback.screens.get(tab) === loaded.playbackId) playback.screens.delete(tab); });
    }
  };
  const hide = (playback: Playback) => {
    for (const tab of playback.screens.keys()) if (sockets.has(tab)) send(tab, playerCommand({ type: "stop" }));
    playback.screens.clear();
  };
  const screenLoad = async (playback: Playback, entry: QueueEntry, loaded: NonNullable<Playback["loaded"]>, tab: Socket<SocketData>): Promise<PlaybackCommand> => {
    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(30_000)]);
    // A live link can expire within minutes, so a live screen resolves its own.
    const reuse = playback.resolved?.playbackId === loaded.playbackId && playback.resolved.vp9 === tab.data.vp9 && !playback.media?.live ? playback.resolved.media : undefined;
    const { headers = {}, ...media } = await (reuse ?? resolveEntry(entry, loaded.playbackId, signal, tab, playback));
    const fresh = await passThrough.prepare(loaded.playbackId, media, headers, { origin: tab.data.origin, userAgent: tab.data.userAgent }, signal);
    const { player } = stateOf(playback);
    return { ...loaded, source: fresh.source, audioSource: fresh.audioSource, mpegts: fresh.mpegts, eventStart: fresh.eventStart, startPosition: playback.media?.live ? undefined : player.position, paused: true, follow: followOf(playback) };
  };
  // The group reports the sound; a screen adds the subtitles it shows.
  const observeSynced = (playback: Playback) => {
    const { heard, seen } = playback;
    if (!heard) return;
    const picture = seen?.playbackId === heard.playbackId ? seen : undefined;
    playback.session.observe(picture ? { ...heard, tracks: [...picture.tracks?.filter(track => track.kind !== "audio") ?? [], ...heard.tracks ?? []], subtitleDelay: picture.subtitleDelay } : heard);
  };
  // Delivery follows from outputs (#644 Delivery): one Device plays directly; outputs that span
  // Devices are Synced, and the Playback's Sendspin group takes over its sound where it is.
  const reconcile = (playback: Playback) => {
    if (spans(playback)) {
      const fresh = !playback.synced;
      playback.synced ??= sendspin.group(playback.id, player => { playback.heard = player; observeSynced(playback); });
      playback.synced.members(members(playback));
      const { player } = stateOf(playback);
      if (fresh && playback.loaded?.playbackId === player.playbackId && active(player.status)) {
        // The Direct renderer keeps its picture, now muted and following the clock.
        const renderer = playback.renderer;
        if (renderer && playback.outputs.some(output => output.picture && output.deviceId === deviceOf(renderer))) {
          playback.screens.set(renderer, player.playbackId!);
          send(renderer, playerCommand({ type: "follow", playbackId: player.playbackId!, follow: followOf(playback) }));
          send(renderer, playerCommand({ type: "volume", volume: 0 }));
          playback.renderer = null;
        }
        const media = playback.media?.playbackId === player.playbackId ? playback.media : {};
        playback.synced.send({ ...playback.loaded, ...media, ...playback.loaded.radio || playback.media?.live ? {} : { startPosition: player.position }, paused: player.status === "paused",
          preferences: { ...playback.loaded.preferences!, ...player.speed ? { speed: player.speed } : {} } });
      }
      if (playback.renderer) { send(playback.renderer, playerCommand({ type: "stop" })); playback.renderer = null; }
      show(playback);
    } else if (playback.synced) {
      playback.synced.close();
      playback.synced = undefined;
      const device = playback.outputs[0]?.deviceId;
      const tab = device && newest(device);
      // A screen on the Device left plays on, with its sound; any other screen stops.
      const { playbackId } = stateOf(playback).player;
      const screen = [...playback.screens.keys()].find(item => deviceOf(item) === device && playback.screens.get(item) === playbackId);
      if (screen) playback.screens.delete(screen);
      show(playback);
      if (screen && playbackId && sockets.has(screen)) {
        playback.renderer = screen;
        send(screen, playerCommand({ type: "follow", playbackId, follow: null }));
        deliver(playback, { type: "volume", volume: levelOf(playback) });
      } else if (tab) handOver(playback, tab);
    }
    offline(playback);
  };
  // A Playback plays on while one of its outputs is online, and pauses and waits when none is,
  // however the last one left: its tab closed, or its Device moved to another Playback (#644 Offline).
  const offline = (playback: Playback, deviceId = playback.outputs[0]?.deviceId) => {
    if (!deviceId || mpvPlayback === playback || playback.outputs.some(output => newest(output.deviceId))) return;
    const { playbackId } = stateOf(playback).player;
    if (playback.synced && playbackId) playback.synced.send({ type: "pause", playbackId, paused: true });
    playback.session.wait(`${nameOf(deviceId)} is offline.`);
  };
  const createPlayback = (id: string = crypto.randomUUID()) => {
    const playback = { id, outputs: [], renderer: null, screens: new Map() } as unknown as Playback;
    playback.session = createSession({ ...store, ...store.playback(id) }, command => sendPlayer(playback, command), (state, clock) => publish(playback, state, clock), {
      systemAudio,
      invalidate: (...domains) => invalidate(...domains),
      resolveContinuation: (entry, signal) => continuation(entry, signal),
      ...(systemAudio ? { prepareAudio: () => soundRouting!.prepare() } : {}),
      resolveSource: async (entry, playbackId, signal) => {
        // Solo resolves for the Device it moves to: its engine and origin choose formats and Pass-through.
        const tab = playback.next ?? playback.renderer;
        const resolving = resolveEntry(entry, playbackId, signal, tab, playback);
        playback.resolved = { playbackId, vp9: tab?.data.vp9 ?? true, media: resolving };
        const { headers = {}, ...media } = await resolving;
        // Core's own FFmpeg reads the sound as resolved, before Pass-through, with its headers.
        const live = !!(entry.live || media.metadata?.live);
        playback.media = { playbackId, source: media.source, audioSource: media.audioSource, headers, live, audioOnly: media.audioOnly };
        // A live master's link can expire within minutes (RaiPlay: 403 after about 150 s) while its
        // renditions keep working, so the sound's rendition is picked now for a later Synced start.
        if (live && !media.radio) void audioRendition(media.audioSource ?? media.source, headers, signal).then(url => { if (playback.media?.playbackId === playbackId) playback.media.audioSource = url; }, () => {});
        return passThrough.prepare(playbackId, media, headers, tab?.data.origin ? { origin: tab.data.origin, userAgent: tab.data.userAgent } : null, signal);
      },
      observe: player => subtitles.observe(player),
      stopped: playbackId => subtitles.stopped(playbackId),
      moved: (from, to) => subtitles.moved(from, to),
    });
    playbacks.set(id, playback);
    return playback;
  };
  // Play starts media on the controlled Device (#644 Actions): in the Playback it serves, or in a
  // new one that takes its outputs.
  const own = (actor: PlaybackActor | undefined) => {
    const deviceId = controlled(actor?.deviceId ?? hostId());
    let playback = servedBy(deviceId);
    if (!playback || playback.outputs.length > 1) assign(playback = createPlayback(), [{ deviceId, picture: true, sound: true }]);
    return playback;
  };
  // Queue and control act on the looked-at Playback; with none, the controlled Device starts one.
  const viewed = (actor: PlaybackActor | undefined) => lookedAt(actor?.deviceId ?? hostId()) ?? own(actor);
  // Playing an item of a Playback with no online output plays it on the controlled Device.
  const present = (playback: Playback, actor: PlaybackActor | undefined) => {
    if (!playback.renderer && mpvPlayback !== playback) assign(playback, [{ deviceId: controlled(actor?.deviceId ?? hostId()), picture: true, sound: true }]);
    return playback;
  };
  // Solo (#644 Actions): the Device takes over the Playback's outputs, and the current item
  // continues there where it was.
  const sendTo = async (playback: Playback, output: Output, authorize: () => void) => {
    const tab = newest(output.deviceId);
    if (!tab) throw new Error(`${nameOf(output.deviceId)} is offline.`);
    if (mpvPlayback === playback) throw new Error(`This channel plays only on ${nameOf(hostId())}.`);
    if (playback.outputs.length === 1 && playback.outputs[0]!.deviceId === output.deviceId) return;
    playback.next = tab;
    playback.joining = output;
    try { await playback.session.move(() => { assign(playback, [output]); playback.renderer = tab; }, authorize); }
    finally { playback.next = undefined; playback.joining = undefined; }
    broadcast();
  };
  // Where it plays (#644 Actions): a Device's sound joins or leaves, and a screen's tile toggles
  // its picture. A speaker's delay is its own (Sendspin).
  const setOutput = async (playback: Playback, deviceId: string, change: { picture?: boolean; sound?: boolean; delay?: number }, authorize: () => void) => {
    if (change.delay !== undefined) sendspin.setDelay(deviceId, change.delay);
    if (change.picture === undefined && change.sound === undefined) return;
    // A change while the Device is still joining applies to the output it joins with.
    const joining = playback.joining?.deviceId === deviceId ? playback.joining : undefined;
    const current = playback.outputs.find(output => output.deviceId === deviceId) ?? joining;
    const next: Output = { deviceId, picture: change.picture ?? current?.picture ?? false, sound: change.sound ?? current?.sound ?? false };
    if (joining) { Object.assign(joining, next); return; }
    if (!current && !playback.outputs.length) {
      if (next.picture || next.sound) await sendTo(playback, next, authorize);
      return;
    }
    if (!current) {
      if (!next.picture && !next.sound) return;
      if (mpvPlayback === playback) throw new Error(`This channel plays only on ${nameOf(hostId())}.`);
      if (!newest(deviceId)) throw new Error(`${nameOf(deviceId)} is offline.`);
      // A Device serves one Playback, so it leaves the one it served (#644 Outputs).
      const previous = servedBy(deviceId);
      if (previous) { release(previous, deviceId); reconcile(previous); }
      playback.outputs = [...playback.outputs, next];
    } else if (!next.picture && !next.sound) release(playback, deviceId);
    else playback.outputs = playback.outputs.map(output => output === current ? next : output);
    // A screen that joins a synced Playback loads the picture for itself and follows the clock.
    reconcile(playback);
    if (!playback.synced && current && next.sound !== current.sound) deliver(playback, { type: "volume", volume: levelOf(playback) });
    broadcast();
  };
  // A Device's volume or mute reaches its player live, Direct or Synced.
  const setSound = async (deviceId: string, change: { volume?: number; muted?: boolean }, authorize: () => void) => {
    known(deviceId);
    if (systemAudio && deviceId === hostId()) {
      if (change.volume !== undefined) await soundRouting!.volume(change.volume, authorize);
      if (change.muted !== undefined) await soundRouting!.mute(change.muted, authorize);
      return;
    }
    store.saveDeviceSound(deviceId, change);
    const playback = servedBy(deviceId);
    if (playback?.synced) playback.synced.members(members(playback));
    else if (playback) deliver(playback, { type: "volume", volume: levelOf(playback) });
    broadcast();
  };
  // Several Devices move together: the loudest reaches `volume`, the others keep their proportion.
  const setVolume = async (deviceIds: string[], volume: number, authorize: () => void) => {
    const loudest = Math.max(0, ...deviceIds.map(id => soundOf(id).volume));
    const volumes = deviceIds.map(id => loudest ? Math.round(soundOf(id).volume * volume / loudest) : volume);
    for (const [index, id] of deviceIds.entries()) await setSound(id, { volume: volumes[index] }, authorize);
  };

  // What every window shares, whichever Playback it looks at.
  const common: Pick<SessionState, "versions" | "installationName" | "setupStep" | "appearance" | "administratorClaimed" | "activeProfile" | "preferences" | "systemAudio"> = {
    versions: {}, installationName: store.installationName(), setupStep: store.setupStep(),
    appearance: { size: store.tvInterfaceSize(), confirmedSize: store.tvInterfaceSize(), preview: null },
    administratorClaimed: store.administratorExists(), activeProfile: store.activeProfile(), preferences: store.playbackPreferences(store.activeProfile().id),
  };
  const idle = (): SessionState => ({ queue: [], currentEntryId: null, activeProfile: common.activeProfile, player: { playbackId: null, status: "idle", position: 0, duration: null, volume: 0, seekable: false, error: null } });
  // State goes out once per turn of the event loop: a hundred speakers leaving at once send one
  // state, not a hundred to every socket, which filled the 4 MB above and dropped every client (#644 ticket 10).
  let pending = false;
  const broadcast = () => { if (!pending) { pending = true; setImmediate(flush); } };
  const flush = () => {
    if (!pending) return;
    pending = false;
    if (closed || !sockets.size) return;
    const shared = {
      ...common,
      playbacks: all().map((playback): PlaybackSummary => {
        const state = stateOf(playback);
        const cursor = state.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId));
        return { id: playback.id, title: (state.queue.find(entry => entry.id === state.currentEntryId) ?? state.queue[cursor + 1])?.title ?? null, status: state.player.status, outputs: playback.outputs };
      }),
      devices: store.devices().map(device => ({ id: device.id, name: device.name, online: !!newest(device.id), updates: !!updateSocket(device.id), ...soundOf(device.id) })),
    };
    const views = new Map<string, string>();
    // A speaker's delay is its player's own; it shows once the speaker is connected.
    const delays = (outputs: Output[]) => outputs.map(output => { const delay = sendspin.delay(output.deviceId); return delay === undefined ? output : { ...output, delay }; });
    const hearing = new Set(all().flatMap(playback => playback.synced ? members(playback).map(member => member.deviceId) : []));
    for (const socket of sockets) {
      const playback = lookedAt(deviceOf(socket)), device = controlled(deviceOf(socket));
      // Volume keeps its saved level while muted, like each Device's mixer fader.
      const volume = Math.max(0, ...sounding(playback, device).map(id => soundOf(id).volume)), view = `${playback?.id}:${device}:${volume}`;
      if (!views.has(view)) { const state = playback ? stateOf(playback) : idle(); views.set(view, JSON.stringify({ type: "state", state: { ...state, ...shared, player: { ...state.player, volume }, controlling: device, playback: playback?.id ?? null, outputs: delays(playback?.outputs ?? []) } } satisfies ServerMessage)); }
      send(socket, views.get(view)!);
      // The newest tab of each synced speaker plays its sound over Sendspin; a screen follows its clock.
      const listen = hearing.has(deviceOf(socket)) && newest(deviceOf(socket)) === socket, watch = all().some(playback => playback.screens.has(socket));
      if (socket.data.sendspin !== `${listen}${watch}`) { socket.data.sendspin = `${listen}${watch}`; send(socket, JSON.stringify({ type: "sendspin", listen, watch } satisfies ServerMessage)); }
    }
  };
  const publish = (playback: Playback, state: SessionState, clock?: PlaybackClock) => {
    playback.state = state;
    if (playback === radioPlayback) radioProgramme?.observe(state);
    sound?.interrupt();
    if (!clock) { broadcast(); queueMicrotask(() => settle(playback)); return; }
    if (closed) return;
    const message = JSON.stringify({ type: "clock", ...clock } satisfies ServerMessage);
    for (const socket of sockets) if (lookedAt(deviceOf(socket)) === playback) send(socket, message);
  };
  // When the queue ends, the Playback ends (#644 End).
  const settle = (playback: Playback) => {
    if (playbacks.get(playback.id) !== playback) return;
    const state = stateOf(playback);
    const cursor = state.queue.findIndex(entry => entry.id === (state.currentEntryId ?? state.queueCursorEntryId));
    const done = state.currentEntryId === null || state.player.status === "ended" && !state.autoplay?.pending;
    if (!done || state.queue.length > cursor + 1) return;
    playbacks.delete(playback.id);
    for (const output of [...playback.outputs]) release(playback, output.deviceId, false);
    if (radioPlayback === playback) radioPlayback = null;
    playback.synced?.close();
    hide(playback);
    playback.session.close();
    try { store.forgetPlayback(playback.id); } catch { /* A stale row is dropped at the next start. */ }
    broadcast();
  };
  const invalidate = (...domains: Domain[]) => {
    if (closed) return;
    const versions = { ...common.versions };
    for (const domain of domains) versions[domain] = (versions[domain] ?? 0) + 1;
    common.versions = versions;
    if (domains.includes("devices")) {
      Object.assign(common, { installationName: store.installationName(), setupStep: store.setupStep(), administratorClaimed: store.administratorExists() });
      for (const playback of all()) playback.session.renamed();
    }
    broadcast();
  };
  // The watching profile and its preferences are the same in every Playback.
  const setViewing = (profile: WatchingProfile, reset = false) => {
    common.activeProfile = profile;
    common.preferences = store.playbackPreferences(profile.id);
    for (const playback of all()) playback.session.viewing(profile, common.preferences, reset);
  };
  const busy = (mediaId?: string) => all().some(playback => playback.session.busy(mediaId));
  const viewing: Viewing = {
    get state() { const views = all().map(stateOf); return { activeProfile: common.activeProfile, queue: views.flatMap(view => view.queue), currentEntryId: views.find(view => view.currentEntryId)?.currentEntryId ?? null }; },
    createProfile(name) { const profile = store.createProfile(name); invalidate("progress"); return profile; },
    renameProfile(id, name, expectedName) {
      const profile = store.renameProfile(id, name, expectedName);
      if (common.activeProfile.id === id) setViewing(profile);
      invalidate("progress");
      return profile;
    },
    namePerson(id, name, expectedName) {
      if (id !== common.activeProfile.id) throw new ViewingError("The active history changed on another device. Reopen Your name before saving.", 409);
      const profile = store.namePerson(id, name, expectedName);
      setViewing(profile);
      invalidate("progress");
      return profile;
    },
    removeProfile(id, expectedName) {
      if (busy()) throw new ViewingError("Stop playback before removing a watching profile. Pausing keeps the current profile.", 409);
      const active = common.activeProfile.id === id;
      const profile = store.removeProfile(id, expectedName);
      for (const playback of all()) playback.session.forgetProfile(id);
      if (active) setViewing(profile, true);
      invalidate("progress");
      return profile;
    },
    selectProfile(id) {
      if (busy()) throw new ViewingError("Stop playback before selecting another watching profile.", 409);
      for (const playback of all()) playback.session.finish();
      setViewing(store.selectProfile(id), true);
      invalidate("progress");
      return common.activeProfile;
    },
    editProgress(mediaId, changes, item) {
      if (changes.clearResume && busy(mediaId)) throw new ViewingError("Stop this item before clearing its resume position.", 409);
      store.editSharedProgress(common.activeProfile.id, mediaId, changes, item);
      for (const playback of all()) playback.session.forget(mediaId);
      invalidate("progress");
    },
    removeHistory(mediaId) {
      if (busy(mediaId)) throw new ViewingError("Stop this item before removing it from history.", 409);
      const removed = store.takeSharedProgress(mediaId);
      if (!removed.length) throw new ViewingError("History item not found.", 404);
      for (const playback of all()) playback.session.forget(mediaId);
      invalidate("progress");
      return removed;
    },
    restoreProgress(removed, expected = []) {
      if (removed[0] && busy(removed[0].mediaId)) throw new ViewingError("Stop this item before restoring its history.", 409);
      store.restoreSharedProgress(removed, expected);
      invalidate("progress");
    },
    loadQueue: (entries, mode, authorize, playedBy) => { (mode === "play" ? own(playedBy) : viewed(playedBy)).session.loadQueue(entries, mode, authorize, playedBy); },
    playHistory: (mediaId, fromStart, authorize, playedBy) => own(playedBy).session.playHistory(mediaId, fromStart, authorize, playedBy),
  };
  const mpv = createMpv(player => mpvPlayback?.session.observe(player));
  const passThrough = createPassThrough(playbackId => !!playing(playbackId));
  async function resolveEntry(entry: QueueEntry, playbackId: string, signal: AbortSignal, tab: Socket<SocketData> | null | undefined, playback: Playback): Promise<MediaSource & { headers?: Record<string, string> }> {
    if (entry.source.startsWith("web:")) return resolveWebMedia(entry.source.slice(4), signal, entry.quality, await streamingCommunityOrigin(entry.source.slice(4)), tab?.data.vp9 ?? true);
    if (entry.source.startsWith("iptv:")) return guide.getPlayable(entry.source.slice(5), signal);
    if (entry.source.startsWith("radio:")) {
      const station = radio.getPlayable(entry.source.slice(6));
      radioPlayback = playback;
      radioProgramme?.load(playbackId, entry.source, station.source);
      return { ...station, radio: true };
    }
    // Local files, the library and Jellyfin were removed; their saved entries stay readable but unplayable.
    if (!/^https?:/.test(entry.source)) throw new Error("This source is no longer supported. Remove it from the queue.");
    const live = await liveHls(entry.source, AbortSignal.any([signal, AbortSignal.timeout(5000)])).catch(() => false);
    return { source: entry.source, ...live ? { metadata: { live } } : {} };
  }
  const subtitles = createSubtitles(playbackId => playing(playbackId) && stateOf(playing(playbackId)!).player, (playbackId, subtitle) => playing(playbackId)?.session.addSubtitle(playbackId, subtitle));
  // Saved Playbacks come back idle, with no outputs, until a Device plays them.
  for (const id of store.playbackIds()) settle(createPlayback(id));
  const queueOf = (actor: PlaybackActor | undefined) => { const playback = lookedAt(actor?.deviceId ?? hostId()); return playback ? stateOf(playback) : idle(); };
  const playlists = createPlaylists({ databasePath: options.databasePath, onChange: () => invalidate("playlists"), queue: playedBy => queueOf(playedBy).queue,
    upNext: playedBy => {
      const { queue, currentEntryId, queueCursorEntryId } = queueOf(playedBy);
      const current = queue.findIndex(entry => entry.id === currentEntryId);
      const cursor = current >= 0 ? current : queue.findIndex(entry => entry.id === queueCursorEntryId);
      return queue.slice(cursor + 1);
    },
    loadQueue: (entries, mode, authorize, playedBy, title) => { (mode === "play" ? own(playedBy) : viewed(playedBy)).session.loadQueue(entries, mode, authorize, playedBy, undefined, title); },
    resolveSource: async source => {
      const page = await loadProviderList(source.provider, source.url, shutdown.signal);
      return { name: page.title ?? "Playlist", entries: providerListEntries(page) };
    } });
  const continuation = createContinuationResolver();
  const radio = createRadio({ databasePath: options.databasePath, onChange: () => invalidate("radio") });
  radioProgramme = createRadioProgramme({ station: radio.programmeStation, metadata: radio.metadata, publish: (playbackId, programme) => playing(playbackId)?.session.updateRadioProgramme(playbackId, programme) });
  const radioSettings = createRadioSettings(radio);
  const guide = createGuide({ databasePath: options.databasePath, onChange: () => invalidate("iptv"),
    onSourcesChanged: channelIds => {
      for (const playback of all()) {
        const state = stateOf(playback);
        const current = state.queue.find(entry => entry.id === state.currentEntryId);
        if (current && channelIds.some(id => current.source === `iptv:${id}`)) playback.session.command({ type: "stop" });
      }
    },
    enqueue: (channel, playNow, authorize, playedBy) => {
      const playback = playNow ? own(playedBy) : viewed(playedBy);
      const existing = stateOf(playback).queue.find(entry => entry.source === `iptv:${channel.id}`);
      if (existing) { if (playNow) playback.session.command({ type: "play", entryId: existing.id, fromStart: true }, authorize, playedBy); }
      else playback.session.command({ type: "enqueue", entry: { id: crypto.randomUUID(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow }, authorize, playedBy);
    },
  });
  const providers = createProviders({ databasePath: options.databasePath, onChange: () => invalidate("providers"), streamingCommunityOrigin: () => healStreamingCommunityOrigin(store) });
  const forLater = createForLater({
    webMetadata: (url, collection) => providerMetadata(providers.cachedItem(url, collection), !!collection),
    databasePath: options.databasePath, onChange: () => invalidate("for-later"),
    lookup: async reference => {
      const entry = holding(reference.id) && stateOf(holding(reference.id)!).queue.find(item => item.id === reference.id);
      if (!entry) throw new ControllerError("This item is no longer in the queue.", 404);
      return entry;
    },
    prepare: async entry => {
      if (entry.source.startsWith("radio:")) radio.getPlayable(entry.source.slice(6));
    },
    reservePlay: playedBy => own(playedBy).session.reservePlay(),
    enqueue: (entry, intent, authorize, playedBy) => {
      if (intent !== undefined) own(playedBy).session.playNewEntries([entry], { intent, authorize, playedBy });
      else viewed(playedBy).session.command({ type: "enqueue", entry }, authorize, playedBy);
    },
  });
  const devices = createDevices({ store, pairingCode, recoveryCode: options.adminRecoveryCode, onChange: device => {
    if (device?.role === "controller") void options.nativeBluetooth?.({ op: "cancel", owner: device.id }).catch(() => {});
    invalidate("devices");
  }, onRevoke: id => {
    void options.nativeBluetooth?.({ op: "cancel", owner: id }).catch(() => {});
    sendspin.drop(id);
    for (const [deviceId, target] of controlling) if (deviceId === id || target === id) controlling.delete(deviceId);
    for (const socket of sockets) if (socket.data.deviceId === id) {
      sockets.delete(socket);
      socket.close(4001, "This device was removed. Pair again.");
    }
  } });
  if (systemAudio) soundRouting = createSoundRouting({
    saved: store.audioOutput, savedProfile: store.audioProfile, save: store.saveAudioOutput,
    active: () => busy(),
    lost: error => servedBy(hostId())?.session.audioLost(error),
    changed: value => { common.systemAudio = value; for (const playback of all()) playback.session.updateSystemAudio(value); invalidate("sound"); },
  });
  const reconnectBluetooth = store.audioProfile()?.bluetoothAddress;
  if (systemAudio && reconnectBluetooth) void options.nativeBluetooth?.({ op: "reconnect", owner: "boot", device: reconnectBluetooth }).catch(() => {});
  sound = createSound({ routing: soundRouting, delay: { get: () => common.preferences!.device.audioDelay, set: delay => {
    store.saveAudioDelay(delay);
    common.preferences = store.playbackPreferences(common.activeProfile.id);
    for (const playback of all()) playback.session.saveAudioDelay(delay);
    broadcast();
  } }, available: systemAudio, idle: () => !closed && all().every(playback => stateOf(playback).player.status === "idle") });
  const appearance = createAppearance(store, value => { common.appearance = value; broadcast(); });
  const metadata = createProviderMetadata({ store, cachedItem: providers.cachedItem, onChange: () => invalidate("progress") });
  const catalog = createCatalog({ radio, viewing: { store, session: viewing, refreshHistory: metadata.refreshHistory } });
  let pairWindow = Date.now();
  let pairAttempts = 0;

  const allowed = (request: Request, requireOrigin: boolean): boolean => {
    if (options.managedLan && !loopbackPeer(requestPeer(request)) && (!store.remoteControlEnabled() || !lan?.network || !lanPeer(lan.network, requestPeer(request)))) return false;
    const host = request.headers.get("host");
    if (!host || !allowedHosts.has(host.toLowerCase())) return false;
    const origin = request.headers.get("origin");
    return origin === null ? !requireOrigin : allowedOrigins.has(origin);
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

  // null is the app window that runs this Couch.
  const playbackActor = (deviceId: string | null): PlaybackActor | undefined => {
    if (deviceId === null) return { deviceId: store.hostDevice()?.id ?? "host", name: store.installationName() };
    const device = store.device(deviceId);
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
      // Play starts on the controlled Device; Queue adds to the looked-at Playback (#644 ticket 9).
      const { session } = action.playNow ? own(playedBy) : viewed(playedBy);
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
          try { if (store.enrichHistorySource(mediaId, entry.source, details)) invalidate("progress"); } catch { /* Optional catalogue refresh must not prevent playback. */ }
        }
      }
      if ("entry" in prepared) {
        const { entry, inspectUrl } = prepared;
        if (action.type === "enqueueProvider" && action.collection) entry.collection = providers.cachedItem(action.url, action.collection)?.collection ?? action.collection;
        if (intent !== undefined) session.playNewEntries([entry], { intent, fromStart: prepared.fromStart, authorize, playedBy });
        else session.command({ type: "enqueue", entry, ...(action.placement ? { placement: action.placement } : {}) }, authorize, playedBy);
        if (entry.source.startsWith("web:")) {
          void metadata.load(entry.source.slice(4)).then(details => {
            if (!closed && Object.keys(details).length) { authorize(); holding(entry.id)?.session.enrichEntry(entry.id, entry.source, details, true); }
          }).catch(() => {});
        }
        if (inspectUrl) {
          const controller = new AbortController();
          inspections.set(entry.id, controller);
          void streamingCommunityOrigin(inspectUrl).then(origin => inspectWebMedia(inspectUrl, controller.signal, origin)).then(metadata => {
            if (!closed && !controller.signal.aborted) { authorize(); holding(entry.id)?.session.enrichEntry(entry.id, entry.source, metadata); }
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
      if (domains) invalidate(...domains);
    }
    return response;
  };

  // Whether this Couch plays anything, for the app and health checks.
  const status = () => all().map(playback => stateOf(playback).player.status).find(value => ["loading", "playing", "paused"].includes(value)) ?? "idle";
  const frontend = createFrontend();
  const routes: Record<string, (request: Request) => Response | Promise<Response>> = {
    "/api/health": request => allowed(request, false) ? json({ ok: true, player: status() }) : json({ error: "Unrecognized host or origin." }, 403),
    "/api/connection": request => allowed(request, false) ? cors(request, json({ name: store.installationName(), installationId: store.installationId(), urls: connectionUrls, player: status(), remoteControlEnabled: store.remoteControlEnabled(), ...(options.managedLan ? { lanError } : {}), tvPresentation: process.env.COUCH_TV_PRESENTATION === "1", systemAudio, updates: !!options.nativeUpdates })) : json({ error: "Unrecognized host or origin." }, 403),
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
        const token = store.pair("id" in body ? body.id : undefined, "name" in body ? body.name : undefined);
        invalidate("devices");
        return respond({ token, device: store.deviceForToken(token), installationId: store.installationId() });
      } catch (error) {
        return respond({ error: error instanceof ControllerError ? error.message : STORAGE_ERROR("this device") }, error instanceof ControllerError ? error.status : 500);
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
    const identity = (): DeviceIdentity | null => {
      if (closed) return null;
      if (trusted) return { device: store.hostDevice(), authority: "host", claimAvailable: devices.claimAvailable() };
      if (!store.remoteControlEnabled()) return null;
      const device = store.deviceForToken(token);
      return device ? { device, authority: device.role, claimAvailable: devices.claimAvailable() } : null;
    };
    // Each connection presents its Sendspin key, the Device's one ID (#644 ticket 5).
    if (websocket && store.identify(trusted ? null : token, url.searchParams.get("device"))) invalidate("devices");
    const caller = identity();
    if (!caller) return cors(request, json({ error: "Pair this device first." }, 401));
    if (url.pathname === "/api/settings/sharing") {
      if (request.method === "GET") return cors(request, json({ enabled: store.remoteControlEnabled() }));
      if (request.method !== "POST") return cors(request, new Response(null, { status: 405, headers: { Allow: "GET, POST" } }));
      if (!trusted) return cors(request, json({ error: `Change this on ${store.installationName()}.` }, 403));
      try {
        const enabled = await settingField(request, "enabled");
        if (typeof enabled !== "boolean") throw new ControllerError("Choose whether to share on the network.");
        await lan?.setEnabled(enabled);
        store.saveRemoteControlEnabled(enabled);
        if (!enabled) for (const socket of sockets) if (!socket.data.trusted) {
          sockets.delete(socket);
          socket.close(4003, "Sharing is off. Your pairing is remembered.");
        }
        invalidate("devices");
        return cors(request, json({ enabled }));
      } catch (error) { return cors(request, json({ error: error instanceof Error ? error.message : "Couldn't save Share on network." }, error instanceof ControllerError ? error.status : 500)); }
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
        const previousAlias = previous ? secureOrigin(originDomainUrl(previous, port, !previous.startsWith("http://")), port) : "";
        store.saveOriginDomain(alias);
        // Keep only the address used by this administrator until Couch restarts.
        // Its browser can finish the save and continue using its paired session.
        const usingPreviousAlias = previousAlias && (request.headers.get("host")?.toLowerCase() === new URL(previousAlias).host || request.headers.get("origin") === previousAlias);
        if (usingPreviousAlias && previousAlias !== (alias && secureOrigin(alias, port))) retainedOrigins.add(previousAlias);
        await lan?.refresh().catch(() => {});
        return cors(request, json({ domain: alias }));
      } catch (error) { return cors(request, json({ error: error instanceof ControllerError ? error.message : "Couldn't save the network address." }, error instanceof ControllerError ? error.status : 500)); }
    }
    if (url.pathname === "/api/build" && request.method === "GET") return cors(request, json(buildInfo));
    if (url.pathname === "/api/devices/me" && request.method === "GET") return cors(request, await devices.handle(request, identity));
    {
      const playedBy = playbackActor(trusted ? null : caller.device!.id);
      const currentIdentity = identity;
      const authorize = () => {
        if (!identity()) throw new ControllerError("This device was removed. Pair again.", 401);
      };
      if (websocket && buildInfo.packaged && buildKey(buildInfo) !== url.searchParams.get("build")) return cors(request, json({ error: VERSION_MISMATCH }, 409));
      if (!trusted) store.touchDevice(caller.device!.id);
      if (!websocket && url.pathname === "/api/settings/streamingcommunity") return cors(request, await streamingCommunitySettings.handle(request, currentIdentity));
      if (!websocket && url.pathname === "/api/settings/startup") return cors(request, await startup.handle(request, currentIdentity));
      if (!websocket && /^\/api\/bluetooth(?:\/|$)/.test(url.pathname)) return cors(request, await bluetoothSettings(request, currentIdentity, options.nativeBluetooth));
      if (!websocket && /^\/api\/sound(?:\/|$)/.test(url.pathname)) return cors(request, await sound!.handle(request, currentIdentity));
      if (!websocket && /^\/api\/display(?:\/|$)/.test(url.pathname)) return cors(request, await displaySettings(request, currentIdentity, options.nativeDisplay));
      if (!websocket && /^\/api\/updates(?:\/|$)/.test(url.pathname)) return cors(request, await updateSettings(request, currentIdentity, invokeUpdate, updateTargets));
      if (!websocket && /^\/api\/appearance(?:\/|$)/.test(url.pathname)) return cors(request, await appearance.handle(request, currentIdentity));
      if (!websocket && /^\/api\/iptv(?:\/|$)/.test(url.pathname)) return cors(request, await guide.handle(request, currentIdentity, playedBy));
      if (!websocket && (/^\/api\/devices(?:\/|$)/.test(url.pathname) || (url.pathname === "/api/settings" || url.pathname === "/api/settings/setup"))) return cors(request, await devices.handle(request, currentIdentity));
      if (!websocket && /^\/api\/radio\/(?:avoid(?:\/programmes)?|sources|playlists(?:\/[\w-]{1,80}(?:\/refresh)?)?)$/.test(url.pathname)) return cors(request, await radioSettings.handle(request, currentIdentity));
      if (!websocket && /^\/api\/for-later(?:\/|$)/.test(url.pathname)) return cors(request, await forLater.handle(request, authorize, playedBy));
      if (!websocket) return cors(request, await (url.pathname === "/api/subtitles" ? subtitles.handle(request, authorize) : /^\/api\/playlists(?:\/|$)/.test(url.pathname) ? playlists.handle(request, authorize, playedBy) : url.pathname.startsWith("/api/providers/") ? providers.handle(request, authorize) : catalog.handle(request, trusted, authorize, playedBy)));
      return upgrade({ trusted, deviceId: trusted ? null : caller.device!.id, vp9: url.searchParams.get("vp9") === "1", updates: url.searchParams.get("updates") === "1", tv: url.searchParams.get("tv") === "1", origin: request.headers.get("origin") ?? "", userAgent: request.headers.get("user-agent") ?? "", authorize, window: Date.now(), count: 0 }) ? undefined : json({ error: "WebSocket upgrade required." }, 400);
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
      // Sendspin (#644 ticket 10): the Noise handshake admits only this Couch's Devices.
      if (pathname === "/sendspin") return !allowed(request, false) ? json({ error: "Unrecognized host or origin." }, 403) : upgrade(sendspin.accept) ? undefined : json({ error: "WebSocket upgrade required." }, 426);
      if (request.method === "GET" && /^\/api\/subtitles\/[\w-]+\.vtt$/.test(pathname)) return subtitles.serve(pathname);
      if (request.method === "GET" && pathname.startsWith("/api/relay/")) return allowed(request, false) ? passThrough.serve(request) : new Response(null, { status: 403 });
      const page = ["GET", "HEAD"].includes(request.method) && !pathname.startsWith("/api/") ? await frontend(pathname) : null;
      return page ?? api(request, upgrade);
    },
    websocket: {
      maxPayload: 8192,
      open(socket: Socket<SocketData>) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this device again."); return; }
        sockets.add(socket);
        if (socket.data.updates && !socket.data.trusted) clientUpdates.set(socket, createNativeUpdates((requestId, action) => { send(socket, JSON.stringify({ type: "updates", requestId, action } satisfies ServerMessage)); }));
        // The newest tab renders for its Device (#644 Tabs); an output back online resumes, paused.
        const playback = servedBy(deviceOf(socket));
        if (playback && mpvPlayback !== playback) handOver(playback, socket);
        broadcast();
      },
      close(socket: Socket<SocketData>) {
        sockets.delete(socket);
        clientUpdates.get(socket)?.close();
        clientUpdates.delete(socket);
        for (const playback of all()) if (playback.renderer === socket) {
          const tab = newest(deviceOf(socket));
          if (tab) handOver(playback, tab);
          else playback.renderer = null;
        } else if (playback.screens.delete(socket)) show(playback);
        for (const playback of all()) if (playback.outputs.some(output => output.deviceId === deviceOf(socket))) offline(playback, deviceOf(socket));
        broadcast();
        if (socket.data.deviceId) void options.nativeBluetooth?.({ op: "cancel", owner: socket.data.deviceId }).catch(() => {});
      },
      async message(socket: Socket<SocketData>, message: string | null) {
        try { socket.data.authorize(); } catch { socket.close(4001, "Pair this device again."); return; }
        if (socket.data.deviceId) store.touchDevice(socket.data.deviceId);
        if (Date.now() - socket.data.window >= 1000) { socket.data.window = Date.now(); socket.data.count = 0; }
        if (++socket.data.count > 60) { socket.close(1008, "Too many commands."); return; }
        if (message === null) { socket.close(1003, "JSON text messages required."); return; }
        if (clientUpdates.has(socket)) {
          try {
            const reply = JSON.parse(message);
            if (reply?.type === "updates") { clientUpdates.get(socket)!.receive(reply); return; }
          } catch { /* The normal command parser rejects invalid JSON. */ }
        }
        const player = parsePlayer(message);
        if (player) {
          const playback = all().find(item => item.renderer === socket || item.screens.has(socket));
          if (playback?.synced) { playback.seen = player; observeSynced(playback); }
          else if (playback && mpvPlayback !== playback) playback.session.observe(player);
          return;
        }
        let command;
        try { command = parseCommand(message); } catch {
          socket.close(1008, "Invalid command or unsupported media source.");
          return;
        }
        let result: ServerMessage = { type: "result", requestId: command.requestId, ok: true };
        const existing = new Set(playbacks.keys());
        try {
          const playedBy = playbackActor(socket.data.deviceId);
          const deviceId = deviceOf(socket);
          const authorize = socket.data.authorize;
          const action = command.action;
          let playback: Playback | undefined;
          let removed: string | undefined;
          // Play on a Device: this window controls it from now on.
          if ((action.type === "enqueue" || action.type === "enqueueProvider" || action.type === "enqueueRadio" || action.type === "enqueueWeb") && action.deviceId) { known(action.deviceId); control(deviceId, action.deviceId); }
          const enqueued = enqueueMedia(action, authorize, playedBy);
          if (enqueued) {
            await enqueued;
            if (closed) return;
            playback = lookedAt(deviceId);
          } else if (action.type === "navigate") {
            const hosts = [...sockets].filter(socket => socket.data.trusted);
            if (!hosts.length) throw new Error("The TV interface is disconnected. Try again when it reconnects.");
            const navigation = JSON.stringify({ type: "navigation", key: action.key } satisfies ServerMessage);
            for (const host of hosts) send(host, navigation);
          } else if (action.type === "control") {
            // Controlling keeps outputs as they are; an idle Device can be controlled too.
            known(action.deviceId);
            control(deviceId, action.deviceId);
            broadcast();
          } else if (action.type === "solo" || action.type === "allSpeakers" || action.type === "output") {
            const target = lookedAt(deviceId);
            if (!target) throw new Error("Play something first.");
            if (action.type === "solo") {
              // Only this Device keeps the Playback: its picture, when it shows one, and its sound.
              known(action.deviceId);
              const output = { deviceId: action.deviceId, picture: !target.outputs.length || target.outputs.some(output => output.picture), sound: true };
              const left = target.outputs.map(item => item.deviceId).filter(id => id !== action.deviceId);
              if (target.outputs.length && !left.length) await setOutput(target, action.deviceId, output, authorize);
              else await sendTo(target, output, authorize);
              follow(left, action.deviceId);
              broadcast();
            } else if (action.type === "allSpeakers") {
              // Every online Device joins its sound; a busy one leaves what it played.
              for (const id of new Set([...sockets].map(deviceOf))) if (!target.outputs.some(output => output.deviceId === id && output.sound)) await setOutput(target, id, { sound: true }, authorize);
            } else {
              // The fader: 0 takes the Device's sound out and keeps its volume; more sets the volume and puts its sound in.
              if (action.level) await setSound(action.deviceId, { volume: action.level }, authorize);
              await setOutput(target, action.deviceId, { picture: action.picture, sound: action.level === undefined ? undefined : action.level > 0, delay: action.delay }, authorize);
            }
          } else if (action.type === "volume" || action.type === "mute") {
            const targets = action.deviceId ? [action.deviceId] : sounding(lookedAt(deviceId), controlled(deviceId));
            if (action.type === "volume") await setVolume(targets, action.volume, authorize);
            else for (const id of targets) await setSound(id, { muted: action.muted }, authorize);
          } else {
            // Transport commands name their player and queue commands their entry; the rest act on
            // the looked-at Playback, and Play now on the controlled Device's.
            playback = "playbackId" in action && action.playbackId ? playing(action.playbackId) : "entryId" in action ? holding(action.entryId) : undefined;
            playback ??= action.type === "enqueue" && action.playNow ? own(playedBy) : viewed(playedBy);
            if (action.type === "play") present(playback, playedBy);
            if (action.type === "remove") {
              inspections.get(action.entryId)?.abort();
              removed = stateOf(playback).queue.find(entry => entry.id === action.entryId)?.title;
            }
            if (soundRouting && action.type === "pause" && !action.paused) soundRouting.prepare();
            await playback.session.command(action, authorize, playedBy);
            if (action.type === "preferences" || action.type === "savePlaybackDefault" || action.type === "audioDelay") setViewing(common.activeProfile);
          }
          if (playedBy && playback && playbacks.has(playback.id)) {
            const titleOf = (entryId: string) => stateOf(playback!).queue.find(entry => entry.id === entryId)?.title;
            const label = action.type === "pause" ? action.paused ? "paused" : "resumed"
              : action.type === "stop" ? "stopped playback"
              : action.type === "remove" ? `removed ${removed || "an item"}`
              : action.type === "enqueue" ? `queued ${action.entry.title}`
              : action.type === "enqueueProvider" || action.type === "enqueueWeb" ? `queued ${action.title || "media"}`
              : action.type === "enqueueRadio" ? `queued ${titleOf(action.entryId) || "media"}`
              : action.type === "play" ? `played ${titleOf(action.entryId) || "media"}` : null;
            if (label) playback.session.notice(playedBy, `${playedBy.name} ${label}`);
          }
        } catch (error) {
          result = { ...result, ok: false, error: error instanceof Error ? error.message : "The command failed." };
        } finally {
          // A Playback started for a command that failed ends with it.
          for (const playback of all()) if (!existing.has(playback.id)) settle(playback);
        }
        send(socket, JSON.stringify(result));
      },
    },
  };
  const server = await serve({ ...serveOptions, tls: await tls() });

  const port = server.port;
  const origin = urlFor(hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname, port);
  // The app window loads Core from localhost (#644: Twitch rejects Origin 127.0.0.1).
  const local = [origin, urlFor("localhost", port)];
  const secureAdvertised = advertised.map(url => secureOrigin(url, port));
  const allowedHosts = new Set(options.managedLan ? local.map(url => new URL(url).host) : [...addresses].map(address => new URL(urlFor(address, port)).host).concat(secureAdvertised.map(url => new URL(url).host)));
  const allowedOrigins = new Set(options.managedLan ? local : [...addresses].map(address => new URL(urlFor(address, port)).origin).concat(secureAdvertised));
  const urls: string[] = secureAdvertised.length ? [...new Set(secureAdvertised)] : hostname === "0.0.0.0" || hostname === "::"
    ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port))
    : [origin];
  if (urls.length === 0) urls.push(origin);
  const connectionUrls: string[] = [...new Set([...urls, ...(hostname === "0.0.0.0" || hostname === "::" ? [...lanAddresses].filter(address => hostname === "::" || !address.includes(":")).map(address => urlFor(address, port)) : [origin])])];
  const retainedOrigins = new Set<string>();

  if (options.managedLan) {
    lan = createLanListener({
      port, enabled: store.remoteControlEnabled(), selected: process.env.COUCH_LAN_INTERFACE, address: process.env.COUCH_LAN_ADDRESS,
      advertised: () => [...(store.originDomain() ? [originDomainUrl(store.originDomain(), port, !store.originDomain().startsWith("http://"))] : []), ...retainedOrigins, ...options.advertisedUrls ?? []],
      start: async (network, listenPort) => serve({ ...serveOptions, hostname: network.address, port: listenPort, tls: { ...await tls(), securePort: port } }),
      changed: (next, error) => {
        lanError = error;
        const current = store.originDomain();
        const currentAlias = current ? secureOrigin(originDomainUrl(current, port, !current.startsWith("http://")), port) : "";
        const published = next.filter(url => !retainedOrigins.has(url) || url === currentAlias || options.advertisedUrls?.some(value => { try { return secureOrigin(value, port) === url; } catch { return false; } }));
        urls.splice(0, urls.length, ...published);
        connectionUrls.splice(0, connectionUrls.length, ...published);
        allowedHosts.clear(); allowedOrigins.clear();
        for (const url of [...local, ...next]) { allowedHosts.add(new URL(url).host); allowedOrigins.add(new URL(url).origin); }
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
    for (const playback of all()) try { playback.session.close(); } catch (error) { progressError ??= error; }
    sound?.close();
    soundRouting?.close();
    mpv.close();
    for (const playback of all()) playback.synced?.close();
    sendspin.close();
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

  return { server, pairingCode, urls, origin, close };
}
