import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../shared/protocol";
import type { RadioPlaylist, RadioStation } from "../shared/radio";
import { createHub, type Hub } from "./hub";
import * as foldersModule from "./media-folders";
import * as libraryModule from "./library";
import * as bandcampModule from "./providers/bandcamp";
import * as webMediaModule from "./web-media";
import type { ProviderPage } from "../shared/providers";

const hostToken = "private-host-token-for-integration-tests-123456789";
const roots: string[] = [];
const hubs: Hub[] = [];
const peers: Peer[] = [];
const catalogGates: Array<() => void> = [];
const upstreams: Array<{ stop(closeActiveConnections?: boolean): Promise<void> }> = [];
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
// The shared DOM tsconfig hides Bun's extra client constructor overload.
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };

const bandcampAlbum: ProviderPage = { title: "Album", items: ["first", "second"].map(title => ({ id: title, title, provider: "bandcamp", kind: "media", url: `https://artist.bandcamp.com/track/${title}`, thumbnail: "https://f4.bcbits.com/img/a123_10.jpg" })) };

test("Bandcamp albums append once in order, play through the host resolver and persist public metadata", async () => {
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockResolvedValue(bandcampAlbum);
  const resolve = spyOn(webMediaModule, "resolveWebMedia").mockResolvedValue({ source: "https://private-stream.example/signed", headers: { Authorization: "private-stream-token" } });
  try {
    const initial = fixture();
    initial.hub.session.observe(idle);
    const token = await pair(initial.hub);
    const first = new Peer(initial.hub, token), second = new Peer(initial.hub, await pair(initial.hub));
    await Promise.all([first.ready(), second.ready()]);
    expect(await first.command({ type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://artist.bandcamp.com/album/album", playNow: true })).toMatchObject({ ok: true });
    const load = await initial.waitForCommand(command => command.type === "load");
    expect(load).toMatchObject({ source: "https://private-stream.example/signed", headers: { Authorization: "private-stream-token" } });
    await second.waitFor(message => message.type === "state" && message.state.currentEntryId === message.state.queue[0]?.id);
    expect(second.state.queue.map(item => item.title)).toEqual(["first", "second"]);
    expect(first.messages.filter(message => message.type === "state").every(message => message.type !== "state" || message.state.queue.length !== 1)).toBe(true);
    expect(second.state.queue.every(item => item.source.startsWith("web:https://artist.bandcamp.com/track/") && !!item.thumbnail && !item.quality)).toBe(true);
    expect(JSON.stringify(second.messages)).not.toContain("private-stream");
    const queue = second.state.queue;
    await Promise.all([first.close(), second.close()]);
    await initial.hub.close();
    hubs.splice(hubs.indexOf(initial.hub), 1);
    const restarted = fixture(initial.databasePath);
    const remote = new Peer(restarted.hub, token);
    await remote.ready();
    expect(remote.state.queue).toEqual(queue);
    expect(remote.state.currentEntryId).toBeNull();
    expect(restarted.commands).toEqual([]);
  } finally { album.mockRestore(); resolve.mockRestore(); }
});

test("Bandcamp album failure or insufficient capacity leaves the queue unchanged", async () => {
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockResolvedValue(bandcampAlbum);
  try {
    const { hub } = fixture();
    hub.session.loadQueue(Array.from({ length: 499 }, () => ({ id: "existing", title: "Existing", source: "https://media.example/existing" })), "append");
    const remote = new Peer(hub, await pair(hub));
    await remote.ready();
    const queue = remote.state.queue;
    const action = { type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://artist.bandcamp.com/album/album" } as const;
    expect(await remote.command(action)).toMatchObject({ ok: false, error: expect.stringContaining("500") });
    expect(remote.state.queue).toEqual(queue);
    album.mockRejectedValueOnce(new Error("This album is unavailable."));
    expect(await remote.command(action)).toMatchObject({ ok: false, error: "This album is unavailable." });
    expect(remote.state.queue).toEqual(queue);
  } finally { album.mockRestore(); }
});

for (const replacement of ["stop", "play"] as const) test(`a newer ${replacement} cancels slow Bandcamp album play intent`, async () => {
  const started = Promise.withResolvers<void>();
  const output = Promise.withResolvers<ProviderPage>();
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockImplementation(async () => { started.resolve(); return output.promise; });
  try {
    const { hub, commands } = fixture();
    hub.session.observe(idle);
    hub.session.command({ type: "enqueue", entry: { id: "replacement", title: "Replacement", source: "https://media.example/replacement" } });
    const first = new Peer(hub, await pair(hub)), second = new Peer(hub, await pair(hub));
    await Promise.all([first.ready(), second.ready()]);
    const pending = first.command({ type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://artist.bandcamp.com/album/album", playNow: true });
    await started.promise;
    expect(await second.command(replacement === "stop" ? { type: "stop" } : { type: "play", entryId: "replacement" })).toMatchObject({ ok: true });
    output.resolve(bandcampAlbum);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining("canceled by a newer control") });
    expect(hub.session.state.queue.map(item => item.title)).toEqual(["Replacement", "first", "second"]);
    expect(commands.filter(command => command.type === "load")).toHaveLength(replacement === "stop" ? 0 : 1);
    expect(hub.session.state.currentEntryId).toBe(replacement === "stop" ? null : "replacement");
  } finally { output.resolve(bandcampAlbum); album.mockRestore(); }
});

test("hub shutdown aborts pending Bandcamp extraction before a queue change", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const finished = Promise.withResolvers<void>();
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockImplementation(async (_, signal) => {
    started.resolve(signal!);
    await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
    finished.resolve();
    return bandcampAlbum;
  });
  try {
    const { hub } = fixture();
    const remote = new Peer(hub, await pair(hub));
    await remote.ready();
    remote.socket.send(JSON.stringify({ type: "command", requestId: "shutdown-album", action: { type: "enqueueProviderAlbum", provider: "bandcamp", url: "https://artist.bandcamp.com/album/album" } }));
    const signal = await started.promise;
    await hub.close();
    await finished.promise;
    expect(signal.aborted).toBe(true);
    expect(hub.session.state.queue).toEqual([]);
  } finally { album.mockRestore(); }
});

function fixture(databasePath?: string, advertisedUrls?: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "couch-test-"));
  roots.push(directory);
  const commands: PlaybackCommand[] = [];
  const listeners = new Set<() => void>();
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: databasePath ?? join(directory, "state.sqlite"), pairingCode: "123456", hostToken, advertisedUrls, sendPlayer: command => { commands.push(command); for (const listener of listeners) listener(); } });
  hubs.push(hub);
  const waitForCommand = (predicate: (command: PlaybackCommand) => boolean) => new Promise<PlaybackCommand>((resolve, reject) => {
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error("Timed out waiting for native command.")); }, 2000);
    const check = () => {
      const command = commands.findLast(predicate);
      if (command) { clearTimeout(timeout); listeners.delete(check); resolve(command); }
    };
    listeners.add(check);
    check();
  });
  return { hub, commands, waitForCommand, databasePath: databasePath ?? join(directory, "state.sqlite") };
}

async function pair(hub: Hub) {
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}

test("a claimed phone names the TV for every controller and retains its authority after restart", async () => {
  const initial = fixture();
  const ownerToken = await pair(initial.hub), guestToken = await pair(initial.hub);
  const first = new Peer(initial.hub, ownerToken), second = new Peer(initial.hub, guestToken);
  await Promise.all([first.ready(), second.ready()]);
  const api = (hub: Hub, token: string, path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, {
    method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const originalProfile = first.state.activeProfile;
  expect(first.state).toMatchObject({ installationName: "Couch", administratorClaimed: false });
  expect((await api(initial.hub, guestToken, "/api/controllers/claim-code")).status).toBe(403);
  expect((await api(initial.hub, guestToken, "/api/settings", "POST", { name: "Unapproved TV" })).status).toBe(403);
  const codeResponse = await api(initial.hub, hostToken, "/api/controllers/claim-code");
  expect(codeResponse.status).toBe(200);
  const { code } = await codeResponse.json() as { code: string };
  expect(code).toMatch(/^\d{10}$/);
  expect((await api(initial.hub, ownerToken, "/api/controllers/claim", "POST", { code })).status).toBe(200);
  await second.waitFor(message => message.type === "state" && message.state.administratorClaimed === true);
  expect((await api(initial.hub, guestToken, "/api/controllers/claim", "POST", { code })).ok).toBe(false);
  expect((await api(initial.hub, hostToken, "/api/controllers/claim-code")).status).toBe(409);
  expect((await api(initial.hub, ownerToken, "/api/settings", "POST", { name: "Living room" })).status).toBe(200);
  await second.waitFor(message => message.type === "state" && message.state.installationName === "Living room");
  expect(second.state.activeProfile).toEqual(originalProfile);
  expect(second.state.queue).toEqual([]);
  expect(initial.commands).toEqual([]);
  expect(JSON.stringify(second.messages)).not.toContain(code);
  expect(JSON.stringify(second.messages)).not.toContain(hostToken);
  const ownerIdentity = await (await api(initial.hub, ownerToken, "/api/controllers/me")).json();
  expect(ownerIdentity).toMatchObject({ authority: "administrator", controller: { role: "administrator" }, claimAvailable: false });
  await Promise.all([first.close(), second.close()]);
  await initial.hub.close();
  hubs.splice(hubs.indexOf(initial.hub), 1);
  const restarted = fixture(initial.databasePath);
  const remote = new Peer(restarted.hub, guestToken);
  await remote.ready();
  expect(remote.state).toMatchObject({ installationName: "Living room", administratorClaimed: true, currentEntryId: null });
  expect(await (await api(restarted.hub, ownerToken, "/api/controllers/me")).json()).toMatchObject({ controller: ownerIdentity.controller, authority: "administrator" });
  expect((await api(restarted.hub, guestToken, "/api/settings", "POST", { name: "Unauthorized" })).status).toBe(403);
  expect(restarted.commands).toEqual([]);
});

test("named pairing keeps caller-supplied roles ordinary and rejects invalid names before saving", async () => {
  const { hub } = fixture();
  const request = (name: unknown) => fetch(`${hub.origin}/api/pair`, {
    method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: hub.pairingCode, name, role: "administrator" }),
  });
  expect((await request("\n")).status).toBe(400);
  const response = await request("  Kitchen phone  ");
  expect(response.status).toBe(200);
  const paired = await response.json() as { token: string; controller: { name: string; role: string } };
  expect(paired.controller).toMatchObject({ name: "Kitchen phone", role: "controller" });
  expect(JSON.stringify(paired.controller)).not.toContain(paired.token);
  expect(JSON.stringify(paired.controller)).not.toContain("token_hash");
  expect(hub.session.state.administratorClaimed).toBe(false);
});

test("only authenticated controllers upload subtitle bytes, and native observations remain authoritative", async () => {
  const { hub, commands } = fixture();
  hub.session.observe(idle);
  hub.session.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: "https://media.example/movie" } });
  hub.session.command({ type: "play", entryId: "movie" });
  const playbackId = hub.session.state.player.playbackId!;
  hub.session.observe({ ...idle, playbackId, status: "paused" });
  const token = await pair(hub);
  const remote = new Peer(hub, token);
  await remote.ready();
  const upload = (credential: string, name = "phone.srt", id = playbackId) => fetch(`${hub.origin}/api/subtitles?name=${encodeURIComponent(name)}&playbackId=${id}`, {
    method: "POST", headers: { Origin: hub.origin, Authorization: `Bearer ${credential}`, "Content-Type": "application/octet-stream" },
    body: "1\n00:00:00,000 --> 00:00:20,000\nPhone captions\n",
  });
  expect((await upload("unpaired")).status).toBe(401);
  expect((await upload(token, "/etc/private.srt")).status).toBe(400);
  expect((await upload(token)).status).toBe(200);
  const attachment = commands.at(-1)!;
  expect(attachment.type).toBe("addSubtitle");
  expect(JSON.stringify(remote.state)).not.toContain("couch-subtitles-");
  expect(remote.state.player.tracks).toBeUndefined();
  hub.session.observe({ ...idle, playbackId, status: "paused", tracks: [{ id: "sub", index: 3, kind: "subtitle", label: "phone.srt", language: "", selected: true }] });
  await remote.waitFor(message => message.type === "state" && !!message.state.player.tracks?.some(track => track.label === "phone.srt" && track.selected));
  hub.session.command({ type: "stop" });
  expect((await upload(token)).status).toBe(409);
  hub.session.observe(idle);
  if (attachment.type === "addSubtitle") expect(await Bun.file(attachment.source).exists()).toBe(false);
});

test("legacy radio favorites gain radio policy while observed track text leaves station identity intact", async () => {
  const { hub, commands } = fixture();
  hub.session.observe(idle);
  const token = await pair(hub);
  const remote = new Peer(hub, token);
  await remote.ready();
  const station = { id: crypto.randomUUID(), name: "Household station", url: "https://radio.example/stream", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
  expect((await fetch(`${hub.origin}/api/radio/favorites`, { method: "POST", headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ station }) })).ok).toBe(true);
  await remote.command({ type: "enqueue", entry: { id: "legacy-radio", title: station.name, source: station.url } });
  await remote.command({ type: "play", entryId: "legacy-radio" });
  const load = commands.findLast(command => command.type === "load")!;
  expect(load).toMatchObject({ type: "load", radio: true, source: station.url });
  expect(hub.session.state.queue[0]).toMatchObject({ id: "legacy-radio", title: station.name, kind: "radio" });
  if (load.type !== "load") throw new Error("Expected native radio load");
  hub.session.observe({ ...idle, playbackId: load.playbackId, status: "playing", nowPlaying: { title: "Artist - Current track" } });
  await remote.waitFor(message => message.type === "state" && message.state.player.nowPlaying?.title === "Artist - Current track");
  expect(remote.state.queue[0]!.title).toBe(station.name);
  await remote.command({ type: "stop" });
  expect(hub.session.state.player.nowPlaying).toBeFalsy();
});

class Peer {
  socket: WebSocket;
  messages: ServerMessage[] = [];
  private listeners = new Set<() => void>();

  constructor(hub: Hub, token: string) {
    this.socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${encodeURIComponent(token)}`, { headers: { Origin: hub.origin } });
    this.socket.addEventListener("message", event => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage);
      for (const listener of this.listeners) listener();
    });
    peers.push(this);
  }

  get state(): SessionState {
    const message = this.messages.findLast(message => message.type === "state");
    if (!message || message.type !== "state") throw new Error("No session snapshot received.");
    return message.state;
  }

  waitFor(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error("Timed out waiting for WebSocket message.")); }, 2000);
      const check = () => {
        const message = this.messages.findLast(predicate);
        if (message) { clearTimeout(timeout); this.listeners.delete(check); resolve(message); }
      };
      this.listeners.add(check);
      check();
    });
  }

  ready() { return this.waitFor(message => message.type === "state"); }

  command(action: Action) {
    const requestId = crypto.randomUUID();
    const result = this.waitFor(message => message.type === "result" && message.requestId === requestId);
    this.socket.send(JSON.stringify({ type: "command", requestId, action }));
    return result;
  }

  close() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise<void>(resolve => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      this.socket.close();
    });
  }
}

afterEach(async () => {
  for (const release of catalogGates.splice(0)) release();
  await Promise.all(peers.splice(0).map(peer => peer.close()));
  await Promise.all(hubs.splice(0).map(hub => hub.close()));
  await Promise.all(upstreams.splice(0).map(server => server.stop(true)));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("paired controllers relay TV navigation only to trusted host sockets without changing shared state", async () => {
  const { hub, commands } = fixture();
  const firstToken = await pair(hub), secondToken = await pair(hub);
  const host = new Peer(hub, hostToken);
  const secondHost = new Peer(hub, hostToken);
  const first = new Peer(hub, firstToken);
  const second = new Peer(hub, secondToken);
  await Promise.all([host.ready(), secondHost.ready(), first.ready(), second.ready()]);
  const state = JSON.stringify(hub.session.state);
  for (const [index, key] of (["up", "down", "left", "right", "select", "back", "home", "info"] as const).entries()) {
    expect(await (index % 2 ? first : second).command({ type: "navigate", key })).toMatchObject({ ok: true });
    await Promise.all([host.waitFor(message => message.type === "navigation" && message.key === key), secondHost.waitFor(message => message.type === "navigation" && message.key === key)]);
  }
  expect(host.messages.filter(message => message.type === "navigation").map(message => message.key)).toEqual(["up", "down", "left", "right", "select", "back", "home", "info"]);
  expect(secondHost.messages.filter(message => message.type === "navigation")).toHaveLength(8);
  for (const peer of [first, second]) expect(peer.messages.some(message => message.type === "navigation")).toBe(false);
  for (const peer of [host, secondHost, first, second]) expect(peer.messages.filter(message => message.type === "state")).toHaveLength(1);
  expect(JSON.stringify(hub.session.state)).toBe(state);
  expect(commands).toEqual([]);
});

test("TV navigation fails while the host is disconnected and never replays after reconnect", async () => {
  const { hub } = fixture();
  const token = await pair(hub);
  const remote = new Peer(hub, token);
  await remote.ready();
  expect(await remote.command({ type: "navigate", key: "select" })).toMatchObject({ ok: false, error: "The TV interface is disconnected. Try again when it reconnects." });
  const host = new Peer(hub, hostToken);
  await host.ready();
  expect(await remote.command({ type: "navigate", key: "up" })).toMatchObject({ ok: true });
  await host.waitFor(message => message.type === "navigation");
  expect(host.messages.filter(message => message.type === "navigation")).toEqual([{ type: "navigation", key: "up" }]);
  await host.close();
  expect(await remote.command({ type: "navigate", key: "down" })).toMatchObject({ ok: false });
  const reconnected = new Peer(hub, hostToken);
  const reconnectedRemote = new Peer(hub, token);
  await Promise.all([reconnected.ready(), reconnectedRemote.ready()]);
  expect(await reconnectedRemote.command({ type: "navigate", key: "info" })).toMatchObject({ ok: true });
  await reconnected.waitFor(message => message.type === "navigation");
  expect(reconnected.messages.filter(message => message.type === "navigation")).toEqual([{ type: "navigation", key: "info" }]);
  expect(reconnectedRemote.messages.some(message => message.type === "navigation")).toBe(false);
});

test("unpaired and invalid navigation requests cannot reach the TV", async () => {
  const { hub } = fixture();
  const host = new Peer(hub, hostToken);
  await host.ready();
  const unpaired = await fetch(`${hub.origin}/api/ws?token=unpaired`, { headers: { Origin: hub.origin, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" } });
  expect(unpaired.status).toBe(401);
  const remote = new Peer(hub, await pair(hub));
  await remote.ready();
  const closed = new Promise<number>(resolve => remote.socket.addEventListener("close", event => resolve(event.code), { once: true }));
  remote.socket.send(JSON.stringify({ type: "command", requestId: "invalid-key", action: { type: "navigate", key: "shutdown" } }));
  expect(await closed).toBe(1008);
  expect(host.messages.some(message => message.type === "navigation")).toBe(false);
});

test("TV navigation uses the same command rate limit as playback controls", async () => {
  const { hub } = fixture();
  const host = new Peer(hub, hostToken);
  const remote = new Peer(hub, await pair(hub));
  await Promise.all([host.ready(), remote.ready()]);
  const closed = new Promise<number>(resolve => remote.socket.addEventListener("close", event => resolve(event.code), { once: true }));
  for (let index = 0; index < 61; index++) remote.socket.send(JSON.stringify({ type: "command", requestId: `direction-${index}`, action: { type: "navigate", key: index === 59 ? "info" : "up" } }));
  expect(await closed).toBe(1008);
  await host.waitFor(message => message.type === "navigation" && message.key === "info");
  expect(host.messages.filter(message => message.type === "navigation")).toHaveLength(60);
});

async function delayedCatalog(kind: "library" | "jellyfin") {
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  catalogGates.push(gate.resolve);
  let initial: ReturnType<typeof fixture>;
  let itemId = "a".repeat(32);
  let newerId = "c".repeat(32);
  if (kind === "library") {
    const createLibrary = libraryModule.createLibrary;
    let library!: ReturnType<typeof createLibrary>;
    const spy = spyOn(libraryModule, "createLibrary").mockImplementation(options => {
      library = createLibrary({ ...options, ffprobePath: null });
      const getPlayable = library.getPlayable;
      library.getPlayable = async id => {
        if (id === itemId) { entered.resolve(); await gate.promise; }
        return getPlayable(id);
      };
      return library;
    });
    try { initial = fixture(); } finally { spy.mockRestore(); }
    const directory = join(initial.databasePath, "..");
    writeFileSync(join(directory, "First.mp3"), "filename metadata fixture");
    writeFileSync(join(directory, "Second.mp3"), "filename metadata fixture");
    await library.scan((await library.addSource(directory)).id);
    [itemId, newerId] = library.search({}).items.map(item => item.id) as [string, string];
  } else {
    const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/System/Info/Public") return Response.json({ ServerName: "Catalog fixture", Id: "test-server", Version: "10.11.0" });
      if (path === "/Users/AuthenticateByName") return Response.json({ AccessToken: "private-fixture-token", User: { Id: "b".repeat(32), Name: "Household" } });
      if (path === `/Items/${itemId}`) { entered.resolve(); await gate.promise; }
      if (path === `/Items/${itemId}` || path === `/Items/${newerId}`) return Response.json({ Id: path.slice(7), Name: path.endsWith(itemId) ? "First" : "Second", Type: "Movie", UserData: { PlaybackPositionTicks: 120_000_000 }, RunTimeTicks: 1_200_000_000 });
      if (path.endsWith("/PlaybackInfo")) return Response.json({ PlaySessionId: "fixture-session", MediaSources: [{ Id: "fixture-media", SupportsDirectPlay: true, Protocol: "File", Container: "mkv" }] });
      if (path.startsWith("/Sessions/")) return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    } });
    upstreams.push(upstream);
    initial = fixture();
    expect((await fetch(`${initial.hub.origin}/api/jellyfin`, {
      method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${upstream.port}`, username: "Household", password: "fixture" }),
    })).ok).toBe(true);
  }
  initial.hub.session.observe(idle);
  const first = new Peer(initial.hub, await pair(initial.hub));
  const second = new Peer(initial.hub, await pair(initial.hub));
  await Promise.all([first.ready(), second.ready()]);
  const action = (newer = false, playNow = true): Extract<Action, { type: "enqueueLibrary" | "enqueueJellyfin" }> => ({ type: kind === "library" ? "enqueueLibrary" : "enqueueJellyfin", itemId: newer ? newerId : itemId, entryId: newer ? "newer-catalog" : "delayed-catalog", playNow });
  return { ...initial, first, second, action, entered: entered.promise, release: gate.resolve };
}

test.each([false, true])("Jellyfin play-now forwards fromStart=%s through host resolution", async fromStart => {
  const { first, action, entered, release, waitForCommand } = await delayedCatalog("jellyfin");
  const pending = first.command({ ...action(), fromStart });
  await entered;
  release();
  expect(await pending).toMatchObject({ ok: true });
  const load = await waitForCommand(command => command.type === "load");
  expect(load).toMatchObject({ type: "load" });
  if (fromStart) expect(load).not.toHaveProperty("startPosition");
  else expect(load).toMatchObject({ startPosition: 12 });
});

for (const kind of ["library", "jellyfin"] as const) {
  test.each(["idle stop", "playing stop", "queue play", "next", "newer play-now", "EOF"])(`delayed ${kind} play-now cannot override %s`, async interruption => {
    const { hub, commands, first, second, action, entered, release, waitForCommand } = await delayedCatalog(kind);
    for (const id of ["one", "two"]) await first.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` } });
    if (interruption !== "idle stop" && interruption !== "newer play-now") await first.command({ type: "play", entryId: "one" });
    const pending = first.command(action());
    await entered;
    if (interruption.endsWith("stop")) expect(await second.command({ type: "stop" })).toMatchObject({ ok: true });
    if (interruption === "queue play") expect(await second.command({ type: "play", entryId: "two" })).toMatchObject({ ok: true });
    if (interruption === "next") expect(await second.command({ type: "next", playbackId: hub.session.state.player.playbackId! })).toMatchObject({ ok: true });
    if (interruption === "newer play-now") expect(await second.command(action(true))).toMatchObject({ ok: true });
    if (interruption === "EOF") hub.session.observe({ ...idle, playbackId: hub.session.state.player.playbackId, status: "ended" });
    const currentEntryId = hub.session.state.currentEntryId;
    const playbackId = hub.session.state.player.playbackId;
    release();
    expect(await pending).toMatchObject({ ok: false, error: "Added to the queue. Playback was canceled by a newer control." });
    await second.waitFor(message => message.type === "state" && message.state.queue.some(entry => entry.id === "delayed-catalog"));
    expect(second.state.currentEntryId).toBe(currentEntryId);
    expect(second.state.player.playbackId).toBe(playbackId);
    if (interruption === "newer play-now") await waitForCommand(command => command.type === "load" && command.playbackId === playbackId);
    expect(commands.filter(command => command.type === "load").some(command => command.source.includes(kind === "library" ? "First.mp3" : "a".repeat(32)))).toBe(false);
    expect(hub.session.state.queue.some(entry => entry.id === "delayed-catalog")).toBe(true);
  });

  test(`queue-only additions preserve a pending ${kind} play-now intent`, async () => {
    const { hub, commands, first, second, action, entered, release, waitForCommand } = await delayedCatalog(kind);
    const pending = first.command(action());
    await entered;
    expect(await second.command(action(true, false))).toMatchObject({ ok: true });
    expect(await second.command({ type: "enqueueWeb", entryId: "web-queued", url: "https://media.example/video", title: "Queued webpage", playNow: false })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBeNull();
    release();
    expect(await pending).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBe("delayed-catalog");
    expect(hub.session.state.queue.map(entry => entry.id)).toEqual(["newer-catalog", "web-queued", "delayed-catalog"]);
    await waitForCommand(command => command.type === "load");
    expect(commands.filter(command => command.type === "load")).toHaveLength(1);
  });
}

test("pairs devices and rejects foreign origins, rebinding hosts, and missing tokens", async () => {
  const { hub } = fixture();
  const endpoint = `${hub.origin}/api/pair`;
  const post = (headers: Record<string, string>, code = hub.pairingCode) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ code }) });
  expect((await post({})).status).toBe(403);
  expect((await post({ Origin: "https://unrelated.example" })).status).toBe(403);
  expect((await post({ Origin: hub.origin, Host: "unrelated.example" })).status).toBe(403);
  expect((await post({ Origin: hub.origin }, "000000")).status).toBe(401);
  expect((await fetch(`${hub.origin}/api/ws`, { headers: { Origin: hub.origin } })).status).toBe(401);
  expect((await fetch(`${hub.origin}/api/ws?token=${hostToken}`, { headers: { Origin: "https://unrelated.example" } })).status).toBe(403);
  const health = await fetch(`${hub.origin}/api/health`);
  expect(await health.json()).toEqual({ ok: true, player: "unavailable" });
  const token = await pair(hub);
  const peer = new Peer(hub, token);
  await peer.ready();
  expect(peer.state.queue).toEqual([]);
});

test("HTTP viewing profiles, observed history and resume stay shared across controllers and restart", async () => {
  const initial = fixture();
  const { hub, commands } = initial;
  hub.session.observe(idle);
  const token = await pair(hub);
  const first = new Peer(hub, token);
  const second = new Peer(hub, await pair(hub));
  const host = new Peer(hub, hostToken);
  await Promise.all([first.ready(), second.ready(), host.ready()]);
  const api = (path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Origin: hub.origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect((await fetch(`${hub.origin}/api/progress/history`)).status).toBe(401);
  const created = await api("/api/profiles", "POST", { name: "Movie night" });
  expect(created.status).toBe(201);
  const { profile } = await created.json() as { profile: { id: string; name: string } };
  expect((await api(`/api/profiles/${profile.id}/select`, "POST")).status).toBe(200);
  await second.waitFor(message => message.type === "state" && message.state.activeProfile.id === profile.id);
  const file = { id: "private-file", title: "Shared movie", source: "file:///private/movies/movie.mkv" };
  expect(await host.command({ type: "enqueue", entry: file })).toMatchObject({ ok: true });
  expect(await first.command({ type: "play", entryId: file.id })).toMatchObject({ ok: true });
  const playbackId = hub.session.state.player.playbackId!;
  hub.session.observe({ ...idle, playbackId, status: "playing", position: 24, duration: 120, seekable: true });
  const version = hub.session.state.libraryVersion;
  await second.waitFor(message => message.type === "state" && message.state.libraryVersion === version);
  expect((await api("/api/profiles/household/select", "POST")).status).toBe(409);
  let history = await (await api("/api/progress/history")).json() as { items: Array<{ mediaId: string; position: number; queueEntryId: string }>; profile: { id: string } };
  expect(history.profile.id).toBe(profile.id);
  expect(history.items[0]).toMatchObject({ position: 24, queueEntryId: file.id });
  expect(JSON.stringify(history)).not.toContain("/private/");
  expect((await api(`/api/progress/${encodeURIComponent(history.items[0]!.mediaId)}`, "POST", { clearResume: true })).status).toBe(409);
  await second.command({ type: "seek", playbackId, position: 8 });
  hub.session.observe({ ...idle, playbackId, status: "paused", position: 8, duration: 120, seekable: true });
  await first.command({ type: "stop" });
  hub.session.observe(idle);
  await first.command({ type: "play", entryId: file.id });
  expect(commands.at(-1)).toMatchObject({ type: "load", startPosition: 8 });
  expect(await second.command({ type: "seek", playbackId, position: 70 })).toMatchObject({ ok: false });
  await first.command({ type: "stop" });
  hub.session.observe(idle);
  await api("/api/profiles/household/select", "POST");
  expect(await (await api("/api/progress/history")).json()).toMatchObject({ items: [] });
  await api(`/api/profiles/${profile.id}/select`, "POST");
  await Promise.all([first.close(), second.close(), host.close()]);
  await hub.close();
  hubs.splice(hubs.indexOf(hub), 1);
  const restarted = fixture(initial.databasePath);
  const remote = new Peer(restarted.hub, token);
  await remote.ready();
  expect(remote.state.activeProfile).toEqual(profile);
  expect(remote.state.currentEntryId).toBeNull();
  expect(restarted.commands).toEqual([]);
  history = await (await fetch(`${restarted.hub.origin}/api/progress/history`, { headers: { Authorization: `Bearer ${token}` } })).json() as typeof history;
  expect(history.items[0]?.position).toBe(8);
  restarted.hub.session.observe(idle);
  await remote.command({ type: "play", entryId: file.id, fromStart: true });
  expect(restarted.commands.at(-1)).toMatchObject({ type: "load" });
  expect(restarted.commands.at(-1)).not.toHaveProperty("startPosition");
});

test("advertised Docker addresses allow same-origin LAN pairing and retain Host and Origin checks", async () => {
  const advertised = "http://192.168.10.2:4100";
  const { hub } = fixture(undefined, [advertised, advertised]);
  expect(hub.urls).toEqual([advertised]);
  const request = (host: string, origin: string) => fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Host: host, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect((await request("192.168.10.2:4100", advertised)).status).toBe(200);
  expect((await request("192.168.10.2:4100", "https://untrusted.example")).status).toBe(403);
  expect((await request("192.168.10.3:4100", "http://192.168.10.3:4100")).status).toBe(403);
});

test("paired clients share web entry quality, artwork and provider favorites without native secrets", async () => {
  const initial = fixture();
  const token = await pair(initial.hub);
  const first = new Peer(initial.hub, token);
  const second = new Peer(initial.hub, await pair(initial.hub));
  await Promise.all([first.ready(), second.ready()]);
  const entry = { type: "enqueueWeb" as const, entryId: "web-video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A video", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", quality: "720p" as const };
  expect(await first.command(entry)).toMatchObject({ ok: true });
  await second.waitFor(message => message.type === "state" && message.state.queue[0]?.id === entry.entryId);
  expect(second.state.queue[0]).toMatchObject({ source: `web:${entry.url}`, quality: "720p", thumbnail: entry.thumbnail, automaticTitle: false });
  const endpoint = `${initial.hub.origin}/api/providers/favorites`;
  expect((await fetch(endpoint)).status).toBe(401);
  const headers = { Authorization: `Bearer ${token}`, Origin: initial.hub.origin, "Content-Type": "application/json" };
  const item = { provider: "youtube", kind: "media", title: entry.title, url: entry.url, description: "Line one\nLine two" };
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ item }) });
  expect(response.status).toBe(200);
  await second.waitFor(message => message.type === "state" && message.state.providerVersion === 1);
  const saved = await (await fetch(endpoint, { headers })).json();
  expect(saved).toMatchObject({ favorites: [item] });
  await Promise.all([first.close(), second.close()]);
  await initial.hub.close();
  hubs.splice(hubs.indexOf(initial.hub), 1);
  const restarted = fixture(initial.databasePath);
  const remote = new Peer(restarted.hub, token);
  await remote.ready();
  expect(remote.state.queue[0]).toMatchObject({ quality: "720p", thumbnail: entry.thumbnail });
  expect(remote.state.currentEntryId).toBeNull();
  expect(await (await fetch(`${restarted.hub.origin}/api/providers/favorites`, { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual(saved);
});

test("two controllers share queue and observed playback, reject stale controls, and recover current state", async () => {
  const { hub, commands } = fixture();
  hub.session.observe(idle);
  const token = await pair(hub);
  const first = new Peer(hub, token);
  const second = new Peer(hub, token);
  await Promise.all([first.ready(), second.ready()]);
  await first.command({ type: "enqueue", entry: { id: "one", title: "First", source: "https://media.example/one.mp4" } });
  await second.command({ type: "enqueue", entry: { id: "two", title: "Second", source: "https://media.example/two.mp4" } });
  await first.waitFor(message => message.type === "state" && message.state.queue.length === 2);
  expect(first.state.queue).toEqual(second.state.queue);
  await first.command({ type: "play", entryId: "one" });
  const firstLoad = commands.findLast(command => command.type === "load");
  if (firstLoad?.type !== "load") throw new Error("Expected native load command.");
  expect(first.state.player.status).toBe("loading");
  const playing: PlayerState = { ...idle, playbackId: firstLoad.playbackId, status: "playing", duration: 120, seekable: true };
  hub.session.observe(playing);
  await second.waitFor(message => message.type === "state" && message.state.player.status === "playing");
  await second.command({ type: "pause", playbackId: firstLoad.playbackId, paused: true });
  expect(second.state.player.status).toBe("playing");
  expect(commands.at(-1)).toEqual({ type: "pause", playbackId: firstLoad.playbackId, paused: true });
  hub.session.observe({ ...playing, status: "paused" });
  await first.waitFor(message => message.type === "state" && message.state.player.status === "paused");
  await first.close();
  await second.command({ type: "next", playbackId: firstLoad.playbackId });
  const currentId = hub.session.state.player.playbackId;
  expect(currentId).not.toBe(firstLoad.playbackId);
  hub.session.observe({ ...playing, position: 50 });
  expect(hub.session.state.player.playbackId).toBe(currentId);
  expect(hub.session.state.player.position).toBe(0);
  const stale = await second.command({ type: "seek", playbackId: firstLoad.playbackId, position: 30 });
  expect(stale).toMatchObject({ type: "result", ok: false });
  await second.close();
  const reconnected = new Peer(hub, token);
  await reconnected.ready();
  expect(reconnected.state.currentEntryId).toBe("two");
  expect(reconnected.state.player.playbackId).toBe(currentId);
  expect(reconnected.state.queue.map(entry => entry.id)).toEqual(["one", "two"]);
});

test("persists queue, chosen volume, and paired devices without resuming playback after restart", async () => {
  const initial = fixture();
  const token = await pair(initial.hub);
  const peer = new Peer(initial.hub, token);
  await peer.ready();
  await peer.command({ type: "enqueue", entry: { id: "radio", title: "Radio", source: "https://radio.example/live" } });
  await peer.command({ type: "volume", volume: 35 });
  const unavailable = await peer.command({ type: "play", entryId: "radio" });
  expect(unavailable).toMatchObject({ ok: false });
  expect(initial.commands).toEqual([]);
  await peer.close();
  await initial.hub.close();
  hubs.splice(hubs.indexOf(initial.hub), 1);
  const restarted = fixture(initial.databasePath);
  const remote = new Peer(restarted.hub, token);
  await remote.ready();
  expect(remote.state.queue[0]?.id).toBe("radio");
  expect(remote.state.player.volume).toBe(35);
  expect(remote.state.currentEntryId).toBeNull();
  expect(remote.state.player.status).toBe("unavailable");
  restarted.hub.session.observe(idle);
  expect(restarted.commands).toEqual([{ type: "volume", volume: 35 }]);
});

test("uses stable queue IDs for moves, removes the active item, and advances at end of media", async () => {
  const { hub, commands } = fixture();
  hub.session.observe(idle);
  const peer = new Peer(hub, hostToken);
  await peer.ready();
  for (const id of ["one", "two", "three"]) await peer.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` } });
  await peer.command({ type: "move", entryId: "three", beforeEntryId: "two" });
  expect(peer.state.queue.map(entry => entry.id)).toEqual(["one", "three", "two"]);
  await peer.command({ type: "play", entryId: "one" });
  hub.session.observe({ ...idle, playbackId: hub.session.state.player.playbackId, status: "ended" });
  await peer.waitFor(message => message.type === "state" && message.state.currentEntryId === "three");
  await peer.command({ type: "remove", entryId: "three" });
  expect(peer.state.currentEntryId).toBeNull();
  expect(commands.at(-1)).toEqual({ type: "stop" });
  expect(peer.state.queue.map(entry => entry.id)).toEqual(["one", "two"]);
});

test("only the desktop host can enqueue local files", async () => {
  const { hub } = fixture();
  const host = new Peer(hub, hostToken);
  const remote = new Peer(hub, await pair(hub));
  await Promise.all([host.ready(), remote.ready()]);
  const entry = { id: "local", title: "Local file", source: "file:///tmp/video.mp4" };
  expect(await host.command({ type: "enqueue", entry })).toMatchObject({ ok: true });
  const closed = new Promise<number>(resolve => remote.socket.addEventListener("close", event => resolve(event.code), { once: true }));
  remote.socket.send(JSON.stringify({ type: "command", requestId: "forbidden", action: { type: "enqueue", entry: { ...entry, id: "forbidden" } } }));
  expect(await closed).toBe(1008);
  expect(hub.session.state.queue.map(entry => entry.id)).toEqual(["local"]);
});

test("limits repeated pairing attempts", async () => {
  const { hub } = fixture();
  let response!: Response;
  for (let attempt = 0; attempt < 21; attempt++) response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: "000000" }) });
  expect(response.status).toBe(429);
});

test("catalog HTTP authenticates native CORS requests and shares only approved local files", async () => {
  const createFolders = foldersModule.createMediaFolders;
  const folderService = spyOn(foldersModule, "createMediaFolders").mockImplementation(() => createFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null }));
  let initial: ReturnType<typeof fixture>;
  try { initial = fixture(); } finally { folderService.mockRestore(); }
  const { hub, databasePath, commands } = initial;
  const token = await pair(hub);
  const api = (path: string, token: string, method = "GET", body?: unknown, origin = "http://tauri.localhost") => fetch(`${hub.origin}${path}`, { method, headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const preflight = await fetch(`${hub.origin}/api/library/sources`, { method: "OPTIONS", headers: { Origin: "http://tauri.localhost", "Access-Control-Request-Headers": "Authorization, Content-Type" } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  expect((await api("/api/library/sources", "invalid")).status).toBe(401);
  expect((await api("/api/library/sources", token, "GET", undefined, "https://foreign.example")).status).toBe(403);
  expect((await api("/api/library/sources", token, "POST", { path: "/tmp" })).status).toBe(403);
  const directory = realpathSync(join(databasePath, ".."));
  writeFileSync(join(directory, "Local song.mp3"), "not a real mp3; filename fallback");
  const host = new Peer(hub, hostToken);
  const remote = new Peer(hub, token);
  await Promise.all([host.ready(), remote.ready()]);
  const response = await api("/api/library/sources", hostToken, "POST", { path: directory });
  expect(response.status).toBe(201);
  const { sources: addedSources } = await response.json() as { sources: { id: string }[] };
  expect((await api(`/api/library/sources/${addedSources[0]!.id}/scan`, hostToken, "POST")).status).toBe(202);
  expect(response.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  await remote.waitFor(message => message.type === "state" && (message.state.libraryVersion ?? 0) >= 3);
  const sources = await (await api("/api/library/sources", token)).json();
  expect(JSON.stringify(sources)).not.toContain(directory);
  const { items } = await (await api("/api/library/items?q=Local", token)).json() as { items: { id: string }[] };
  expect(items).toHaveLength(1);
  expect(await remote.command({ type: "enqueueLibrary", itemId: items[0]!.id, entryId: "library-song" })).toMatchObject({ ok: true });
  await host.waitFor(message => message.type === "state" && message.state.queue[0]?.id === "library-song");
  expect(host.state.queue[0]?.title).toBe("Local song");
  expect(host.state.queue[0]?.source).toBe(`library:${items[0]!.id}`);
  expect(JSON.stringify(host.state)).not.toContain(directory);
  const outside = mkdtempSync(join(tmpdir(), "couch-outside-"));
  roots.push(outside);
  writeFileSync(join(outside, "private.mp3"), "outside the library");
  rmSync(join(directory, "Local song.mp3"));
  symlinkSync(join(outside, "private.mp3"), join(directory, "Local song.mp3"));
  hub.session.observe(idle);
  await remote.command({ type: "play", entryId: "library-song" });
  await remote.waitFor(message => message.type === "state" && message.state.player.status === "error");
  expect(commands.some(command => command.type === "load")).toBe(false);
});

test("an administrator manages a durable radio playlist while ordinary remotes browse, favorite and play", async () => {
  let stream = "https://radio.example/live.mp3";
  let available = true;
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => available
    ? new Response(`#EXTM3U\n#EXTINF:-1 tvg-id="avoid-radio-sygma-radio" tvg-name="Sygma_Radio" tvg-logo="https://radio.example/logo.png" group-title="avoid radio" radio="true",Sygma Radio\n${stream}\n`)
    : new Response("Temporary outage", { status: 503 }) });
  try {
    const initial = fixture();
    const token = await pair(initial.hub);
    const first = new Peer(initial.hub, token);
    const guestToken = await pair(initial.hub);
    const second = new Peer(initial.hub, guestToken);
    await Promise.all([first.ready(), second.ready()]);
    const api = (hub: Hub, path = "", method = "GET", body?: unknown, callerToken = token) => fetch(`${hub.origin}/api/radio/${path}`, {
      method, headers: { Origin: hub.origin, Authorization: `Bearer ${callerToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect((await fetch(`${initial.hub.origin}/api/radio/playlists`, { headers: { Origin: initial.hub.origin } })).status).toBe(401);
    expect((await api(initial.hub, "sources")).status).toBe(403);
    expect((await api(initial.hub, "playlists", "POST", { name: "avoid radio", url: `http://127.0.0.1:${feed.port}/playlist.m3u` })).status).toBe(403);
    const claimCode = await (await fetch(`${initial.hub.origin}/api/controllers/claim-code`, { headers: { Authorization: `Bearer ${hostToken}` } })).json() as { code: string };
    expect((await fetch(`${initial.hub.origin}/api/controllers/claim`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ code: claimCode.code }) })).status).toBe(200);
    const added = await api(initial.hub, "playlists", "POST", { name: "avoid radio", url: `http://127.0.0.1:${feed.port}/playlist.m3u` });
    expect(added.status).toBe(201);
    const { playlist } = await added.json() as { playlist: RadioPlaylist };
    expect(playlist.stationCount).toBe(1);
    expect((await (await api(initial.hub, "sources")).json()).sources[0].url).toBe(playlist.url);
    expect((await (await api(initial.hub, "playlists", "GET", undefined, guestToken)).json()).playlists[0].url).toBeUndefined();
    expect((await api(initial.hub, "sources", "GET", undefined, guestToken)).status).toBe(403);
    expect((await api(initial.hub, `playlists/${playlist.id}/refresh`, "POST", undefined, guestToken)).status).toBe(403);
    expect((await api(initial.hub, `playlists/${playlist.id}`, "DELETE", undefined, guestToken)).status).toBe(403);
    await second.waitFor(message => message.type === "state" && (message.state.radioVersion ?? 0) > 0);
    const stations = async (hub: Hub) => (await (await api(hub, `playlists/${playlist.id}/stations`)).json() as { stations: RadioStation[] }).stations;
    const [station] = await stations(initial.hub);
    expect(station).toMatchObject({ name: "Sygma Radio", url: stream, groupTitle: "avoid radio", logoUrl: "https://radio.example/logo.png" });
    expect((await api(initial.hub, `playlists/${playlist.id}/stations`, "GET", undefined, guestToken)).status).toBe(200);
    expect((await api(initial.hub, "favorites", "POST", { station }, guestToken)).status).toBe(200);
    expect(await first.command({ type: "enqueueRadio", stationId: "missing", entryId: "missing-radio" })).toMatchObject({ ok: false });
    expect(await first.command({ type: "enqueueRadio", stationId: station!.id, entryId: "curated-radio" })).toMatchObject({ ok: true });
    await second.waitFor(message => message.type === "state" && message.state.queue.some(entry => entry.id === "curated-radio"));
    expect(second.state.queue[0]).toMatchObject({ source: `radio:${station!.id}`, thumbnail: station!.logoUrl, kind: "radio", live: true });
    const version = second.state.radioVersion ?? 0;
    stream = "https://radio.example/replacement.mp3";
    expect((await api(initial.hub, `playlists/${playlist.id}/refresh`, "POST")).status).toBe(200);
    await second.waitFor(message => message.type === "state" && (message.state.radioVersion ?? 0) > version);
    const [refreshed] = await stations(initial.hub);
    expect(refreshed?.id).toBe(station?.id);
    expect(refreshed?.url).toBe(stream);
    initial.hub.session.observe(idle);
    expect(await second.command({ type: "play", entryId: "curated-radio" })).toMatchObject({ ok: true });
    expect(initial.commands.at(-1)).toMatchObject({ type: "load", source: stream });
    available = false;
    expect((await api(initial.hub, `playlists/${playlist.id}/refresh`, "POST")).ok).toBe(false);
    expect((await stations(initial.hub))[0]?.url).toBe(stream);
    await Promise.all([first.close(), second.close()]);
    await initial.hub.close();
    hubs.splice(hubs.indexOf(initial.hub), 1);
    const restarted = fixture(initial.databasePath);
    expect((await stations(restarted.hub))[0]?.id).toBe(station?.id);
    const favorites = await (await api(restarted.hub, "favorites")).json() as { favorites: RadioStation[] };
    expect(favorites.favorites).toHaveLength(1);
    expect(favorites.favorites[0]?.id).toBe(station?.id);
    expect(favorites.favorites[0]?.url).toBe(stream);
    const remote = new Peer(restarted.hub, token);
    await remote.ready();
    restarted.hub.session.observe(idle);
    expect(await remote.command({ type: "play", entryId: "curated-radio" })).toMatchObject({ ok: true });
    expect(restarted.commands.at(-1)).toMatchObject({ type: "load", source: stream });
    expect((await api(restarted.hub, `playlists/${playlist.id}`, "DELETE")).status).toBe(204);
    expect(await (await api(restarted.hub, "playlists")).json()).toEqual({ playlists: [] });
  } finally { await feed.stop(true); }
});

test("paired HTTP controllers rename and race removal with shared durable state and unchanged authority", async () => {
  const initial = fixture();
  const { hub } = initial;
  hub.session.observe(idle);
  const firstToken = await pair(hub), secondToken = await pair(hub);
  const first = new Peer(hub, firstToken), second = new Peer(hub, secondToken);
  await Promise.all([first.ready(), second.ready()]);
  const api = (target: Hub, token: string, path: string, body?: unknown) => fetch(`${target.origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, Origin: target.origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const identities = await Promise.all([firstToken, secondToken].map(async token => (await (await api(hub, token, "/api/controllers/me")).json()).controller));
  const { profile } = await (await api(hub, firstToken, "/api/profiles", { name: "Viewer" })).json();
  await api(hub, firstToken, `/api/profiles/${profile.id}/select`, {});
  await second.waitFor(message => message.type === "state" && message.state.activeProfile.id === profile.id);
  await first.command({ type: "preferences", profileId: profile.id, preferences: { speed: 1.25 } });
  expect((await fetch(`${hub.origin}/api/profiles/${profile.id}/rename`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "No pairing", expectedName: profile.name }) })).status).toBe(401);
  const renamed = { ...profile, name: "Movie night" };
  expect((await api(hub, secondToken, `/api/profiles/${profile.id}/rename`, { name: renamed.name, expectedName: profile.name })).status).toBe(200);
  await Promise.all([first, second].map(peer => peer.waitFor(message => message.type === "state" && message.state.activeProfile.name === renamed.name)));
  expect(first.state.preferences?.profile.speed).toBe(1.25);
  expect((await api(hub, firstToken, `/api/profiles/${profile.id}/rename`, { name: "Stale", expectedName: profile.name })).status).toBe(409);
  first.messages.length = second.messages.length = 0;
  const races = await Promise.all([firstToken, secondToken].map(token => api(hub, token, `/api/profiles/${profile.id}/remove`, { expectedName: renamed.name })));
  expect(races.map(response => response.status).sort()).toEqual([200, 404]);
  await Promise.all([first, second].map(peer => peer.waitFor(message => message.type === "state" && message.state.activeProfile.id === "household")));
  for (const peer of [first, second]) expect(peer.state.preferences?.profile.speed).toBe(1);
  const reconnected = new Peer(hub, secondToken);
  await reconnected.ready();
  expect(reconnected.state.activeProfile).toEqual({ id: "household", name: "Household" });
  expect((await (await api(hub, firstToken, "/api/profiles")).json()).profiles).toEqual([{ id: "household", name: "Household" }]);
  for (const [index, token] of [firstToken, secondToken].entries()) {
    const identity = (await (await api(hub, token, "/api/controllers/me")).json()).controller;
    expect(identity).toMatchObject({ id: identities[index].id, role: "controller" });
    expect((await api(hub, token, "/api/settings", { installationName: "Unclaimed" })).status).toBe(403);
  }
  await Promise.all([first.close(), second.close(), reconnected.close()]);
  await hub.close();
  hubs.splice(hubs.indexOf(hub), 1);
  const restarted = fixture(initial.databasePath);
  const remote = new Peer(restarted.hub, firstToken);
  await remote.ready();
  expect(remote.state.activeProfile).toEqual({ id: "household", name: "Household" });
  expect(remote.state.currentEntryId).toBeNull();
  expect(restarted.commands).toEqual([]);
  expect((await (await api(restarted.hub, secondToken, "/api/profiles")).json()).profiles).toEqual([{ id: "household", name: "Household" }]);
});
