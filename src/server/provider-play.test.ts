import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Action, PlaybackCommand, PlayerState, ServerMessage } from "../shared/protocol";
import type { ProviderPage } from "../shared/providers";
import { createHub, type Hub } from "./hub";
import * as providers from "./providers";
import * as webMedia from "./web-media";

const hostToken = "private-host-token-for-provider-regressions-123456789";
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
const page: ProviderPage = { items: ["abcdefghijk", "zyxwvutsrqp"].map((id, index) => ({ id, title: `Episode ${index + 1}`, provider: "youtube", kind: "media", url: `https://www.youtube.com/watch?v=${id}` })) };
const source = "https://private-stream.example/signed";
const atom = { type: "enqueueProvider", provider: "youtube", shape: "atom", url: page.items[0]!.url, title: "Episode 1", quality: "720p" } as const;
const list = { ...atom, shape: "playlist", url: "https://www.youtube.com/playlist?list=PL1234567890" } as const;
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const fixtures: Array<{ hub: Hub; directory: string; sockets: WebSocket[] }> = [];

// Exercise the public pairing/WebSocket boundary and record the private native
// commands, just as hub.test.ts does. No provider network or native decoder runs.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-provider-play-"));
  const commands: PlaybackCommand[] = [];
  const listeners = new Set<() => void>();
  const sockets: WebSocket[] = [];
  const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: join(directory, "state.sqlite"), hostToken, pairingCode: "123456", sendPlayer(command) { commands.push(command); for (const listener of listeners) listener(); } });
  fixtures.push({ hub, directory, sockets });
  hub.session.observe(idle);
  const api = (token: string, path: string, method = "GET") => fetch(`${hub.origin}${path}`, { method, headers: { Origin: hub.origin, Authorization: `Bearer ${token}` } });
  async function remote() {
    const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { Origin: hub.origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode }) });
    expect(response.status).toBe(200);
    const { token } = await response.json() as { token: string };
    const socket = new BunWebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${encodeURIComponent(token)}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    const changed = new Set<() => void>();
    socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))); for (const listener of changed) listener(); });
    const waitFor = (predicate: (message: ServerMessage) => boolean) => wait(changed, () => messages.findLast(predicate));
    await waitFor(message => message.type === "state");
    return { token, socket, messages, waitFor, command(action: Action) {
      const requestId = crypto.randomUUID();
      const result = waitFor(message => message.type === "result" && message.requestId === requestId);
      socket.send(JSON.stringify({ type: "command", requestId, action }));
      return result;
    } };
  }
  return { hub, commands, api, remote, waitForLoad: () => wait(listeners, () => commands.findLast(command => command.type === "load" && command.source === source)) };
}

function wait<T>(listeners: Set<() => void>, read: () => T | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error("Provider regression timed out waiting for an observable result.")); }, 2_000);
    const check = () => { const value = read(); if (value !== undefined) { clearTimeout(timeout); listeners.delete(check); resolve(value); } };
    listeners.add(check); check();
  });
}

afterEach(async () => {
  for (const { hub, directory, sockets } of fixtures.splice(0)) {
    for (const socket of sockets) socket.close();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const shape of ["atom", "playlist"] as const) test.each([false, true])(`generic provider ${shape}, playNow=%s, queues once and preserves playback intent`, async playNow => {
  const expand = spyOn(providers, "loadProviderList").mockResolvedValue(page);
  const resolve = spyOn(webMedia, "resolveWebMedia").mockResolvedValue({ source, headers: { Authorization: "private-resolver-token" } });
  try {
    const { hub, commands, remote, waitForLoad } = fixture();
    const first = await remote(), second = await remote();
    expect(await first.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" }, playNow: true })).toMatchObject({ ok: true });
    expect(await first.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: "https://media.example/waiting" } })).toMatchObject({ ok: true });
    const result = await first.command({ ...(shape === "atom" ? atom : list), playNow });
    expect(result).toMatchObject({ type: "result", ok: true });
    const added = hub.session.state.queue.filter(entry => entry.source.startsWith("web:"));
    expect(added.map(entry => [entry.title, entry.source, entry.quality])).toEqual(page.items.slice(0, shape === "atom" ? 1 : 2).map(item => [item.title, `web:${item.url}`, "720p"]));
    expect(new Set(hub.session.state.queue.map(entry => entry.id)).size).toBe(added.length + 2);
    expect(added.every(entry => !page.items.some(item => item.id === entry.id))).toBe(true);
    expect(hub.session.state.currentEntryId).toBe(playNow ? added[0]!.id : "current");
    expect(hub.session.state.queue.map(entry => entry.title)).toEqual(playNow ? ["Current", ...added.map(entry => entry.title), "Waiting"] : ["Current", "Waiting", ...added.map(entry => entry.title)]);
    if (playNow) await waitForLoad();
    expect(commands.filter(command => command.type === "load" && command.source === source)).toHaveLength(playNow ? 1 : 0);
    expect(resolve).toHaveBeenCalledTimes(playNow ? 1 : 0);
    expect(expand).toHaveBeenCalledTimes(shape === "playlist" ? 1 : 0);
    await second.waitFor(message => message.type === "state" && message.state.queue.length === added.length + 2 && message.state.currentEntryId === hub.session.state.currentEntryId);
    expect(JSON.stringify(second.messages)).not.toContain("private-stream");
    expect(JSON.stringify(second.messages)).not.toContain("private-resolver-token");
    if (result.type !== "result") throw new Error("Expected command confirmation");
    expect(first.messages.filter(message => message.type === "result" && message.requestId === result.requestId)).toHaveLength(1);
  } finally { expand.mockRestore(); resolve.mockRestore(); }
});

for (const replacement of ["stop", "play"] as const) test(`a newer ${replacement} cancels delayed generic provider playlist playback, not its queue addition`, async () => {
  const entered = Promise.withResolvers<void>(), output = Promise.withResolvers<ProviderPage>();
  const expand = spyOn(providers, "loadProviderList").mockImplementation(async () => { entered.resolve(); return output.promise; });
  try {
    const { hub, commands, remote } = fixture();
    const first = await remote(), second = await remote();
    expect(await second.command({ type: "enqueue", entry: { id: "replacement", title: "Replacement", source: "https://media.example/replacement" } })).toMatchObject({ ok: true });
    const pending = first.command({ ...list, playNow: true });
    await entered.promise;
    expect(await second.command(replacement === "stop" ? { type: "stop" } : { type: "play", entryId: "replacement" })).toMatchObject({ ok: true });
    output.resolve(page);
    expect(await pending).toMatchObject({ ok: false, error: "Added to the queue. Playback was canceled by a newer control." });
    expect(hub.session.state.queue.map(entry => entry.title)).toEqual(["Replacement", "Episode 1", "Episode 2"]);
    expect(hub.session.state.currentEntryId).toBe(replacement === "stop" ? null : "replacement");
    expect(commands.filter(command => command.type === "load")).toHaveLength(replacement === "stop" ? 0 : 1);
  } finally { output.resolve(page); expand.mockRestore(); }
});

for (const replacement of ["stop", "play"] as const) test(`a newer ${replacement} cancels delayed generic provider atom resolution`, async () => {
  const entered = Promise.withResolvers<void>(), output = Promise.withResolvers<Awaited<ReturnType<typeof webMedia.resolveWebMedia>>>();
  const resolve = spyOn(webMedia, "resolveWebMedia").mockImplementation(async () => { entered.resolve(); return output.promise; });
  try {
    const { hub, commands, remote } = fixture();
    const first = await remote(), second = await remote();
    expect(await second.command({ type: "enqueue", entry: { id: "replacement", title: "Replacement", source: "https://media.example/replacement" } })).toMatchObject({ ok: true });
    expect(await first.command({ ...atom, playNow: true })).toMatchObject({ ok: true });
    const entry = hub.session.state.queue.find(entry => entry.source === `web:${atom.url}`)!;
    expect(hub.session.state.currentEntryId).toBe(entry.id);
    await entered.promise;
    expect(await second.command(replacement === "stop" ? { type: "stop" } : { type: "play", entryId: "replacement" })).toMatchObject({ ok: true });
    output.resolve({ source, metadata: { title: "Late metadata" } });
    expect(await second.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBe(replacement === "stop" ? null : "replacement");
    expect(hub.session.state.queue.find(item => item.id === entry.id)?.title).toBe("Episode 1");
    expect(commands.filter(command => command.type === "load" && command.source === source)).toEqual([]);
  } finally { output.resolve({ source }); resolve.mockRestore(); }
});

test("revoking the sender while a generic provider list resolves prevents any late queue or playback mutation", async () => {
  const entered = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>(), output = Promise.withResolvers<ProviderPage>();
  const expand = spyOn(providers, "loadProviderList").mockImplementation(async () => { entered.resolve(); const value = await output.promise; finished.resolve(); return value; });
  try {
    const { hub, commands, api, remote } = fixture();
    const observer = await remote(), sender = await remote();
    const { controller } = await (await api(sender.token, "/api/controllers/me")).json() as { controller: { id: string } };
    sender.socket.send(JSON.stringify({ type: "command", requestId: "revoked-list", action: { ...list, playNow: true } }));
    await entered.promise;
    const closed = new Promise<number>(resolve => sender.socket.addEventListener("close", event => resolve(event.code), { once: true }));
    expect((await api(hostToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    expect(await closed).toBe(4001);
    output.resolve(page); await finished.promise;
    expect(await observer.command({ type: "volume", volume: 32 })).toMatchObject({ ok: true });
    expect(hub.session.state.queue).toEqual([]);
    expect(hub.session.state.currentEntryId).toBeNull();
    expect(commands.filter(command => command.type === "load")).toEqual([]);
  } finally { output.resolve(page); expand.mockRestore(); }
});

test("revoking the sender during generic provider atom resolution prevents native load and late metadata", async () => {
  const entered = Promise.withResolvers<void>(), output = Promise.withResolvers<Awaited<ReturnType<typeof webMedia.resolveWebMedia>>>();
  const resolve = spyOn(webMedia, "resolveWebMedia").mockImplementation(async () => { entered.resolve(); return output.promise; });
  try {
    const { hub, commands, api, remote } = fixture();
    const observer = await remote(), sender = await remote();
    const { controller } = await (await api(sender.token, "/api/controllers/me")).json() as { controller: { id: string } };
    expect(await sender.command({ ...atom, playNow: true })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBe(hub.session.state.queue[0]!.id);
    await entered.promise;
    expect((await api(hostToken, `/api/controllers/${controller.id}`, "DELETE")).status).toBe(200);
    output.resolve({ source, metadata: { title: "Late metadata" } });
    await observer.waitFor(message => message.type === "state" && !!message.state.player.error?.includes("revoked"));
    expect(hub.session.state.queue[0]!.title).toBe("Episode 1");
    expect(commands.filter(command => command.type === "load")).toEqual([]);
  } finally { output.resolve({ source }); resolve.mockRestore(); }
});

// Retain these public-boundary characterizations when intake ownership changes.
test.each(["atom", "playlist"] as const)("adding the same provider %s twice creates distinct occurrences without playing", async shape => {
  const expand = spyOn(providers, "loadProviderList").mockResolvedValue(page);
  try {
    const { hub, commands, remote } = fixture();
    const sender = await remote(), observer = await remote();
    const action = shape === "atom" ? atom : list;
    expect(await sender.command(action)).toMatchObject({ ok: true });
    const first = hub.session.state.queue;
    expect(await sender.command(action)).toMatchObject({ ok: true });
    const queue = hub.session.state.queue;
    expect(queue.map(entry => entry.source)).toEqual([...first, ...first].map(entry => entry.source));
    expect(queue.slice(0, first.length)).toEqual(first);
    expect(new Set(queue.map(entry => entry.id)).size).toBe(first.length * 2);
    expect(queue.every(entry => entry.quality === "720p")).toBe(true);
    expect(hub.session.state.currentEntryId).toBeNull();
    expect(commands.filter(command => command.type === "load")).toEqual([]);
    await observer.waitFor(message => message.type === "state" && message.state.queue.length === queue.length);
    const snapshot = observer.messages.findLast(message => message.type === "state");
    expect(snapshot).toMatchObject({ state: { queue, currentEntryId: null } });
  } finally { expand.mockRestore(); }
});

test("provider list expansion failure preserves current playback and waiting queue", async () => {
  const expand = spyOn(providers, "loadProviderList").mockRejectedValue(new Error("Provider unavailable"));
  try {
    const { hub, commands, remote } = fixture();
    const sender = await remote();
    expect(await sender.command({ type: "enqueue", entry: { id: "current", title: "Current", source: "https://media.example/current" }, playNow: true })).toMatchObject({ ok: true });
    expect(await sender.command({ type: "enqueue", entry: { id: "waiting", title: "Waiting", source: "https://media.example/waiting" } })).toMatchObject({ ok: true });
    const previous = hub.session.state, sent = [...commands];
    expect(await sender.command({ ...list, playNow: true })).toMatchObject({ ok: false, error: "Provider unavailable" });
    expect(hub.session.state.queue).toEqual(previous.queue);
    expect(hub.session.state.currentEntryId).toBe(previous.currentEntryId);
    expect(hub.session.state.player.playbackId).toBe(previous.player.playbackId);
    expect(commands).toEqual(sent);
  } finally { expand.mockRestore(); }
});

test("a queue-only provider atom does not cancel another remote's pending list Play", async () => {
  const entered = Promise.withResolvers<void>(), output = Promise.withResolvers<ProviderPage>();
  const expand = spyOn(providers, "loadProviderList").mockImplementation(async () => { entered.resolve(); return output.promise; });
  const resolve = spyOn(webMedia, "resolveWebMedia").mockResolvedValue({ source });
  try {
    const { hub, commands, remote, waitForLoad } = fixture();
    const first = await remote(), second = await remote();
    const pending = first.command({ ...list, playNow: true });
    await entered.promise;
    expect(await second.command({ ...atom, title: "Later", playNow: false })).toMatchObject({ ok: true });
    expect(hub.session.state.currentEntryId).toBeNull();
    output.resolve(page);
    expect(await pending).toMatchObject({ ok: true });
    await waitForLoad();
    expect(hub.session.state.queue.map(entry => entry.title)).toEqual(["Episode 1", "Episode 2", "Later"]);
    expect(hub.session.state.currentEntryId).toBe(hub.session.state.queue[0]!.id);
    expect(commands.filter(command => command.type === "load")).toHaveLength(1);
  } finally { output.resolve(page); expand.mockRestore(); resolve.mockRestore(); }
});

test("back-to-back provider atom and Stop keep the admitted atom but finish stopped", async () => {
  const resolve = spyOn(webMedia, "resolveWebMedia").mockResolvedValue({ source });
  try {
    const { hub, commands, remote } = fixture();
    const sender = await remote();
    sender.socket.send(JSON.stringify({ type: "command", requestId: "ordered-atom", action: { ...atom, playNow: true } }));
    sender.socket.send(JSON.stringify({ type: "command", requestId: "ordered-stop", action: { type: "stop" } }));
    expect(await sender.waitFor(message => message.type === "result" && message.requestId === "ordered-atom")).toMatchObject({ ok: true });
    expect(await sender.waitFor(message => message.type === "result" && message.requestId === "ordered-stop")).toMatchObject({ ok: true });
    expect(hub.session.state.queue).toHaveLength(1);
    expect(hub.session.state.queue[0]!.source).toBe(`web:${atom.url}`);
    expect(hub.session.state.currentEntryId).toBeNull();
    expect(hub.session.state.player.playbackId).toBeNull();
    expect(commands.at(-1)).toEqual({ type: "stop" });
  } finally { resolve.mockRestore(); }
});

test("shutdown aborts a generic list before its completion can append or play", async () => {
  const entered = Promise.withResolvers<AbortSignal>(), finished = Promise.withResolvers<void>();
  const expand = spyOn(providers, "loadProviderList").mockImplementation(async (_provider, _url, signal) => {
    entered.resolve(signal!);
    await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
    finished.resolve();
    return page;
  });
  try {
    const { hub, commands, remote } = fixture();
    const sender = await remote();
    sender.socket.send(JSON.stringify({ type: "command", requestId: "shutdown-list", action: { ...list, playNow: true } }));
    const signal = await entered.promise;
    await hub.close();
    await finished.promise;
    expect(signal.aborted).toBe(true);
    expect(hub.session.state.queue).toEqual([]);
    expect(hub.session.state.currentEntryId).toBeNull();
    expect(commands.filter(command => command.type === "load")).toEqual([]);
  } finally { expand.mockRestore(); }
});
