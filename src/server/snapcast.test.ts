import { expect, test } from "bun:test";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapcast } from "./snapcast";
import type { PlaybackTarget, PlayerState } from "../shared/protocol";

function fixture(options: { pcmPort?: number; ffmpeg?: string } = {}) {
  const client = (id: string) => ({ id, connected: true, host: { name: id }, config: { latency: 0, volume: { percent: 100, muted: false } } });
  const state = { server: { snapserver: { version: "0.35.0" } }, groups: [{ id: "owned", stream_id: "couch", clients: [client("one"), client("two")] }, { id: "idle", stream_id: "silence", clients: [client("three")] }, { id: "foreign", stream_id: "another-owner", clients: [client("private")] }], streams: [{ id: "couch", status: "idle", uri: { scheme: "tcp", host: `127.0.0.1:${options.pcmPort ?? 1}`, query: { sampleformat: "48000:16:2", codec: "pcm", chunk_ms: "20" } } }, { id: "silence", status: "idle", uri: { scheme: "tcp", host: "127.0.0.1", query: {} } }] };
  const calls: { method: string; params: any }[] = [];
  const sockets = new Set<any>();
  const server = Bun.serve({ port: 0, fetch(request, server) { if (server.upgrade(request)) return; return new Response(null, { status: 400 }); }, websocket: {
    open(socket) { sockets.add(socket); }, close(socket) { sockets.delete(socket); },
    message(socket, data) {
      const request = JSON.parse(String(data)); calls.push(request);
      const { method, params } = request;
      if (method === "Group.SetStream") state.groups.find(group => group.id === params.id)!.stream_id = params.stream_id;
      if (method === "Group.SetClients") {
        const owned = state.groups.find(group => group.id === params.id)!;
        const all = state.groups.flatMap(group => group.clients);
        const removed = owned.clients.filter(client => !params.clients.includes(client.id));
        for (const group of state.groups) group.clients = group.clients.filter(client => !params.clients.includes(client.id) && !removed.includes(client));
        owned.clients = all.filter(client => params.clients.includes(client.id));
        for (const client of removed) state.groups.push({ id: `detached-${client.id}`, stream_id: owned.stream_id, clients: [client] });
      }
      if (method === "Client.SetVolume") state.groups.flatMap(group => group.clients).find(client => client.id === params.id)!.config.volume = params.volume;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: method === "Server.GetStatus" ? { server: state } : {} }));
    },
  } });
  const targets: PlaybackTarget[] = [], players: PlayerState[] = [];
  const adapter = createSnapcast({ controlUrl: `ws://127.0.0.1:${server.port}/jsonrpc?private-token=hidden`, groupId: "owned", streamId: "couch", idleStreamId: "silence", name: "Rooms", pcmHost: "127.0.0.1", pcmPort: options.pcmPort ?? 1, bufferMs: 500, drainMs: 750, ffmpeg: options.ffmpeg }, { changed: target => targets.push(structuredClone(target)), observe: player => players.push(player) });
  return { state, calls, targets, players, adapter, notify() { for (const socket of sockets) socket.send(JSON.stringify({ jsonrpc: "2.0", method: "Server.OnUpdate", params: {} })); }, disconnect() { for (const socket of sockets) socket.close(); }, async close() { await adapter.close(); await server.stop(true); } };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out waiting for Snapcast state"); await Bun.sleep(10); }
}

test("Snapcast reconciles real RPC responses, isolates credentials, and silences detached members", async () => {
  const f = fixture();
  try {
    expect(f.targets[0]?.connected).toBe(false);
    await until(() => f.targets.at(-1)?.connected === true);
    expect(f.targets.at(-1)?.members?.map(member => member.id)).toEqual(["one", "two", "three"]);
    expect(JSON.stringify(f.targets)).not.toContain("private-token");
    expect(JSON.stringify(f.targets)).not.toContain("private\"");
    await f.adapter.setMemberVolume("one", 30, true);
    expect(f.targets.at(-1)?.members?.find(member => member.id === "one")).toMatchObject({ volume: 30, muted: true });
    await f.adapter.setMembers(["one", "three"]);
    expect(f.state.groups.find(group => group.id === "detached-two")?.stream_id).toBe("silence");
    expect(f.targets.at(-1)?.members?.filter(member => member.joined).map(member => member.id)).toEqual(["one", "three"]);
    const calls = f.calls.length; await Bun.sleep(50); expect(f.calls.length).toBe(calls);
    f.disconnect(); await until(() => f.players.at(-1)?.status === "unavailable");
    expect(f.targets.at(-1)?.connected).toBe(false);
    expect(() => f.adapter.send({ type: "stop" })).toThrow("disconnected");
  } finally { await f.close(); }
});

test("Snapcast refuses active foreign members without mutating their group", async () => {
  const f = fixture();
  try {
    await until(() => f.targets.at(-1)?.connected === true);
    await expect(f.adapter.setMembers(["one", "private"])).rejects.toThrow("idle speakers");
    expect(f.calls.some(call => call.method === "Group.SetClients")).toBe(false);
    expect(f.state.groups.find(group => group.id === "foreign")?.stream_id).toBe("another-owner");
  } finally { await f.close(); }
});

test("Snapcast invalidates the qualified bound on external latency changes", async () => {
  const f = fixture();
  try {
    await until(() => f.targets.at(-1)?.connected === true);
    f.state.groups[0]!.clients[0]!.config.latency = 100;
    f.notify(); await until(() => f.players.at(-1)?.status === "unavailable");
    expect(f.targets.at(-1)?.connected).toBe(false);
    expect(f.players.at(-1)?.error).toContain("latency");
    expect(f.targets.at(-1)?.error).toContain("latency");
    f.state.groups[0]!.clients[0]!.config.latency = 0;
    await f.adapter.reconnect();
    expect(f.targets.at(-1)?.connected).toBe(true);
    expect(f.players.at(-1)?.status).toBe("idle");
    expect(f.targets.at(-1)?.error).toBeUndefined();
  } finally { await f.close(); }
});

test("Snapcast limits the qualified producer and control connection to loopback", () => {
  const config = { controlUrl: "ws://192.168.1.10:1780/jsonrpc", groupId: "owned", streamId: "couch", idleStreamId: "silence", name: "Rooms", pcmHost: "127.0.0.1", pcmPort: 4953, bufferMs: 500 as const, drainMs: 750 as const };
  const callbacks = { changed() {}, observe() {} };
  expect(() => createSnapcast(config, callbacks)).toThrow("configuration");
  expect(() => createSnapcast({ ...config, controlUrl: "ws://localhost:1780/jsonrpc", pcmHost: "192.168.1.10" }, callbacks)).toThrow("configuration");
});

test("a fast resolved load waits for the preceding stop drain without losing playback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-snapcast-"));
  const executable = join(directory, "pcm-decoder");
  await Bun.write(executable, `#!${process.execPath}\nconst url = new URL(process.argv.at(-1));\nconst socket = await Bun.connect({hostname:url.hostname, port:Number(url.port), socket:{data(){}, error(){process.exit(1)}, close(){process.exit(0)}}});\nfor (;;) { socket.write(new Uint8Array(3840).fill(1)); await Bun.sleep(20); }\n`);
  await chmod(executable, 0o755);
  let received = 0;
  const sockets = new Set<any>();
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(socket) { sockets.add(socket); }, close(socket) { sockets.delete(socket); }, data(_socket, bytes) { received += bytes.length; } } });
  const f = fixture({ pcmPort: listener.port, ffmpeg: executable });
  try {
    await until(() => f.targets.at(-1)?.connected === true);
    f.adapter.send({ type: "load", playbackId: "old", source: "https://example.com/audio" });
    await until(() => received >= 3840 && f.players.at(-1)?.status === "playing");
    f.adapter.send({ type: "stop" });
    await Bun.sleep(10); // The previous producer has written and must drain for 750ms.
    const next = await Promise.resolve({ type: "load" as const, playbackId: "new", source: "https://example.com/new", paused: true });
    expect(() => f.adapter.send(next)).not.toThrow();
    await until(() => f.players.at(-1)?.playbackId === "new" && f.players.at(-1)?.status === "paused");
    expect(f.targets.at(-1)?.connected).toBe(true);
    expect(f.players.some(player => player.status === "unavailable")).toBe(false);
  } finally {
    await f.close();
    for (const socket of sockets) socket.terminate();
    listener.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
