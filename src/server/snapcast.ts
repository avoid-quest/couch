import type { PlaybackCommand, PlaybackTarget, PlayerState } from "../shared/protocol";
import { createPcmProducer } from "./pcm-producer";

export type SnapcastConfig = { controlUrl: string; streamId: string; idleStreamId: string; groupId: string; name: string; pcmHost: string; pcmPort: number; bufferMs: 500; drainMs: 750; ffmpeg?: string };
type Client = { id: string; connected: boolean; host?: { name?: string }; config: { name?: string; latency: number; volume: { percent: number; muted: boolean } } };
type Group = { id: string; stream_id: string; clients: Client[] };
type Snapshot = { groups: Group[]; streams: { id: string; status: string; uri: { scheme: string; host: string; query: Record<string, string> } }[]; server: { snapserver: { version: string } } };
const idle = (): PlayerState => ({ playbackId: null, status: "idle", position: 0, duration: null, volume: 100, seekable: false, error: null });

export function validateSnapcastConfig(config: SnapcastConfig): void {
  for (const value of [config.name, config.groupId, config.streamId, config.idleStreamId]) if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid Snapcast name or identifier.");
  const url = new URL(config.controlUrl);
  const loopback = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
  if (config.pcmHost === "[::1]" || !loopback.has(config.pcmHost) || !loopback.has(url.hostname) || !["ws:", "wss:"].includes(url.protocol) || url.pathname !== "/jsonrpc" || !!url.hash || config.bufferMs !== 500 || config.drainMs !== 750 || config.streamId === config.idleStreamId || !Number.isInteger(config.pcmPort) || config.pcmPort < 1 || config.pcmPort > 65535) throw new Error("Invalid qualified Snapcast configuration.");
}

// Snapcast owns member synchronization. The configured drain is a qualified bound,
// not a physical output acknowledgement; ordinary clients never receive RPC URLs.
export function createSnapcast(config: SnapcastConfig, callbacks: { changed: (target: PlaybackTarget) => void; observe: (player: PlayerState) => void }) {
  validateSnapcastConfig(config);
  let socket: WebSocket | undefined;
  let closed = false;
  let connected = false;
  let generation = 0;
  let playbackGeneration = 0;
  let sequence = 0;
  let state = idle();
  let snapshot: Snapshot | undefined;
  let members: NonNullable<PlaybackTarget["members"]> = [];
  let tail = Promise.resolve();
  let queued = 0;
  let refreshQueued = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let opening: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const publish = () => callbacks.changed({ id: "snapcast-group", name: config.name, kind: "group", backend: "snapcast", connected, error: connected ? undefined : state.error ?? undefined, handoffSafety: "buffer-drain", members });
  const makeProducer = () => createPcmProducer({ host: config.pcmHost, port: config.pcmPort, bufferMs: config.bufferMs, drainMs: config.drainMs, ffmpeg: config.ffmpeg,
    observe(player) { if (!closed && connected) { state = { ...player, volume: state.volume }; if (player.status === "error") fail(player.error || "Snapcast audio output is uncertain. Restart the connection before retrying."); else callbacks.observe(state); } },
  });
  let producer = makeProducer();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (queued >= 32) return Promise.reject(new Error("Too many pending Snapcast commands."));
    queued++;
    const work = tail.then(operation).finally(() => { queued--; });
    tail = work.then(() => {}, () => {});
    return work;
  };
  const rpc = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    if (closed || socket?.readyState !== WebSocket.OPEN) { reject(new Error("Snapcast is disconnected.")); return; }
    if (pending.size >= 32) { reject(new Error("Too many Snapcast requests.")); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Snapcast did not respond.")); }, 3000);
    pending.set(id, { resolve, reject, timer });
    try { socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }
    catch { clearTimeout(timer); pending.delete(id); reject(new Error("Snapcast is disconnected.")); }
  });
  const fail = (message: string, retry = false) => {
    if (closed) return;
    generation++; playbackGeneration++;
    connected = false;
    members = members.map(member => ({ ...member, connected: false }));
    state = { ...state, status: "unavailable", error: message };
    publish(); callbacks.observe(state);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
    if (opening) clearTimeout(opening);
    const previous = socket; socket = undefined; previous?.close();
    producer.cancel();
    tail = tail.then(() => producer.send({ type: "stop" })).catch(() => {});
    if (retry && !reconnect) reconnect = setTimeout(() => { reconnect = undefined; connect(); }, 2000);
  };
  const inspect = (value: unknown): Snapshot => {
    const result = value as Snapshot;
    if (!result || !Array.isArray(result.groups) || result.groups.length > 128 || !Array.isArray(result.streams) || result.streams.length > 128 || result.server?.snapserver?.version !== "0.35.0") throw new Error("Snapcast requires the qualified server version 0.35.0.");
    const stream = result.streams.find(item => item.id === config.streamId);
    if (!stream || stream.uri?.scheme !== "tcp" || Number(new URL(`tcp://${stream.uri.host}`).port || 4953) !== config.pcmPort || stream.uri.query?.sampleformat !== "48000:16:2" || stream.uri.query?.codec !== "pcm" || stream.uri.query?.chunk_ms !== "20" || !result.streams.some(item => item.id === config.idleStreamId && item.status === "idle")) throw new Error("Snapcast requires the configured PCM and idle streams.");
    let count = 0;
    const ids = new Set<string>();
    for (const group of result.groups) {
      if (typeof group.id !== "string" || typeof group.stream_id !== "string" || !Array.isArray(group.clients)) throw new Error("Invalid Snapcast topology.");
      for (const client of group.clients) {
        if (++count > 32 || typeof client.id !== "string" || ids.has(client.id) || typeof client.connected !== "boolean" || !client.config || !Number.isFinite(client.config.volume?.percent) || typeof client.config.volume?.muted !== "boolean") throw new Error("Invalid Snapcast members.");
        ids.add(client.id);
        if (group.id === config.groupId && client.config.latency !== 0) throw new Error("Snapcast member latency changed; the drain bound is unavailable.");
      }
    }
    const group = result.groups.find(item => item.id === config.groupId);
    if (!group || ![config.streamId, config.idleStreamId].includes(group.stream_id)) throw new Error("The configured Snapcast group belongs to another stream.");
    return result;
  };
  const read = async () => inspect((await rpc("Server.GetStatus")).server);
  const apply = (next: Snapshot) => {
    snapshot = next;
    members = next.groups.flatMap(group => group.clients.filter(client => group.id === config.groupId || group.stream_id === config.idleStreamId && client.connected && client.config.latency === 0).map(client => ({ id: client.id, name: client.config.name || client.host?.name || client.id, connected: client.connected, volume: client.config.volume.percent, muted: client.config.volume.muted, joined: group.id === config.groupId })));
    const joined = members.filter(member => member.joined);
    const volume = joined.length ? Math.round(joined.reduce((total, member) => total + member.volume, 0) / joined.length) : 100;
    if (connected && state.volume !== volume) { state = { ...state, volume }; callbacks.observe(state); }
    publish();
  };
  const check = () => { if (closed || !connected) throw new Error("Snapcast is disconnected."); };
  const refresh = () => {
    if (refreshQueued || !connected) return;
    refreshQueued = true;
    void enqueue(async () => {
      try {
        check(); const next = await read();
        const before = snapshot!.groups.find(group => group.id === config.groupId)!;
        const after = next.groups.find(group => group.id === config.groupId)!;
        if (after.stream_id !== config.streamId || before.clients.map(client => client.id).sort().join("\0") !== after.clients.map(client => client.id).sort().join("\0")) throw new Error("Snapcast group changed outside Couch. Playback stopped.");
        if (!after.clients.some(client => client.connected)) throw new Error("All Snapcast members disconnected.");
        apply(next);
      } finally { refreshQueued = false; }
    }).catch(error => fail(error instanceof Error ? error.message : "Snapcast topology failed."));
  };
  function connect() {
    if (closed) return;
    const epoch = ++generation;
    const current = new WebSocket(config.controlUrl); socket = current;
    opening = setTimeout(() => { if (socket === current) fail("Snapcast did not connect.", true); }, 3000);
    current.onopen = () => {
      if (opening) clearTimeout(opening);
      void enqueue(async () => {
        await producer.close();
        if (closed || epoch !== generation) return;
        let next = await read();
        const group = next.groups.find(item => item.id === config.groupId)!;
        if (!group.clients.some(client => client.connected)) throw new Error("No Snapcast group members are connected.");
        // Reset the backend client pipeline as well as the local producer after uncertainty.
        await rpc("Group.SetStream", { id: config.groupId, stream_id: config.idleStreamId });
        await new Promise(resolve => setTimeout(resolve, config.drainMs));
        if (closed || epoch !== generation) return;
        await rpc("Group.SetStream", { id: config.groupId, stream_id: config.streamId }); next = await read();
        if (closed || epoch !== generation) return;
        producer = makeProducer();
        connected = true; state = idle(); apply(next); callbacks.observe(state);
      }).catch(error => { if (epoch === generation) fail(error instanceof Error ? error.message : "Snapcast setup failed."); });
    };
    current.onmessage = event => {
      if (socket !== current || closed) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 262144) throw new Error("Invalid Snapcast response.");
        const message = JSON.parse(event.data);
        if (!message || Array.isArray(message) || message.jsonrpc !== "2.0") throw new Error("Invalid Snapcast response.");
        if (typeof message.id === "number") {
          const request = pending.get(message.id);
          if (request) { clearTimeout(request.timer); pending.delete(message.id); if (message.error) request.reject(new Error("Snapcast rejected the operation.")); else request.resolve(message.result); }
        } else if (typeof message.method === "string") refresh();
      } catch { fail("Invalid Snapcast response."); }
    };
    current.onclose = () => { if (socket === current) fail("Snapcast disconnected. Playback stopped.", true); };
    current.onerror = () => { if (socket === current) fail("Snapcast connection failed.", true); };
  }
  publish(); connect();
  return {
    async reconnect() {
      if (closed) throw new Error("Couch is shutting down.");
      if (reconnect) { clearTimeout(reconnect); reconnect = undefined; }
      fail("Reconnecting to Snapcast.");
      connect();
      const epoch = generation;
      const deadline = Date.now() + 15_000;
      while (!connected && !closed && epoch === generation && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      if (!connected || closed || epoch !== generation) throw new Error(state.error || "Snapcast reconnection failed.");
    },
    send(command: PlaybackCommand) {
      check();
      if (command.type !== "stop" && queued >= 32) throw new Error("Wait for the pending Snapcast command.");
      if (!["load", "pause", "seek", "stop", "volume", "speed"].includes(command.type) && !(command.type === "track" && command.kind === "audio" && command.index === 0)) throw new Error("That control is not supported by the Snapcast group.");
      if (command.type === "stop" && queued >= 32) { fail("Snapcast command backlog was stopped. Reconnect before retrying."); return; }
      if (command.type === "stop" || command.type === "load") { playbackGeneration++; producer.cancel(); }
      const playbackEpoch = playbackGeneration;
      const epoch = generation;
      void enqueue(async () => {
        check(); if (epoch !== generation || playbackEpoch !== playbackGeneration) return;
        if (command.type === "volume") {
          if (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 100) throw new Error("Invalid volume.");
          for (const member of members.filter(item => item.joined)) await rpc("Client.SetVolume", { id: member.id, volume: { percent: command.volume, muted: member.muted } });
          apply(await read());
        } else await producer.send(command);
      }).catch(() => { if (epoch === generation) fail("Snapcast playback failed. Stop or reconnect before retrying."); });
    },
    setMembers(ids: string[]) {
      check();
      if (!ids.length || ids.length > 32 || new Set(ids).size !== ids.length) return Promise.reject(new Error("Choose at least one distinct Snapcast member."));
      return enqueue(async () => {
        check(); const next = await read(); const owned = next.groups.find(group => group.id === config.groupId)!;
        for (const id of ids) {
          const group = next.groups.find(item => item.clients.some(client => client.id === id));
          const client = group?.clients.find(item => item.id === id);
          if (!client?.connected || client.config.latency !== 0 || group!.id !== config.groupId && group!.stream_id !== config.idleStreamId) throw new Error("Only available idle speakers can join this group.");
        }
        const removed = owned.clients.filter(client => !ids.includes(client.id)).map(client => client.id);
        await rpc("Group.SetClients", { id: config.groupId, clients: ids });
        let updated = await read();
        for (const group of updated.groups.filter(item => item.id !== config.groupId && item.clients.some(client => removed.includes(client.id)))) {
          if (group.clients.some(client => !removed.includes(client.id)) || group.stream_id !== config.streamId) throw new Error("Snapcast membership changed concurrently.");
          await rpc("Group.SetStream", { id: group.id, stream_id: config.idleStreamId });
        }
        updated = await read(); apply(updated);
      }).catch(error => { fail("Snapcast membership could not be confirmed. Playback stopped."); throw error; });
    },
    setMemberVolume(id: string, volume: number, muted: boolean) {
      check();
      if (!Number.isFinite(volume) || volume < 0 || volume > 100 || typeof muted !== "boolean") return Promise.reject(new Error("Invalid member volume."));
      return enqueue(async () => {
        check(); const next = await read();
        if (!next.groups.find(group => group.id === config.groupId)?.clients.some(client => client.id === id)) throw new Error("That speaker is not in this group.");
        await rpc("Client.SetVolume", { id, volume: { percent: volume, muted } }); apply(await read());
      });
    },
    async close() {
      if (closed) return;
      closed = true; connected = false; generation++;
      producer.cancel();
      if (reconnect) clearTimeout(reconnect); if (opening) clearTimeout(opening);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Couch is shutting down.")); }
      pending.clear(); const previous = socket; socket = undefined; previous?.close();
      await tail; await producer.close();
    },
  };
}
