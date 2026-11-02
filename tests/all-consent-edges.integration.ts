import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

// Keep origin discovery local; playback requests still go through the real HTTP server.
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input, init) => {
    if (/^https:\/\/streamingcommunity/.test(String(input))) {
      const response = new Response('<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>');
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});
after(() => { globalThis.fetch = originalFetch; });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-sharing-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const adminKey = Identity.generate(), deviceKey = Identity.generate(), adminId = adminKey.peerId, deviceId = deviceKey.peerId;
  const adminToken = store.pair(adminId, "Admin"), deviceToken = store.pair(deviceId, "Device");
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [];
  // A Device's Sendspin player: the levels Core sends it while its sound is synced.
  async function speaker(key: Identity) {
    const levels: number[] = [], client = new SendspinClient(key.peerId, "Test speaker", [Roles.PLAYER], {
      playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.VOLUME] },
    });
    speakers.push(client);
    client.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.VOLUME) levels.push(command.player.volume!); });
    await client.connect(`${hub.origin.replace("http:", "ws:")}/api/audio/${key.peerId === adminId ? adminToken : deviceToken}/sendspin`, { timeoutMs: 3_000 });
    return levels;
  }
  async function connect(token: string, id: string) {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      };
    });
    return { socket, messages, get state() { return state!; }, command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
      const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  }
  const admin = await connect(adminToken, adminId), device = await connect(deviceToken, deviceId);
  return { hub, admin, device, adminId, deviceId,
    speakers: () => Promise.all([speaker(adminKey), speaker(deviceKey)]),
    close: async () => { await Promise.all(speakers.map(client => client.disconnect())); for (const socket of sockets) socket.terminate(); await hub.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected device state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// Real Core WebSockets and official Sendspin clients; paused before the mix spans Devices.
const setupMix = async () => {
  const f = await fixture();
  await f.admin.command({ type: "sharing", sharing: {audio:true,video:true} });
  await f.device.command({ type:"enqueue", entry:{id:"mix",title:"Mix",source:`${f.hub.origin}/api/health`}, deviceId:f.adminId, playNow:true });
  await until(() => f.admin.messages.some(message => message.type === "player" && message.command.type === "load"));
  // Keep it paused before joining so the fixture exercises routing without FFmpeg media decoding.
  f.admin.socket.send(JSON.stringify({type:"player",state:{...f.admin.state.player,status:"paused",duration:100,seekable:true,speed:1,buffering:false}}));
  await until(()=>f.admin.state.player.status === "paused");
  const levels = await f.speakers();
  return {...f,levels};
};

test("revoking and regranting audio refreshes wire levels without changing local outputs", { timeout: 15_000 }, async () => {
  const f = await setupMix();
  try {
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 40 });
    await until(() => f.levels[1]!.at(-1) === 40);
    await f.admin.command({ type: "allSpeakers", level: 0 });
    await until(() => f.levels[1]!.at(-1) === 0);
    const outputs = f.device.state.outputs;
    for (const audio of [false, true, false]) {
      await f.device.command({ type: "sharing", sharing: { audio, video: false } });
      await until(() => f.levels[1]!.at(-1) === (audio ? 0 : 40));
      assert.deepEqual(f.device.state.outputs, outputs);
      assert.equal(f.levels[0]!.at(-1), 0);
    }
    // A Device's own All remains its choice even when it subsequently revokes sharing.
    await f.device.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.device.command({ type: "allSpeakers", level: 25 });
    await until(() => f.levels[1]!.at(-1) === 10);
    await f.device.command({ type: "sharing", sharing: { audio: false, video: false } });
    await f.admin.command({ type: "allSpeakers", level: 0 });
    await until(() => f.levels[0]!.at(-1) === 0);
    assert.equal(f.levels[1]!.at(-1), 10);
  } finally { await f.close(); }
});


