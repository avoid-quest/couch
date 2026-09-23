import { Database } from "bun:sqlite";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage, SessionState } from "../shared/protocol";
import type { RadioPlaylist, RadioStation } from "../shared/radio";
import { createHub, type Hub } from "./hub";
import { buildInfo } from "./build-info";
import { buildKey } from "../shared/build";
import * as foldersModule from "./media-folders";
import * as libraryModule from "./library";
import * as youtubeModule from "./providers/youtube";
import * as bandcampModule from "./providers/bandcamp";
import * as providersModule from "./providers";
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

const controllerApi = (hub: Hub, token: string, path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, {
  method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
});

async function claimAdministrator(hub: Hub, token: string) {
  const identity = await (await controllerApi(hub, token, "/api/controllers/me")).json() as { controller: { id: string } };
  expect((await controllerApi(hub, hostToken, `/api/controllers/${identity.controller.id}/role`, "POST", { role: "administrator" })).status).toBe(200);
}

test("revoking one of two controllers closes all its sockets and rejects later HTTP and reconnects", async () => {
  const { hub } = fixture();
  const ownerToken = await pair(hub), guestToken = await pair(hub);
  await claimAdministrator(hub, ownerToken);
  const owner = new Peer(hub, ownerToken), guest = new Peer(hub, guestToken), anotherTab = new Peer(hub, guestToken);
  await Promise.all([owner.ready(), guest.ready(), anotherTab.ready()]);
  const { controller } = await (await controllerApi(hub, guestToken, "/api/controllers/me")).json() as { controller: { id: string } };
  const closed = [guest, anotherTab].map(peer => new Promise<number>(resolve => peer.socket.addEventListener("close", event => resolve(event.code), { once: true })));
  expect((await controllerApi(hub, ownerToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
  expect(await Promise.all(closed)).toEqual([4001, 4001]);
  const snapshotCounts = [guest.messages.length, anotherTab.messages.length];
  expect(await owner.command({ type: "volume", volume: 29 })).toMatchObject({ ok: true });
  for (const path of ["/api/controllers/me", "/api/settings", "/api/profiles", "/api/playlists", "/api/providers/favorites", "/api/subtitles"]) expect((await controllerApi(hub, guestToken, path)).status).toBe(401);
  expect((await fetch(`${hub.origin}/api/ws?token=${guestToken}`, { headers: { Origin: hub.origin } })).status).toBe(401);
  expect([guest.messages.length, anotherTab.messages.length]).toEqual(snapshotCounts);
  expect((await controllerApi(hub, ownerToken, "/api/controllers/me")).status).toBe(200);
});

test("revocation prevents a delayed admitted album from appending or starting playback", async () => {
  const started = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>(), album = Promise.withResolvers<ProviderPage>();
  const lookup = spyOn(bandcampModule, "loadBandcampAlbum").mockImplementation(async () => { started.resolve(); const result = await album.promise; finished.resolve(); return result; });
  try {
    const { hub, commands } = fixture();
    hub.session.observe(idle);
    const ownerToken = await pair(hub), guestToken = await pair(hub);
    await claimAdministrator(hub, ownerToken);
    const owner = new Peer(hub, ownerToken), guest = new Peer(hub, guestToken);
    await Promise.all([owner.ready(), guest.ready()]);
    const { controller } = await (await controllerApi(hub, guestToken, "/api/controllers/me")).json() as { controller: { id: string } };
    guest.socket.send(JSON.stringify({ type: "command", requestId: "late-album", action: { type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album", playNow: true } }));
    await started.promise;
    expect((await controllerApi(hub, ownerToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    album.resolve(bandcampAlbum);
    await finished.promise;
    expect(await owner.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
    expect(hub.session.state.queue).toEqual([]);
    expect(commands.filter(command => command.type === "load")).toEqual([]);
    expect(hub.session.state.currentEntryId).toBeNull();
  } finally { album.resolve(bandcampAlbum); lookup.mockRestore(); }
});

test("revocation during source-list saving leaves no playlist or change notification", async () => {
  const started = Promise.withResolvers<void>(), list = Promise.withResolvers<ProviderPage>();
  const resolve = spyOn(providersModule, "loadProviderList").mockImplementation(async () => { started.resolve(); return list.promise; });
  try {
    const { hub } = fixture();
    const ownerToken = await pair(hub), guestToken = await pair(hub);
    await claimAdministrator(hub, ownerToken);
    const { controller } = await (await controllerApi(hub, guestToken, "/api/controllers/me")).json() as { controller: { id: string } };
    const playlistVersion = hub.session.state.playlistVersion;
    const saving = controllerApi(hub, guestToken, "/api/playlists", "POST", { source: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" } });
    await started.promise;
    expect((await controllerApi(hub, ownerToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    list.resolve({ title: "Late list", items: [{ id: "video", title: "Video", provider: "youtube", kind: "media", url: "https://www.youtube.com/watch?v=abcdefghijk" }] });
    expect((await saving).status).toBe(401);
    expect(await (await controllerApi(hub, ownerToken, "/api/playlists")).json()).toEqual({ playlists: [] });
    expect(hub.session.state.playlistVersion).toBe(playlistVersion);
  } finally { list.resolve({ items: [] }); resolve.mockRestore(); }
});

test("revocation during source resolution prevents the late native load and metadata change", async () => {
  const started = Promise.withResolvers<void>(), source = Promise.withResolvers<{ source: string; metadata: { title: string } }>();
  const resolve = spyOn(webMediaModule, "resolveWebMedia").mockImplementation(async () => { started.resolve(); return source.promise; });
  try {
    const { hub, commands } = fixture();
    hub.session.observe(idle);
    const ownerToken = await pair(hub), guestToken = await pair(hub);
    await claimAdministrator(hub, ownerToken);
    const owner = new Peer(hub, ownerToken), guest = new Peer(hub, guestToken);
    await Promise.all([owner.ready(), guest.ready()]);
    const { controller } = await (await controllerApi(hub, guestToken, "/api/controllers/me")).json() as { controller: { id: string } };
    expect(await guest.command({ type: "enqueueWeb", entryId: "pending", url: "https://example.com/video", title: "Original", playNow: true })).toMatchObject({ ok: true });
    await started.promise;
    expect((await controllerApi(hub, ownerToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    source.resolve({ source: "https://example.com/resolved", metadata: { title: "Late" } });
    await owner.waitFor(message => message.type === "state" && message.state.player.error?.includes("revoked") === true);
    expect(commands.filter(command => command.type === "load")).toEqual([]);
    expect(hub.session.state.queue[0]?.title).toBe("Original");
  } finally { source.resolve({ source: "https://example.com/resolved", metadata: { title: "Late" } }); resolve.mockRestore(); }
});

test("a known IP accepts the advertised TV origin while arbitrary origins and hosts remain rejected", async () => {
  const advertised = "http://couch.local:4100";
  const { hub } = fixture(undefined, [advertised]);
  const token = await pair(hub);
  const response = await fetch(`${hub.origin}/api/controllers/me`, { headers: { Origin: advertised, Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(advertised);
  const peer = new BunWebSocket(`${hub.origin.replace("http", "ws")}/api/ws?token=${token}`, { headers: { Origin: advertised } });
  await new Promise<void>((resolve, reject) => { peer.onmessage = () => resolve(); peer.onerror = () => reject(new Error("Known-IP connection failed")); });
  peer.close();
  const details = await fetch(`${hub.origin}/api/connection`, { headers: { Origin: advertised } });
  expect(await details.json()).toEqual({ name: "Couch", installationId: expect.any(String), urls: [advertised, hub.origin], player: "unavailable", remoteControlEnabled: true, desktopClientProtocol: 1, tvPresentation: false });
  for (const origin of ["http://unrelated.example", "null", "http://couch.local:4101", "https://couch.local:4100"]) expect((await fetch(`${hub.origin}/api/connection`, { headers: { Origin: origin } })).status).toBe(403);
  expect((await fetch(`${hub.origin}/api/connection`, { headers: { Host: "unrelated.example" } })).status).toBe(403);
});

test.each(["http://couch.avoid.local:80", "https://couch.avoid.local:443", "https://couch.avoid.local:8443"])("advertised origin %s preserves proxy pairing, authentication and exact scheme checks", async configured => {
  const advertised = new URL(configured);
  const { hub } = fixture(undefined, [configured]);
  const headers = { Host: advertised.host, Origin: advertised.origin, "Content-Type": "application/json" };
  expect(hub.urls).toEqual([advertised.origin]);
  expect(hub.origin).toStartWith("http://127.0.0.1:");
  const paired = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers, body: JSON.stringify({ code: hub.pairingCode }) });
  expect(paired.status).toBe(200);
  const { token } = await paired.json() as { token: string };
  const authenticated = await fetch(`${hub.origin}/api/controllers/me`, { headers: { ...headers, Authorization: `Bearer ${token}` } });
  expect(authenticated.status).toBe(200);
  expect(authenticated.headers.get("Access-Control-Allow-Origin")).toBe(advertised.origin);
  expect((await fetch(`${hub.origin}/api/controllers/me`, { headers })).status).toBe(401);
  const socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}`, { headers });
  try {
    const message = await new Promise<MessageEvent>((resolve, reject) => { socket.onmessage = resolve; socket.onerror = () => reject(new Error("Proxied connection failed")); });
    expect(JSON.parse(message.data).type).toBe("state");
  } finally { socket.close(); }
  for (const origin of [`${advertised.protocol === "https:" ? "http:" : "https:"}//${advertised.host}`, `${advertised.origin}.evil.example`, "null"]) {
    expect((await fetch(`${hub.origin}/api/connection`, { headers: { ...headers, Origin: origin } })).status).toBe(403);
  }
  expect((await fetch(`${hub.origin}/api/connection`, { headers: { ...headers, Host: "untrusted.example", "X-Forwarded-Host": advertised.host, "X-Forwarded-Proto": advertised.protocol.slice(0, -1) } })).status).toBe(403);
  expect((await fetch(`${hub.origin}/api/controllers/me`, { headers: { Origin: "tauri://localhost", Authorization: `Bearer ${hostToken}` } })).status).toBe(200);
});

test.each(["ftp://couch.local", "https://user:secret@couch.local", "https://couch.local/path", "https://couch.local?query", "https://couch.local#fragment", "https://couch.local\\evil", " https://couch.local"])("advertised origin rejects %s", origin => {
  expect(() => fixture(undefined, [origin])).toThrow("Advertised LAN addresses must be HTTP or HTTPS origins without credentials or paths.");
});

test("Bandcamp albums append once in order, play through the host resolver and persist public metadata", async () => {
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockResolvedValue(bandcampAlbum);
  const resolve = spyOn(webMediaModule, "resolveWebMedia").mockResolvedValue({ source: "https://private-stream.example/signed", headers: { Authorization: "private-stream-token" } });
  try {
    const initial = fixture();
    initial.hub.session.observe(idle);
    const token = await pair(initial.hub);
    const first = new Peer(initial.hub, token), second = new Peer(initial.hub, await pair(initial.hub));
    await Promise.all([first.ready(), second.ready()]);
    expect(await first.command({ type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album", playNow: true })).toMatchObject({ ok: true });
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

test.each(["album", "playlist"] as const)("provider %s Play now keeps its tracks together before the existing waiting queue", async kind => {
  const page: ProviderPage = kind === "album" ? bandcampAlbum : { title: "Playlist", items: ["abcdefghijk", "zyxwvutsrqp"].map((id, index) => ({ id, title: `Episode ${index + 1}`, kind: "media", provider: "youtube", url: `https://www.youtube.com/watch?v=${id}` })) };
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockResolvedValue(page);
  const playlist = spyOn(youtubeModule, "loadYouTubePlaylist").mockResolvedValue(page);
  const resolve = spyOn(webMediaModule, "resolveWebMedia").mockResolvedValue({ source: "https://media.example/resolved" });
  try {
    const { hub } = fixture(); hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub)); await remote.ready();
    await remote.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" }, playNow: true });
    await remote.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: "https://media.example/waiting" } });
    const action: Action = kind === "album" ? { type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album", playNow: true }
      : { type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", playNow: true };
    expect(await remote.command(action)).toMatchObject({ ok: true });
    expect(hub.session.state.queue.map(entry => entry.title)).toEqual(["Current", ...page.items.map(item => item.title), "Waiting"]);
    expect(hub.session.state.currentEntryId).toBe(hub.session.state.queue[1]!.id);
    expect(await remote.command({ type: "next", playbackId: hub.session.state.player.playbackId! })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBe(hub.session.state.queue[2]!.id);
    expect(await remote.command({ type: "next", playbackId: hub.session.state.player.playbackId! })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBe("waiting");
  } finally { album.mockRestore(); playlist.mockRestore(); resolve.mockRestore(); }
});

test("Bandcamp album failure or insufficient capacity leaves the queue unchanged", async () => {
  const album = spyOn(bandcampModule, "loadBandcampAlbum").mockResolvedValue(bandcampAlbum);
  try {
    const { hub } = fixture();
    hub.session.loadQueue(Array.from({ length: 499 }, () => ({ id: "existing", title: "Existing", source: "https://media.example/existing" })), "append");
    const remote = new Peer(hub, await pair(hub));
    await remote.ready();
    const queue = remote.state.queue;
    const action = { type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album" } as const;
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
    const pending = first.command({ type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album", playNow: true });
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
    remote.socket.send(JSON.stringify({ type: "command", requestId: "shutdown-album", action: { type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album" } }));
    const signal = await started.promise;
    await hub.close();
    await finished.promise;
    expect(signal.aborted).toBe(true);
    expect(hub.session.state.queue).toEqual([]);
  } finally { album.mockRestore(); }
});

function fixture(databasePath?: string, advertisedUrls?: string[], admitted?: () => boolean, extra: Partial<Parameters<typeof createHub>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "couch-test-"));
  roots.push(directory);
  const commands: PlaybackCommand[] = [];
  const listeners = new Set<() => void>();
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: databasePath ?? join(directory, "state.sqlite"), pairingCode: "123456", hostToken, advertisedUrls, admitted, ...extra, sendPlayer: command => { commands.push(command); for (const listener of listeners) listener(); } });
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

test("the first paired phone names the TV for every controller and retains its authority after restart", async () => {
  const initial = fixture();
  const ownerToken = await pair(initial.hub), guestToken = await pair(initial.hub);
  const first = new Peer(initial.hub, ownerToken), second = new Peer(initial.hub, guestToken);
  await Promise.all([first.ready(), second.ready()]);
  const api = (hub: Hub, token: string, path: string, method = "GET", body?: unknown) => fetch(`${hub.origin}${path}`, {
    method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const originalProfile = first.state.activeProfile;
  expect(first.state).toMatchObject({ installationName: "Couch", administratorClaimed: true });
  expect((await api(initial.hub, guestToken, "/api/controllers/claim-code")).status).toBe(403);
  expect((await api(initial.hub, guestToken, "/api/settings", "POST", { name: "Unapproved TV" })).status).toBe(403);
  expect((await api(initial.hub, hostToken, "/api/controllers/claim-code")).status).toBe(409);
  expect((await api(initial.hub, ownerToken, "/api/settings", "POST", { name: "Living room" })).status).toBe(200);
  await second.waitFor(message => message.type === "state" && message.state.installationName === "Living room");
  expect(second.state.activeProfile).toEqual(originalProfile);
  expect(second.state.queue).toEqual([]);
  expect(initial.commands).toEqual([]);
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
  await pair(hub);
  const response = await request("  Kitchen phone  ");
  expect(response.status).toBe(200);
  const paired = await response.json() as { token: string; controller: { name: string; role: string } };
  expect(paired.controller).toMatchObject({ name: "Kitchen phone", role: "controller" });
  expect(JSON.stringify(paired.controller)).not.toContain(paired.token);
  expect(JSON.stringify(paired.controller)).not.toContain("token_hash");
  expect(hub.session.state.administratorClaimed).toBe(true);
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
      library = createLibrary({ ...options, folders: foldersModule.createMediaFolders({ roots: [realpathSync(tmpdir())], mountInfo: async () => null }), ffprobePath: null });
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
    expect(hub.session.state.queue.map(entry => entry.id)).toEqual(["delayed-catalog", "newer-catalog", "web-queued"]);
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
  expect(await (await api("/api/progress/history")).json()).toMatchObject({ items: [{ mediaId: history.items[0]!.mediaId, position: 8, queueEntryId: file.id }] });
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

test("paired controllers and reconnects share the queue boundary after Stop", async () => {
  const { hub } = fixture();
  hub.session.observe(idle);
  const first = new Peer(hub, await pair(hub)), second = new Peer(hub, await pair(hub));
  await Promise.all([first.ready(), second.ready()]);
  for (const id of ["one", "two", "three"]) await first.command({ type: "enqueue", entry: { id, title: id, source: `https://media.example/${id}` } });
  await first.command({ type: "play", entryId: "two" });
  await second.waitFor(message => message.type === "state" && message.state.currentEntryId === "two");
  expect(second.state.queueCursorEntryId).toBe("two");
  await second.command({ type: "stop" });
  await first.waitFor(message => message.type === "state" && message.state.currentEntryId === null && message.state.queueCursorEntryId === "two");
  expect(first.state.queue).toEqual(second.state.queue);
  expect(first.state.queue.map(entry => entry.id)).toEqual(["two", "one", "three"]);
  const reconnected = new Peer(hub, await pair(hub));
  await reconnected.ready();
  expect(reconnected.state).toMatchObject({ currentEntryId: null, queueCursorEntryId: "two" });
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
  expect((await api("/api/library/sources", token, "POST", { path: "/" })).status).toBe(403);
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
    expect((await api(initial.hub, "sources", "GET", undefined, guestToken)).status).toBe(403);
    expect((await api(initial.hub, "playlists", "POST", { name: "avoid radio", url: `http://127.0.0.1:${feed.port}/playlist.m3u` }, guestToken)).status).toBe(403);
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
    expect(identity).toMatchObject({ id: identities[index].id, role: index === 0 ? "administrator" : "controller" });
    expect((await api(hub, token, "/api/settings", { installationName: "Unclaimed" })).status).toBe(index === 0 ? 400 : 403);
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

test("the local host and administrators can read sanitized diagnostics through HTTP", async () => {
  const { hub, commands } = fixture();
  const token = await pair(hub), guest = await pair(hub);
  const api = (token: string, path: string, body?: unknown) => fetch(`${hub.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: hub.origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect((await api(guest, "/api/diagnostics")).status).toBe(403);
  expect((await api(hostToken, "/api/diagnostics/export")).status).toBe(200);
  hub.session.observe({ ...idle, error: `Failed https://user:secret@example.test/private?signature=secret ${hub.pairingCode} ${hostToken}` });
  const previousCommands = [...commands];
  const response = await api(token, "/api/diagnostics/export");
  expect(response.status).toBe(200);
  const text = await response.text();
  for (const secret of [hub.pairingCode, hostToken, "signature=secret", "user:secret"]) expect(text).not.toContain(secret);
  const report = JSON.parse(text);
  expect(report.native).toBeNull(); expect(report.nativeError).toContain("not connected");
  expect(report.recent.some((entry: { source: string }) => entry.source === "Playback")).toBe(true);
  expect(report.configuration.some((fact: { name: string; value: unknown }) => fact.name === "Listen port" && fact.value === hub.server.port)).toBe(true);
  expect((await api(guest, "/api/diagnostics/export")).status).toBe(403);
  expect(commands).toEqual(previousCommands);
});


test("trial admission blocks pairing and last-seen writes while keeping authenticated build identity readable", async () => {
  let open = true;
  const { hub, databasePath } = fixture(undefined, undefined, () => open);
  const token = await pair(hub);
  const db = new Database(databasePath);
  try {
    db.query("UPDATE devices SET lastSeenAt = NULL").run();
    open = false;
    expect((await controllerApi(hub, token, "/api/settings")).status).toBe(503);
    expect((await controllerApi(hub, token, "/api/build")).status).toBe(200);
    expect((await controllerApi(hub, token, "/api/controllers/me")).status).toBe(200);
    expect(db.query<{ lastSeenAt: number | null }, []>("SELECT lastSeenAt FROM devices").get()?.lastSeenAt).toBeNull();
    expect((await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) })).status).toBe(503);
    expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM devices").get()?.count).toBe(1);
  } finally { db.close(); }
});

test.each(["maintenance", "sharing"])("pairing admitted before %s is disabled cannot save after its request body arrives", async mode => {
  let open = true;
  const { hub, databasePath } = fixture(undefined, undefined, () => open);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = Request.prototype.json;
  const body = spyOn(Request.prototype, "json").mockImplementation(async function(this: Request) { entered.resolve(); await release.promise; return original.call(this); });
  try {
    const response = fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
    await entered.promise;
    if (mode === "maintenance") open = false;
    else expect((await controllerApi(hub, hostToken, "/api/settings/sharing", "POST", { enabled: false })).status).toBe(200);
    release.resolve();
    expect((await response).status).toBe(503);
    const db = new Database(databasePath, { readonly: true });
    try { expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM devices").get()?.count).toBe(0); }
    finally { db.close(); }
  } finally { release.resolve(); body.mockRestore(); }
});

test("maintenance admission cancels a delayed album before queue writes or native playback", async () => {
  let open = true;
  const entered = Promise.withResolvers<void>(), album = Promise.withResolvers<ProviderPage>();
  const lookup = spyOn(bandcampModule, "loadBandcampAlbum").mockImplementation(async () => { entered.resolve(); return album.promise; });
  try {
    const { hub, commands } = fixture(undefined, undefined, () => open);
    hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub));
    await remote.ready();
    const result = remote.command({ type: "enqueueProvider", provider: "bandcamp", shape: "playlist", url: "https://artist.bandcamp.com/album/album", playNow: true });
    await entered.promise;
    open = false;
    album.resolve(bandcampAlbum);
    expect(await result).toMatchObject({ ok: false });
    expect(hub.session.state.queue).toEqual([]);
    expect(commands.filter(command => command.type === "load")).toEqual([]);
  } finally { album.resolve(bandcampAlbum); lookup.mockRestore(); }
});


test.each([false, true])("hub maintenance checkpoint reports its actual SQLite save outcome, failing=%s", async failing => {
  const { hub, databasePath } = fixture();
  hub.session.observe(idle);
  hub.session.command({ type: "enqueue", entry: { id: "one", title: "One", source: "file:///one.mp4" }, playNow: true });
  const player = { ...idle, playbackId: hub.session.state.player.playbackId, status: "playing" as const, position: 12, duration: 100 };
  hub.session.observe(player);
  hub.session.observe({ ...player, position: 17 });
  const db = new Database(databasePath);
  try {
    if (failing) db.run("CREATE TRIGGER reject_progress BEFORE INSERT ON viewing_progress BEGIN SELECT RAISE(FAIL, 'fixture disk failure'); END");
    const result = await hub.quiesce().catch(error => error);
    if (failing) {
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain("Could not save viewing progress");
      expect(db.query<{ position: number }, []>("SELECT position FROM viewing_progress").get()?.position).toBe(12);
      hubs.splice(hubs.indexOf(hub), 1);
    } else {
      expect(result).toEqual({ progressSaved: true, admissionClosed: true });
      expect(db.query<{ position: number }, []>("SELECT position FROM viewing_progress").get()?.position).toBe(17);
    }
    expect(() => hub.session.command({ type: "volume", volume: 10 })).toThrow("update");
  } finally { db.close(); }
});


test("trial permits private native asset acknowledgment and administrator status without last-seen writes", async () => {
  let open = true, acknowledgments = 0;
  const { hub, databasePath } = fixture(undefined, undefined, () => open, {
    frontendReady: build => { acknowledgments++; return (build as { revision?: string })?.revision === "current"; },
    updater: { request: async () => ({ ok: true, transaction: null, installationAvailable: true }) },
  });
  const owner = await pair(hub), guest = await pair(hub);
  await claimAdministrator(hub, owner);
  const db = new Database(databasePath);
  try {
    db.query("UPDATE devices SET lastSeenAt = NULL").run();
    open = false;
    expect((await controllerApi(hub, guest, "/api/maintenance/frontend", "POST", { build: { revision: "current" } })).status).toBe(403);
    expect(acknowledgments).toBe(0);
    expect((await controllerApi(hub, hostToken, "/api/maintenance/frontend", "POST", { build: { revision: "old" } })).status).toBe(409);
    expect((await controllerApi(hub, hostToken, "/api/maintenance/frontend", "POST", { build: { revision: "current" } })).status).toBe(200);
    expect((await controllerApi(hub, guest, "/api/updates")).status).toBe(403);
    const status = await controllerApi(hub, owner, "/api/updates");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ installation: { enabled: true, transaction: null } });
    expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM devices WHERE lastSeenAt IS NOT NULL").get()?.count).toBe(0);
  } finally { db.close(); }
});


test("packaged control connections reject missing or stale asset identity before controller writes", async () => {
  const { hub, databasePath } = fixture();
  const token = await pair(hub), previous = { ...buildInfo };
  const db = new Database(databasePath);
  try {
    Object.assign(buildInfo, { packaged: true, version: "2", revision: "b".repeat(40), dataFormat: 1 });
    db.query("UPDATE devices SET lastSeenAt = NULL").run();
    for (const build of ["", "old"]) expect((await fetch(`${hub.origin}/api/ws?token=${token}&build=${build}`, { headers: { Origin: hub.origin } })).status).toBe(409);
    expect(db.query<{ lastSeenAt: number | null }, []>("SELECT lastSeenAt FROM devices").get()?.lastSeenAt).toBeNull();
    const socket = new BunWebSocket(`${hub.origin.replace("http", "ws")}/api/ws?token=${token}&build=${encodeURIComponent(buildKey(buildInfo)!)}`, { headers: { Origin: hub.origin } });
    try { await new Promise<void>((resolve, reject) => { socket.onmessage = () => resolve(); socket.onerror = () => reject(new Error("Matching assets were rejected")); }); }
    finally { socket.close(); }
  } finally { Object.assign(buildInfo, previous); db.close(); }
});

test("a paired desktop client can use a different build revision with the same protocol", async () => {
  const { hub } = fixture();
  const token = await pair(hub), previous = { ...buildInfo };
  try {
    for (const version of ["1", "3"]) {
      Object.assign(buildInfo, { packaged: true, version, revision: "b".repeat(40), dataFormat: 1 });
      expect((await fetch(`${hub.origin}/api/ws?token=${token}&clientProtocol=1&build=old`, { headers: { Origin: hub.origin } })).status).toBe(409);
      for (const clientProtocol of ["0", "2"]) expect((await fetch(`${hub.origin}/api/ws?token=${token}&clientProtocol=${clientProtocol}&build=old`, { headers: { Origin: "http://tauri.localhost" } })).status).toBe(409);
      expect((await fetch(`${hub.origin}/api/ws?token=bad&clientProtocol=1&build=old`, { headers: { Origin: "http://tauri.localhost" } })).status).toBe(401);
      const socket = new BunWebSocket(`${hub.origin.replace("http", "ws")}/api/ws?token=${token}&clientProtocol=1&build=old`, { headers: { Origin: "http://tauri.localhost" } });
      try { await new Promise<void>((resolve, reject) => { socket.onmessage = () => resolve(); socket.onerror = () => reject(new Error("Compatible desktop client was rejected")); }); }
      finally { socket.close(); }
    }
  } finally { Object.assign(buildInfo, previous); }
});


test("either remote's input resets idle time, while authenticated status polling does not", async () => {
  let now = 0;
  const { hub } = fixture(undefined, undefined, undefined, { idleNow: () => now });
  hub.session.observe(idle);
  const first = await pair(hub), second = await pair(hub);
  const one = new Peer(hub, first), two = new Peer(hub, second);
  await Promise.all([one.ready(), two.ready()]);
  now = 600_000; expect(hub.idleReason()).toBeNull();
  expect((await controllerApi(hub, first, "/api/controllers/me")).status).toBe(200);
  expect(hub.idleReason()).toBeNull();
  expect((await controllerApi(hub, second, "/api/activity", "POST", { activity: true })).status).toBe(204);
  expect(hub.idleReason()).not.toBeNull();
  now += 600_000; expect(hub.idleReason()).toBeNull();
  expect(await one.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
  expect(hub.idleReason()).not.toBeNull();
  now += 600_000; expect(hub.idleReason()).toBeNull();
  expect(await two.command({ type: "volume", volume: 33 })).toMatchObject({ ok: true });
  expect(hub.idleReason()).not.toBeNull();
});

test("legacy recording state survives startup without backend work or playback access", async () => {
  const first = fixture();
  const source = "recording:00000000-0000-4000-8000-000000000001";
  const entry = { id: "legacy", title: "Saved broadcast", source };
  first.hub.session.command({ type: "enqueue", entry });
  await first.hub.close();
  const mediaPath = `${first.databasePath}.ts`;
  writeFileSync(mediaPath, "retained media");
  const database = new Database(first.databasePath);
  database.run(`CREATE TABLE recording_setup (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE recording_jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE recording_qualification (id INTEGER PRIMARY KEY, data TEXT NOT NULL);`);
  database.query("INSERT INTO recording_setup VALUES (1, ?)").run('{"revision":1}');
  database.query("INSERT INTO recording_jobs VALUES (?, ?)").run(source.slice(10), '{"status":"running"}');
  database.query("INSERT INTO recording_qualification VALUES (1, ?)").run('{"phase":"submitted"}');
  database.query("INSERT INTO viewing_progress (profileId, mediaId, title, position, watched, lastPlayedAt) VALUES ('household', ?, ?, 15, 0, ?)").run(source, entry.title, Date.now());
  database.query("INSERT INTO history_sources VALUES (?, ?)").run(source, JSON.stringify(entry));
  const stored = ["recording_setup", "recording_jobs", "recording_qualification"].map(table => database.query(`SELECT * FROM ${table}`).all());
  database.close();

  let now = 0;
  const { hub, commands } = fixture(first.databasePath, undefined, undefined, { idleNow: () => now });
  hub.session.observe(idle);
  expect(hub.session.state.queue).toContainEqual(entry);
  now = 600_000;
  expect(hub.updateWork()).toBeNull();
  expect(hub.idleReason()).toBeNull();
  expect((await controllerApi(hub, hostToken, "/api/recordings")).status).toBe(404);
  expect(() => hub.session.command({ type: "play", entryId: entry.id })).toThrow("Couch recordings are no longer supported");
  expect(hub.session.state.player.error).toContain("Open the saved media file");
  const history = await controllerApi(hub, hostToken, `/api/progress/${encodeURIComponent(source)}/play`, "POST", { profileId: "household" });
  expect(history.status).toBe(410);
  expect((await history.json()).error).toContain("Couch recordings are no longer supported");
  hub.session.observe({ ...idle, status: "unavailable" });
  const disconnectedHistory = await controllerApi(hub, hostToken, `/api/progress/${encodeURIComponent(source)}/play`, "POST", { profileId: "household" });
  expect(disconnectedHistory.status).toBe(410);
  expect((await disconnectedHistory.json()).error).toContain("Open the saved media file");
  hub.session.observe(idle);
  expect(hub.session.state.queue).toContainEqual(entry);
  hub.session.command({ type: "enqueue", entry: { id: "file", title: "Retained file", source: new URL(`file://${mediaPath}`).href }, playNow: true });
  expect(commands.at(-1)).toMatchObject({ type: "load", source: new URL(`file://${mediaPath}`).href });
  await hub.close();
  const preserved = new Database(first.databasePath, { readonly: true });
  try {
    expect(["recording_setup", "recording_jobs", "recording_qualification"].map(table => preserved.query(`SELECT * FROM ${table}`).all())).toEqual(stored);
    expect(await Bun.file(mediaPath).text()).toBe("retained media");
  } finally { preserved.close(); }
});

test("General restart requires an administrator confirmation and installed supervisor", async () => {
  const { hub } = fixture();
  const admin = await pair(hub), guest = await pair(hub);
  await claimAdministrator(hub, admin);
  const restart = (token: string, confirmInterrupt: boolean) => controllerApi(hub, token, "/api/settings/restart", "POST", { confirmInterrupt });
  expect((await restart(guest, true)).status).toBe(403);
  expect((await restart(hostToken, true)).status).toBe(409);
  expect((await restart(admin, false)).status).toBe(400);
  expect((await restart(admin, true)).status).toBe(409);
  expect((await controllerApi(hub, admin, "/api/build")).status).toBe(200);
});

test("restart checkpoint failure preserves authenticated HTTP, playback and dirty progress for retry", async () => {
  let hub!: Hub;
  const fixtureResult = fixture(undefined, undefined, undefined, { restart: async () => hub.prepareRestart() });
  hub = fixtureResult.hub;
  const admin = await pair(hub);
  await claimAdministrator(hub, admin);
  hub.session.observe(idle);
  hub.session.command({ type: "enqueue", entry: { id: "restart-local", title: "Restart local", source: "file:///restart.mp4" }, playNow: true });
  const player = { ...idle, playbackId: hub.session.state.player.playbackId, status: "playing" as const, position: 12, duration: 100 };
  hub.session.observe(player);
  hub.session.observe({ ...player, position: 17 });
  const db = new Database(fixtureResult.databasePath);
  try {
    db.run("CREATE TRIGGER reject_restart_progress BEFORE INSERT ON viewing_progress BEGIN SELECT RAISE(FAIL, 'fixture disk failure'); END");
    const response = await controllerApi(hub, admin, "/api/settings/restart", "POST", { confirmInterrupt: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Could not save viewing progress. Check the TV's storage." });
    expect((await controllerApi(hub, admin, "/api/settings")).status).toBe(200);
    expect(hub.session.state.player.playbackId).toBe(player.playbackId);
    expect(() => hub.session.command({ type: "volume", volume: 44 })).not.toThrow();
    db.run("DROP TRIGGER reject_restart_progress");
    const accepted = await controllerApi(hub, admin, "/api/settings/restart", "POST", { confirmInterrupt: true });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ ok: true, instanceId: expect.any(String) });
    expect((await controllerApi(hub, admin, "/api/settings/restart")).status).toBe(200);
    expect(db.query<{ position: number }, []>("SELECT position FROM viewing_progress").get()?.position).toBe(17);
    expect(() => hub.session.command({ type: "volume", volume: 30 })).toThrow("update");
  } finally { db.close(); }
});

test("authenticated first-run steps broadcast to both phones and survive coordinator restart without replaying claim", async () => {
  const initial = fixture();
  const ownerToken = await pair(initial.hub), guestToken = await pair(initial.hub);
  const owner = new Peer(initial.hub, ownerToken), guest = new Peer(initial.hub, guestToken);
  await Promise.all([owner.ready(), guest.ready()]);
  expect(owner.state.setupStep).toBe("general");
  expect((await controllerApi(initial.hub, guestToken, "/api/settings/setup", "POST", { step: "general" })).status).toBe(403);
  await claimAdministrator(initial.hub, ownerToken);
  for (const [step, next] of [["general", "display"], ["display", "sound"]]) {
    expect((await controllerApi(initial.hub, ownerToken, "/api/settings/setup", "POST", { step })).status).toBe(200);
    await guest.waitFor(message => message.type === "state" && message.state.setupStep === next);
  }
  await Promise.all([owner.close(), guest.close()]);
  await initial.hub.close();
  hubs.splice(hubs.indexOf(initial.hub), 1);
  const restarted = fixture(initial.databasePath);
  const resumed = new Peer(restarted.hub, ownerToken);
  await resumed.ready();
  expect(resumed.state).toMatchObject({ setupStep: "sound", administratorClaimed: true, currentEntryId: null });
  expect((await controllerApi(restarted.hub, hostToken, "/api/controllers/claim-code")).status).toBe(409);
  for (const step of ["sound", "sources"]) expect((await controllerApi(restarted.hub, ownerToken, "/api/settings/setup", "POST", { step })).status).toBe(200);
  await resumed.waitFor(message => message.type === "state" && message.state.setupStep === "complete");
  expect(restarted.commands).toEqual([]);
  expect(resumed.state.queue).toEqual([]);
});

test("Bluetooth pairing ownership ends on administrator demotion, revocation and remote disconnect", async () => {
  const calls: import("../shared/bluetooth").BluetoothAction[] = [];
  const disconnected = Promise.withResolvers<void>();
  let onCancel: (() => void) | undefined;
  const { hub } = fixture(undefined, undefined, undefined, { nativeBluetooth: async action => { calls.push(action); if (action.op === "cancel") onCancel?.(); return { adapter: "available", devices: [], operation: null }; } });
  const first = await pair(hub), second = await pair(hub);
  await claimAdministrator(hub, first);
  const { controller } = await (await controllerApi(hub, second, "/api/controllers/me")).json() as { controller: { id: string } };
  const role = (value: string) => controllerApi(hub, first, `/api/controllers/${controller.id}/role`, "POST", { role: value });
  expect((await role("administrator")).status).toBe(200);
  expect((await controllerApi(hub, second, "/api/bluetooth", "POST", { action: { op: "pair", device: "AA:BB:CC:DD:EE:FF" } })).status).toBe(200);
  expect(calls.at(-1)).toMatchObject({ op: "pair", owner: controller.id });
  expect((await role("controller")).status).toBe(200);
  expect(calls.at(-1)).toEqual({ op: "cancel", owner: controller.id });
  expect((await controllerApi(hub, second, "/api/bluetooth")).status).toBe(403);
  expect((await role("administrator")).status).toBe(200);
  const peer = new Peer(hub, second); await peer.ready();
  const closed = new Promise(resolve => peer.socket.addEventListener("close", resolve, { once: true }));
  calls.length = 0; onCancel = disconnected.resolve; peer.socket.close(); await Promise.all([closed, disconnected.promise]);
  expect(calls).toContainEqual({ op: "cancel", owner: controller.id });
  calls.length = 0;
  expect((await controllerApi(hub, first, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
  expect(calls).toContainEqual({ op: "cancel", owner: controller.id });
});

test("paired controllers share For later across profile changes and restart without changing the active queue", async () => {
  const first = fixture();
  const token = await pair(first.hub), another = await pair(first.hub);
  const remote = new Peer(first.hub, another);
  await remote.ready();
  first.hub.session.observe(idle);
  first.hub.session.command({ type: "enqueue", entry: { id: "original", title: "Saved movie", source: "https://media.example/movie" } });
  const queue = first.hub.session.state.queue;
  const beforeCommands = [...first.commands];
  const savedResponse = await controllerApi(first.hub, token, "/api/for-later", "POST", { reference: { kind: "queue", id: "original" } });
  expect(savedResponse.status).toBe(201);
  const saved = (await savedResponse.json() as { item: { id: string; title: string } }).item;
  await remote.waitFor(message => message.type === "state" && message.state.forLaterVersion === 1);
  expect(JSON.stringify(saved)).not.toContain("media.example");
  expect(await (await controllerApi(first.hub, another, "/api/for-later")).json()).toEqual({ items: [saved] });
  expect(first.hub.session.state.queue).toEqual(queue); expect(first.commands).toEqual(beforeCommands);
  const profile = first.hub.session.createProfile("Guest");
  first.hub.session.selectProfile(profile.id);
  expect(await (await controllerApi(first.hub, another, "/api/for-later")).json()).toEqual({ items: [saved] });
  expect(first.hub.session.state.queue).toEqual(queue);
  expect((await controllerApi(first.hub, "unpaired", "/api/for-later")).status).toBe(401);
  expect((await controllerApi(first.hub, "unpaired", `/api/for-later/${saved.id}`, "DELETE")).status).toBe(401);
  await remote.close();
  await first.hub.close(); hubs.splice(hubs.indexOf(first.hub), 1);
  const second = fixture(first.databasePath);
  expect(await (await controllerApi(second.hub, another, "/api/for-later")).json()).toEqual({ items: [saved] });
  second.hub.session.observe(idle);
  const restartedCommands = [...second.commands];
  expect((await controllerApi(second.hub, token, `/api/for-later/${saved.id}/load`, "POST", { mode: "append" })).status).toBe(200);
  expect(second.hub.session.state.queue).toHaveLength(2); expect(second.commands).toEqual(restartedCommands);
  expect((await controllerApi(second.hub, another, `/api/for-later/${saved.id}/load`, "POST", { mode: "play" })).status).toBe(200);
  expect(second.hub.session.state.queue).toHaveLength(3);
  expect(second.hub.session.state.currentEntryId).toBe(second.hub.session.state.queue[0]!.id);
  expect(second.commands.some(command => command.type === "load")).toBe(true);
  const current = second.hub.session.state;
  expect((await controllerApi(second.hub, token, `/api/for-later/${saved.id}`, "DELETE")).status).toBe(200);
  expect(second.hub.session.state.queue).toEqual(current.queue);
  expect(second.hub.session.state.currentEntryId).toBe(current.currentEntryId);
  expect(await (await controllerApi(second.hub, another, "/api/for-later")).json()).toEqual({ items: [] });
});


test("page deep links and refresh serve the frontend while unknown APIs stay unavailable", async () => {
  const { frontendPaths } = await import("../shared/page-paths");
  const frontend = (await import("../client/index.html")).default;
  const { hub } = fixture(undefined, undefined, undefined, { frontend });
  for (const path of frontendPaths) {
    const response = await fetch(`${hub.origin}${path}?q=evening&source=Radio`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(script).toBeDefined();
    const asset = await fetch(new URL(script!, `${hub.origin}${path}`));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toContain("javascript");
  }
  expect((await fetch(`${hub.origin}/api/not-a-page`)).status).not.toBe(200);
  expect((await fetch(`${hub.origin}/settings/not-a-page`)).status).not.toBe(200);
});


test("YouTube playlist queue is atomic, ordered and applies the selected quality", async () => {
  const page: ProviderPage = { title: "Playlist", items: ["abcdefghijk", "zyxwvutsrqp"].map((id, index) => ({ id, title: `Episode ${index + 1}`, kind: "media", provider: "youtube", url: `https://www.youtube.com/watch?v=${id}` })) };
  const playlist = spyOn(youtubeModule, "loadYouTubePlaylist").mockResolvedValue(page);
  try {
    const { hub } = fixture(); hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub)); await remote.ready();
    expect(await remote.command({ type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", quality: "720p" })).toMatchObject({ ok: true });
    expect(hub.session.state.queue.map(entry => [entry.title, entry.source, entry.quality])).toEqual(page.items.map(item => [item.title, `web:${item.url}`, "720p"]));
    expect(hub.session.state.currentEntryId).toBeNull();
    playlist.mockRejectedValue(new Error("Playlist unavailable"));
    expect(await remote.command({ type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890" })).toMatchObject({ ok: false });
    expect(hub.session.state.queue).toHaveLength(2);
  } finally { playlist.mockRestore(); }
});

test("source-list saves preserve repeated media as separate ordered occurrences", async () => {
  const page: ProviderPage = { title: "Repeated", items: ["first", "second"].map(title => ({ id: "same-video", title, provider: "youtube", kind: "media", url: "https://www.youtube.com/watch?v=abcdefghijk" })) };
  const list = spyOn(providersModule, "loadProviderList").mockResolvedValue(page);
  try {
    const { hub } = fixture();
    const token = await pair(hub);
    const saved = await (await controllerApi(hub, token, "/api/playlists", "POST", { source: { provider: "youtube", url: "https://www.youtube.com/playlist?list=PL1234567890" } })).json() as { playlist: { id: string; revision: number; entries: Array<{ id: string; title: string }> } };
    expect(saved.playlist.entries.map(entry => entry.title)).toEqual(["first", "second"]);
    expect(new Set(saved.playlist.entries.map(entry => entry.id)).size).toBe(2);
    expect((await controllerApi(hub, token, `/api/playlists/${saved.playlist.id}/load`, "POST", { revision: saved.playlist.revision, mode: "replace" })).status).toBe(200);
    expect(hub.session.state.queue.map(entry => [entry.title, entry.source])).toEqual(page.items.map(item => [item.title, `web:${item.url}`]));
    expect(new Set(hub.session.state.queue.map(entry => entry.id)).size).toBe(2);
  } finally { list.mockRestore(); }
});

test("saved provider references queue atoms and expand lists without exposing the resolver", async () => {
  const page: ProviderPage = { title: "Channel", items: ["abcdefghijk"].map(id => ({ id, title: "Broadcast", kind: "media", provider: "twitch", url: `https://www.twitch.tv/videos/${id}` })) };
  const list = spyOn(providersModule, "loadProviderList").mockResolvedValue(page);
  try {
    const { hub } = fixture(); hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub)); await remote.ready();
    await remote.command({ type: "enqueueProvider", provider: "twitch", url: "https://www.twitch.tv/evening", shape: "playlist", title: "Evening channel" });
    expect(hub.session.state.queue.map(({ title, source }) => [title, source])).toEqual([["Broadcast", "web:https://www.twitch.tv/videos/abcdefghijk"]]);
    expect(list.mock.calls[0]).toEqual(["twitch", "https://www.twitch.tv/evening", expect.any(AbortSignal)]);
  } finally { list.mockRestore(); }
});

test("a later Stop cancels playlist play intent without losing resolved queue entries", async () => {
  const loading = Promise.withResolvers<ProviderPage>();
  const started = Promise.withResolvers<void>();
  const playlist = spyOn(youtubeModule, "loadYouTubePlaylist").mockImplementation(async () => { started.resolve(); return loading.promise; });
  try {
    const { hub } = fixture(); hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub)); await remote.ready();
    const pending = remote.command({ type: "enqueueProvider", provider: "youtube", shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890", playNow: true });
    await started.promise;
    expect(await remote.command({ type: "stop" })).toMatchObject({ ok: true });
    loading.resolve({ items: [{ id: "first", title: "First", provider: "youtube", kind: "media", url: "https://www.youtube.com/watch?v=abcdefghijk" }] });
    expect(await pending).toMatchObject({ ok: false, error: "Added to the queue. Playback was canceled by a newer control." });
    expect(hub.session.state.queue).toHaveLength(1);
    expect(hub.session.state.currentEntryId).toBeNull();
  } finally { loading.resolve({ items: [] }); playlist.mockRestore(); }
});

test("current quality commands await resolution, preserve paused position and share only public queue quality", async () => {
  const gate = Promise.withResolvers<Awaited<ReturnType<typeof webMediaModule.resolveWebMedia>>>();
  const started = Promise.withResolvers<void>();
  const resolve = spyOn(webMediaModule, "resolveWebMedia").mockImplementation(async (_url, _signal, quality) => {
    if (quality === "720p") { started.resolve(); return gate.promise; }
    return { source: "https://stream.example/original" };
  });
  try {
    const { hub, commands, waitForCommand } = fixture();
    hub.session.observe(idle);
    const remote = new Peer(hub, await pair(hub));
    const other = new Peer(hub, await pair(hub));
    await Promise.all([remote.ready(), other.ready()]);
    expect(await remote.command({ type: "enqueueWeb", entryId: "video", title: "Video", url: "https://youtube.com/watch?v=one", playNow: true })).toMatchObject({ ok: true });
    const loaded = await waitForCommand(command => command.type === "load");
    if (loaded.type !== "load") throw new Error("Expected load");
    hub.session.observe({ ...idle, playbackId: loaded.playbackId, status: "paused", seekable: true, position: 84, duration: 200 });
    let complete = false;
    const result = remote.command({ type: "videoQuality", playbackId: loaded.playbackId, quality: "720p" }).then(value => { complete = true; return value; });
    await started.promise;
    expect(complete).toBe(false);
    expect(commands.filter(command => command.type === "load")).toHaveLength(1);
    gate.resolve({ source: "https://stream.example/private", headers: { Authorization: "secret" }, maxVideoHeight: 720 });
    expect(await result).toMatchObject({ ok: true });
    await other.waitFor(message => message.type === "state" && message.state.queue[0]?.quality === "720p");
    expect(commands.at(-1)).toMatchObject({ type: "load", paused: true, startPosition: 84, maxVideoHeight: 720 });
    expect(other.state.queue[0]).toMatchObject({ id: "video", source: "web:https://youtube.com/watch?v=one", quality: "720p" });
    expect(JSON.stringify(other.messages)).not.toContain("secret");
    expect(JSON.stringify(other.messages)).not.toContain("stream.example");
    expect(await remote.command({ type: "videoQuality", playbackId: loaded.playbackId, quality: "480p" })).toMatchObject({ ok: false });
  } finally { resolve.mockRestore(); }
});


test("the authorized pairing QR uses the existing code and grants only controller access", async () => {
  const { hub } = fixture();
  const owner = await pair(hub), guest = await pair(hub);
  await claimAdministrator(hub, owner);
  for (const token of [hostToken, owner]) {
    const response = await controllerApi(hub, token, "/api/controllers/pairing-code");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ code: hub.pairingCode });
  }
  expect((await controllerApi(hub, guest, "/api/controllers/pairing-code")).status).toBe(403);
  expect((await controllerApi(hub, "unpaired", "/api/controllers/pairing-code")).status).toBe(401);
  const { code } = await (await controllerApi(hub, owner, "/api/controllers/pairing-code")).json() as { code: string };
  const paired = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code, name: "QR phone" }) });
  expect(paired.status).toBe(200);
  const result = await paired.json() as { token: string; controller: { id: string; role: string } };
  expect(result.controller.role).toBe("controller");
  expect(result.token).not.toBe(owner);
  expect((await controllerApi(hub, result.token, `/api/controllers/${result.controller.id}/name`, "POST", { name: "Frank's phone" })).status).toBe(200);
  expect(await (await controllerApi(hub, result.token, "/api/controllers/me")).json()).toMatchObject({ authority: "controller", controller: { name: "Frank's phone" } });
});

test("manual playback uses authenticated device names across sockets, history, Saved and playlists", async () => {
  const { hub } = fixture();
  hub.session.observe(idle);
  const firstToken = await pair(hub), secondToken = await pair(hub);
  const firstIdentity = await (await controllerApi(hub, firstToken, "/api/controllers/me")).json();
  const secondIdentity = await (await controllerApi(hub, secondToken, "/api/controllers/me")).json();
  await controllerApi(hub, firstToken, `/api/controllers/${firstIdentity.controller.id}/name`, "POST", { name: "Phone" });
  await controllerApi(hub, secondToken, `/api/controllers/${secondIdentity.controller.id}/name`, "POST", { name: "Laptop" });
  const first = new Peer(hub, firstToken), second = new Peer(hub, secondToken), host = new Peer(hub, hostToken);
  await Promise.all([first.ready(), second.ready(), host.ready()]);
  const phone = { deviceId: firstIdentity.controller.id, name: "Phone" };
  const laptop = { deviceId: secondIdentity.controller.id, name: "Laptop" };
  // Extra client fields never become attribution, including on raw queue entries.
  expect(await first.command({ type: "enqueue", entry: { id: "attributed", title: "Video", source: "https://media.example/video", playedBy: { deviceId: "fake", name: "Fake" } }, playNow: true, playedBy: { deviceId: "fake", name: "Fake" } } as Action)).toMatchObject({ ok: true });
  expect(hub.session.state.playedBy).toEqual(phone);
  expect(hub.session.state.queue[0]).not.toHaveProperty("playedBy");
  const observe = () => hub.session.observe({ ...idle, playbackId: hub.session.state.player.playbackId, status: "playing", position: 20, duration: 120, seekable: true });
  observe();
  await controllerApi(hub, firstToken, `/api/controllers/${phone.deviceId}/name`, "POST", { name: "Renamed phone" });
  expect(hub.session.state.playedBy).toEqual(phone);
  let history = await (await controllerApi(hub, secondToken, "/api/progress/history")).json();
  expect(history.items[0].playedBy).toEqual(phone);
  expect(JSON.stringify(history)).not.toContain(firstToken);
  const saved = await (await controllerApi(hub, firstToken, "/api/for-later", "POST", { reference: { kind: "queue", id: "attributed" } })).json();
  const playlist = await (await controllerApi(hub, firstToken, "/api/playlists", "POST", { name: "Videos" })).json();
  await second.command({ type: "stop" });
  expect((await controllerApi(hub, secondToken, `/api/progress/${encodeURIComponent(history.items[0].mediaId)}/play`, "POST", { profileId: hub.session.state.activeProfile.id })).status).toBe(200);
  expect(hub.session.state.playedBy).toEqual(laptop);
  observe();
  history = await (await controllerApi(hub, firstToken, "/api/progress/history")).json();
  expect(history.items[0].playedBy).toEqual(laptop);
  expect((await controllerApi(hub, firstToken, `/api/for-later/${saved.item.id}/load`, "POST", { mode: "play" })).status).toBe(200);
  expect(hub.session.state.playedBy).toEqual({ ...phone, name: "Renamed phone" });
  expect((await controllerApi(hub, secondToken, `/api/playlists/${playlist.playlist.id}/load`, "POST", { revision: playlist.playlist.revision, mode: "play" })).status).toBe(200);
  expect(hub.session.state.playedBy).toEqual(laptop);
  expect(await host.command({ type: "play", entryId: hub.session.state.currentEntryId! })).toMatchObject({ ok: true });
  expect(hub.session.state.playedBy).toEqual({ deviceId: "host", name: "Couch" });
});

test("failed controller operation survives coordinator restart in administrator diagnostics and export", async () => {
  const first = fixture();
  const token = await pair(first.hub), guest = await pair(first.hub);
  await claimAdministrator(first.hub, token);
  const remote = new Peer(first.hub, token); await remote.ready();
  const failure = await remote.command({ type: "enqueueRadio", entryId: "missing", stationId: "missing", playNow: true });
  if (failure.type !== "result") throw new Error("Expected command result");
  expect(failure.ok).toBe(false);
  const original = await (await controllerApi(first.hub, token, "/api/diagnostics")).json();
  const entry = original.recent.find((entry: { source: string }) => entry.source === "Controller command");
  expect(entry).toMatchObject({ message: failure.error, build: original.build, sessionId: original.sessionId, count: 1 });
  expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  await remote.close(); await first.hub.close();
  const restarted = fixture(first.databasePath);
  for (const path of ["/api/diagnostics", "/api/diagnostics/export"]) {
    const response = await controllerApi(restarted.hub, token, path);
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report.recent).toContainEqual(entry);
    expect(report.sessionId).not.toBe(entry.sessionId);
    expect((await controllerApi(restarted.hub, guest, path)).status).toBe(403);
    expect((await controllerApi(restarted.hub, hostToken, path)).status).toBe(200);
    expect((await controllerApi(restarted.hub, token, path, "DELETE")).status).toBe(405);
  }
  const recovered = new Peer(restarted.hub, token); await recovered.ready();
  expect(await recovered.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
});

test("diagnostic read and write failures leave coordinator commands and restart recovery usable", async () => {
  const first = fixture();
  first.hub.session.observe(idle);
  const token = await pair(first.hub);
  await claimAdministrator(first.hub, token);
  const db = new Database(first.databasePath);
  try {
    db.run("CREATE TRIGGER fail_diagnostics BEFORE UPDATE ON diagnostic_history BEGIN SELECT RAISE(ABORT, 'password=private-storage-secret'); END");
    const remote = new Peer(first.hub, token); await remote.ready();
    expect(await remote.command({ type: "enqueueRadio", entryId: "missing", stationId: "missing" })).toMatchObject({ ok: false });
    expect(await remote.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
    expect(first.commands).toContainEqual({ type: "volume", volume: 32 });
    const report = await (await controllerApi(first.hub, token, "/api/diagnostics/export")).json();
    expect(report.historyError).toContain("could not be saved");
    expect(JSON.stringify(report)).not.toContain("private-storage-secret");
    await remote.close(); await first.hub.close();
    db.run("DROP TRIGGER fail_diagnostics; UPDATE diagnostic_history SET entries = 'invalid-json'");
    const second = fixture(first.databasePath);
    const recovered = new Peer(second.hub, token); await recovered.ready();
    expect(await recovered.command({ type: "volume", volume: 40 })).toMatchObject({ ok: true });
    const failedRead = await (await controllerApi(second.hub, token, "/api/diagnostics")).json();
    expect(failedRead.historyError).toContain("could not be read");
    await recovered.close(); await second.hub.close();
    db.run("UPDATE diagnostic_history SET entries = '[]'");
    const third = fixture(first.databasePath);
    const healthy = await (await controllerApi(third.hub, token, "/api/diagnostics")).json();
    expect(healthy.historyError).toBeNull();
  } finally { db.close(); }
});

test("local sharing disconnects remotes immediately, preserves playback and pairings, and survives restart", async () => {
  const initial = fixture(undefined, undefined, undefined, { remoteControlEnabled: false });
  const { hub } = initial;
  const sharing = (enabled: unknown, token = hostToken) => controllerApi(hub, token, "/api/settings/sharing", "POST", { enabled });
  const pairing = () => fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
  expect((await pairing()).status).toBe(503);
  expect(await (await controllerApi(hub, hostToken, "/api/settings/sharing")).json()).toEqual({ enabled: false });
  expect((await sharing("true")).status).toBe(400);
  expect((await sharing(true)).status).toBe(200);
  const admin = await pair(hub), guest = await pair(hub);
  const identities = await Promise.all([admin, guest].map(async token => (await (await controllerApi(hub, token, "/api/controllers/me")).json()).controller));
  expect(identities.map(controller => controller.role)).toEqual(["administrator", "controller"]);
  const remembered = (await (await controllerApi(hub, hostToken, "/api/controllers")).json()).controllers;
  for (const token of [admin, guest]) expect((await sharing(false, token)).status).toBe(403);
  const host = new Peer(hub, hostToken), one = new Peer(hub, admin), two = new Peer(hub, guest);
  await Promise.all([host.ready(), one.ready(), two.ready()]);
  hub.session.observe(idle);
  await one.command({ type: "enqueue", entry: { id: "sharing-track", title: "Local track", source: "https://media.example/track.mp3" } });
  await one.command({ type: "play", entryId: "sharing-track" });
  const playing = { ...hub.session.state.player, status: "playing" as const };
  hub.session.observe(playing);
  const queue = hub.session.state.queue, commands = [...initial.commands];
  const disconnected = [one, two].map(peer => new Promise<number>(resolve => peer.socket.addEventListener("close", event => resolve(event.code), { once: true })));
  expect((await sharing(false)).status).toBe(200);
  expect(await Promise.all(disconnected)).toEqual([4003, 4003]);
  expect(initial.commands).toEqual(commands);
  expect(hub.session.state.player).toEqual(playing);
  expect(hub.session.state.queue).toEqual(queue);
  expect(host.socket.readyState).toBe(WebSocket.OPEN);
  for (const token of [admin, guest]) for (const path of ["/api/controllers/me", "/api/build", "/api/profiles"]) expect((await controllerApi(hub, token, path)).status).toBe(503);
  expect((await pairing()).status).toBe(503);
  expect((await (await controllerApi(hub, hostToken, "/api/controllers")).json()).controllers).toEqual(remembered);
  expect((await sharing(true)).status).toBe(200);
  const reconnected = new Peer(hub, admin);
  await reconnected.ready();
  expect(reconnected.state.queue).toEqual(queue);
  expect((await sharing(false)).status).toBe(200);
  await hub.close(); hubs.splice(hubs.indexOf(hub), 1);
  const restarted = fixture(initial.databasePath, undefined, undefined, { remoteControlEnabled: true });
  expect(await (await controllerApi(restarted.hub, hostToken, "/api/settings/sharing")).json()).toEqual({ enabled: false });
  expect(restarted.hub.session.state.queue).toEqual(queue);
  expect(restarted.commands).toEqual([]);
  expect((await (await controllerApi(restarted.hub, hostToken, "/api/controllers")).json()).controllers).toEqual(remembered);
  expect((await controllerApi(restarted.hub, hostToken, "/api/settings/sharing", "POST", { enabled: true })).status).toBe(200);
  expect((await controllerApi(restarted.hub, admin, "/api/controllers/me")).status).toBe(200);
});

test("trial admission rejects local sharing before reading its body", async () => {
  const { hub, databasePath, commands } = fixture(undefined, undefined, () => false, { remoteControlEnabled: false });
  const request = new Request(`${hub.origin}/api/settings/sharing`, {
    method: "POST", headers: { Host: new URL(hub.origin).host, Origin: "tauri://localhost", Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  expect((await hub.server.fetch(request)).status).toBe(503);
  expect(request.bodyUsed).toBe(false);
  expect(await (await controllerApi(hub, hostToken, "/api/settings/sharing")).json()).toEqual({ enabled: false });
  expect((await controllerApi(hub, hostToken, "/api/build")).status).toBe(200);
  const db = new Database(databasePath, { readonly: true });
  try {
    expect(db.query("SELECT enabled FROM installation_sharing").get()).toEqual({ enabled: 0 });
    expect(db.query("SELECT * FROM devices").all()).toEqual([]);
  } finally { db.close(); }
  expect(commands).toEqual([]);
});

test.each(["maintenance", "restart", "shutdown"])("local sharing cannot save after %s while its request body is pending", async mode => {
  let open = true;
  const { hub, databasePath, commands } = fixture(undefined, undefined, () => open);
  const host = new Peer(hub, hostToken), remote = new Peer(hub, await pair(hub));
  await Promise.all([host.ready(), remote.ready()]);
  const db = new Database(databasePath, { readonly: true });
  const remembered = db.query("SELECT * FROM devices ORDER BY id").all();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const request = new Request(`${hub.origin}/api/settings/sharing`, {
    method: "POST", headers: { Host: new URL(hub.origin).host, Origin: "tauri://localhost", Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" },
    body: new ReadableStream({ async pull(controller) {
      entered.resolve();
      await release.promise;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ enabled: false })));
      controller.close();
    } }, { highWaterMark: 0 }),
  });
  try {
    const pending = hub.server.fetch(request);
    await entered.promise;
    if (mode === "maintenance") open = false;
    else if (mode === "restart") hub.prepareRestart();
    else await hub.close();
    const state = JSON.stringify(hub.session.state), sent = [...commands];
    release.resolve();
    expect((await pending).status).toBe(503);
    expect(db.query("SELECT enabled FROM installation_sharing").get()).toEqual({ enabled: 1 });
    expect(db.query("SELECT * FROM devices ORDER BY id").all()).toEqual(remembered);
    expect(JSON.stringify(hub.session.state)).toBe(state);
    expect(commands).toEqual(sent);
    if (mode !== "shutdown") {
      expect(host.socket.readyState).toBe(WebSocket.OPEN);
      expect(remote.socket.readyState).toBe(WebSocket.OPEN);
      if (mode === "maintenance") {
        open = true;
        expect(await remote.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
        await host.waitFor(message => message.type === "state" && message.state.player.volume === 32);
      }
    }
  } finally { release.resolve(); db.close(); }
});

test("local management works before pairing and the next role depends on remembered remotes", async () => {
  const { hub } = fixture();
  expect((await controllerApi(hub, hostToken, "/api/settings", "POST", { name: "Personal computer" })).status).toBe(200);
  expect((await controllerApi(hub, hostToken, "/api/settings/setup", "POST", { step: "general" })).status).toBe(200);
  const owner = await pair(hub), guest = await pair(hub);
  const controller = async (token: string) => (await (await controllerApi(hub, token, "/api/controllers/me")).json()).controller as { id: string; role: string };
  const first = await controller(owner), second = await controller(guest);
  expect(first.role).toBe("administrator");
  expect((await controllerApi(hub, owner, `/api/controllers/${first.id}`, "DELETE")).status).toBe(200);
  const newcomer = await pair(hub), third = await controller(newcomer);
  expect(third.role).toBe("controller");
  expect((await controllerApi(hub, newcomer, `/api/controllers/${third.id}/role`, "POST", { role: "administrator" })).status).toBe(403);
  expect((await controllerApi(hub, hostToken, `/api/controllers/${third.id}/role`, "POST", { role: "administrator" })).status).toBe(200);
  for (const id of [second.id, third.id]) expect((await controllerApi(hub, hostToken, `/api/controllers/${id}`, "DELETE")).status).toBe(200);
  expect((await controller(await pair(hub))).role).toBe("administrator");
});

test("public installation identity binds pairing to one installation and survives restart", async () => {
  const first = fixture(), other = fixture();
  const connection = async (hub: Hub) => (await fetch(`${hub.origin}/api/connection`)).json() as Promise<{ installationId: string }>;
  const original = await connection(first.hub);
  expect(original.installationId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  expect((await connection(other.hub)).installationId).not.toBe(original.installationId);
  const paired = await fetch(`${first.hub.origin}/api/pair`, { method: "POST", headers: { Origin: first.hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: first.hub.pairingCode }) });
  expect(paired.status).toBe(200);
  expect((await paired.json()).installationId).toBe(original.installationId);
  await first.hub.close(); hubs.splice(hubs.indexOf(first.hub), 1);
  expect((await connection(fixture(first.databasePath).hub)).installationId).toBe(original.installationId);
});
