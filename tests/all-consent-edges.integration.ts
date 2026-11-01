import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
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
  const otherKey = Identity.generate(), otherId = otherKey.peerId, otherToken = store.pair(otherId, "Other Playback");
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
    await client.connect(`${hub.origin.replace("http:", "ws:")}/api/audio/${key.peerId === adminId ? adminToken : key.peerId === otherId ? otherToken : deviceToken}/sendspin`, { timeoutMs: 3_000 });
    return levels;
  }
  async function connect(token: string, id: string, options = "") {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}${options}`, { headers: { Origin: hub.origin } });
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
  const admin = await connect(adminToken, adminId), device = await connect(deviceToken, deviceId), other = await connect(otherToken, otherId);
  return { hub, admin, device, other, otherId, adminId, deviceId, deviceToken, connect,
    speakers: () => Promise.all([speaker(adminKey), speaker(deviceKey)]),
    reconnectSpeaker: async () => { await speakers.splice(1, 1)[0]!.disconnect(); return speaker(deviceKey); },
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

test("private Move here after All=0 plays there alone at its own level; the shared speaker leaves", {timeout:15000}, async()=>{
  const f=await setupMix();
  try {
    await f.admin.command({type:"output",deviceId:f.adminId,picture:true});
    await f.device.command({type:"output",deviceId:f.deviceId,picture:true});
    await until(()=>f.levels[0]!.at(-1)!==undefined);
    await f.admin.command({type:"allSpeakers",level:0});
    await until(()=>f.levels[0]!.at(-1)===0);
    // Move here is exclusive: Admin shares, so its output leaves rather than staying in a partial mix.
    const only=await f.device.command({type:"solo",deviceId:f.deviceId});
    assert.equal(only.ok,true,only.error ?? "");
    await until(()=>f.device.state.outputs?.map(o=>o.deviceId).join()===f.deviceId&&!!f.device.state.outputs[0]!.sound);
    const own=f.device.state.devices!.find(d=>d.id===f.deviceId)!.volume;
    const volume=()=>f.device.messages.flatMap(message=>message.type==="player"&&message.command.type==="volume"?[message.command.volume]:[]).at(-1);
    await until(()=>volume()===own);
    console.log("WIRE",JSON.stringify({scenario:"onlyHereAfter0",mixTrim:f.admin.state.mixTrim,shared:f.levels[0]!.at(-1),private:volume(),own}));
    assert.equal(f.levels[0]!.at(-1),0);
  } finally {await f.close();}
});

test("private fader join after All=0 restores All by the existing raising-sound rule", {timeout:15000}, async()=>{
  const f=await setupMix();
  try {
    await f.admin.command({type:"allSpeakers",level:0});
    assert.equal((await f.device.command({type:"output",deviceId:f.deviceId,level:40})).ok,true);
    await until(()=>f.levels[1]!.at(-1)===40);
    console.log("WIRE",JSON.stringify({scenario:"joinFaderAfter0",mixTrim:f.admin.state.mixTrim,shared:f.levels[0]!.at(-1),private:f.levels[1]!.at(-1)}));
    assert.equal(f.admin.state.mixTrim,100);
  } finally {await f.close();}
});

test("private fader join after All=50 plays at its own level", {timeout:15000}, async()=>{
  const f=await setupMix();
  try {
    await f.admin.command({type:"allSpeakers",level:50});
    assert.equal((await f.device.command({type:"output",deviceId:f.deviceId,level:40})).ok,true);
    await until(()=>!!f.device.state.outputs?.find(o=>o.deviceId===f.deviceId&&o.sound));
    await until(()=>f.levels[1]!.at(-1)!==undefined);
    console.log("WIRE",JSON.stringify({scenario:"joinFaderAfter50",mixTrim:f.admin.state.mixTrim,shared:f.levels[0]!.at(-1),private:f.levels[1]!.at(-1)}));
    assert.equal(f.levels[1]!.at(-1),40);
  } finally {await f.close();}
});

test("self-joined speaker revoking sharing after All=0 returns to its own level", {timeout:15000}, async()=>{
  const f=await setupMix();
  try {
    await f.device.command({type:"sharing",sharing:{audio:true,video:false}});
    await f.device.command({type:"output",deviceId:f.deviceId,level:40});
    await until(()=>f.levels[1]!.at(-1)===40);
    await f.admin.command({type:"allSpeakers",level:0});
    await until(()=>f.levels[1]!.at(-1)===0);
    await f.device.command({type:"sharing",sharing:{audio:false,video:false}});
    // Await a real command roundtrip, not a guessed playback-state update.
    await f.device.command({type:"pause",playbackId:f.device.state.player.playbackId!,paused:true});
    console.log("WIRE",JSON.stringify({scenario:"revokeAfter0",mixTrim:f.admin.state.mixTrim,private:f.levels[1]!.at(-1),sharing:f.admin.state.devices?.find(d=>d.id===f.deviceId)?.sharing,local:f.device.state.outputs?.find(o=>o.deviceId===f.deviceId)?.local}));
    assert.equal(f.levels[1]!.at(-1),40);
  } finally {await f.close();}
});

test("self-issued All attenuation survives foreign All, mute, zero volume and reconnect", { timeout: 20_000 }, async () => {
  const f = await setupMix();
  try {
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 40 });
    await f.device.command({ type: "allSpeakers", level: 25 });
    await until(() => f.levels[0]!.at(-1) === 20 && f.levels[1]!.at(-1) === 10);
    for (const level of [0, 100, 50]) {
      await f.admin.command({ type: "allSpeakers", level });
      await until(() => f.levels[0]!.at(-1) === Math.round(80 * level / 100));
      assert.equal(f.levels[1]!.at(-1), 10);
    }
    await f.device.command({ type: "mute", deviceId: f.deviceId, muted: true });
    await until(() => f.levels[1]!.at(-1) === 0);
    await f.admin.command({ type: "allSpeakers", level: 100 });
    await until(() => f.levels[0]!.at(-1) === 80);
    assert.equal(f.levels[1]!.at(-1), 0);
    await f.device.command({ type: "mute", deviceId: f.deviceId, muted: false });
    await until(() => f.levels[1]!.at(-1) === 10);
    await f.device.command({ type: "volume", deviceId: f.deviceId, volume: 0 });
    await until(() => f.levels[1]!.at(-1) === 0);
    await f.admin.command({ type: "allSpeakers", level: 50 });
    await until(() => f.levels[0]!.at(-1) === 40);
    assert.equal(f.levels[1]!.at(-1), 0);
    await f.device.command({ type: "volume", deviceId: f.deviceId, volume: 40 });
    await until(() => f.levels[1]!.at(-1) === 10);

    f.device.socket.terminate();
    await until(() => f.admin.state.devices?.find(device => device.id === f.deviceId)?.online === false);
    const back = await f.connect(f.deviceToken, f.deviceId);
    const reconnectedLevels = await f.reconnectSpeaker();
    await until(() => reconnectedLevels.at(-1) === 10);
    assert.equal(back.state.outputs?.find(output => output.deviceId === f.deviceId)?.sound, true);
    assert.equal(back.state.devices?.find(device => device.id === f.deviceId)?.volume, 40);
    console.log("WIRE", JSON.stringify({ scenario: "ownTrimReconnect", private: reconnectedLevels.at(-1), shared: f.levels[0]!.at(-1), own: 40 }));
  } finally { await f.close(); }
});

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

const directLevel = (messages: ServerMessage[]) => {
  const message = messages.findLast(message => message.type === "player" && message.command.type === "volume");
  return message?.type === "player" && message.command.type === "volume" ? message.command.volume : undefined;
};

test("Direct sound refreshes on revocation and regrant even when local channels stay selected", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    await f.device.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.admin.command({ type: "enqueue", entry: { id: "direct", title: "Direct", source: `${f.hub.origin}/api/health` }, deviceId: f.deviceId, playNow: true });
    await until(() => f.device.messages.some(message => message.type === "player" && message.command.type === "load"));
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 40 });
    await until(() => directLevel(f.device.messages) === 40);
    const trim = await f.admin.command({ type: "allSpeakers", level: 0 });
    assert.equal(trim.ok, true, trim.error ?? "");
    await until(() => directLevel(f.device.messages) === 0);
    const outputs = f.device.state.outputs;
    await f.device.command({ type: "sharing", sharing: { audio: false, video: false } });
    await until(() => directLevel(f.device.messages) === 40);
    assert.deepEqual(f.device.state.outputs, outputs);
    await f.device.command({ type: "sharing", sharing: { audio: true, video: true } });
    await until(() => directLevel(f.device.messages) === 0);
    assert.deepEqual(f.device.state.outputs, outputs);
  } finally { await f.close(); }
});

test("protected attenuation survives Direct to Synced to Direct and leaves another Playback alone", { timeout: 15_000 }, async () => {
  const f = await setupMix();
  try {
    await f.other.command({ type: "enqueue", entry: { id: "other", title: "Other", source: `${f.hub.origin}/api/health` }, deviceId: f.otherId, playNow: true });
    await f.other.command({ type: "allSpeakers", level: 50 });
    await until(() => directLevel(f.other.messages) === 40);
    const otherPlayback = f.other.state.player.playbackId;
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 40 });
    await f.device.command({ type: "allSpeakers", level: 25 });
    await until(() => f.levels[1]!.at(-1) === 10);
    // Leave the shared output: the private Device takes over Direct at its own trim.
    await f.admin.command({ type: "output", deviceId: f.adminId, picture: false, level: 0 });
    await until(() => directLevel(f.device.messages) === 10);
    // The shared Device joins again; foreign All changes only that Device's sound.
    assert.equal((await f.device.command({ type: "output", deviceId: f.adminId, picture: true, level: 80 })).ok, true);
    await f.admin.command({ type: "allSpeakers", level: 0 });
    await until(() => f.levels[0]!.at(-1) === 0);
    assert.equal(f.levels[1]!.at(-1), 10);
    await f.admin.command({ type: "output", deviceId: f.adminId, picture: false, level: 0 });
    await until(() => directLevel(f.device.messages) === 10 && !f.device.state.outputs?.some(output => output.deviceId === f.adminId));
    assert.equal(f.other.state.player.playbackId, otherPlayback);
    assert.equal(f.other.state.mixTrim, 50);
    assert.equal(directLevel(f.other.messages), 40);
    assert.equal(f.device.state.devices?.find(device => device.id === f.deviceId)?.volume, 40);
  } finally { await f.close(); }
});

test("queue advance retains protected wire levels", { timeout: 15_000 }, async () => {
  const f = await setupMix();
  let release: (() => void) | undefined;
  let hold = true;
  const source = createServer((_request, response) => {
    const send = () => { response.writeHead(200, { "Content-Type": "text/plain" }); response.end("media"); };
    if (hold) release = () => { hold = false; send(); }; else send();
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    await f.device.command({ type: "output", deviceId: f.deviceId, level: 40 });
    await f.device.command({ type: "allSpeakers", level: 25 });
    await until(() => f.levels[1]!.at(-1) === 10);
    await f.admin.command({ type: "allSpeakers", level: 0 });
    await until(() => f.levels[0]!.at(-1) === 0);
    const address = source.address(); assert.ok(address && typeof address === "object");
    await f.admin.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `http://127.0.0.1:${address.port}/media` } });
    await f.admin.command({ type: "next", playbackId: f.admin.state.player.playbackId! });
    await until(() => !!release);
    // Hold only source resolution; later requests to this local fixture must finish too.
    release!();
    await until(() => f.admin.state.currentEntryId === "next" && f.admin.state.player.tracks?.some(track => track.kind === "audio") === true);
    await f.admin.command({ type: "pause", playbackId: f.admin.state.player.playbackId!, paused: true });
    await until(() => f.admin.state.player.status === "paused");
    assert.equal(f.levels[1]!.at(-1), 10);
    assert.equal(f.levels[0]!.at(-1), 0);
    assert.equal(f.admin.state.mixTrim, 0);
  } finally {
    await f.close();
    source.closeAllConnections();
    await new Promise<void>(resolve => source.close(() => resolve()));
  }
});
