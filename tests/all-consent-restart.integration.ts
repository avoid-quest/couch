import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { streamingCommunityOrigin } from "../src/shared/streamingcommunity";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

// Only startup discovery is synthetic. Core, SQLite, playback HTTP and Sendspin are real.
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input, init) => {
    if (String(input) === streamingCommunityOrigin) {
      const response = new Response('<div data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{}}"></div>');
      Object.defineProperty(response, "url", { value: streamingCommunityOrigin });
      return response;
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});
after(() => { globalThis.fetch = originalFetch; });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-consent-restart-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const identities = [70, 40].map(volume => {
    const key = Identity.generate(), id = key.peerId, token = store.pair(id, `Device ${volume}`);
    store.saveDeviceSound(id, { volume });
    return { key, id, token };
  });
  store.close();
  let hub: Awaited<ReturnType<typeof createHub>>;
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [];
  const connect = async (identity: typeof identities[number]) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${identity.token}&device=${identity.id}&audio=1&video=1`, { headers: { Origin: hub.origin } });
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
    return { ...identity, socket, messages, get state() { return state!; }, command: (action: Action) => new Promise<void>((resolve, reject) => {
      const requestId = String(++sequence);
      pending.set(requestId, result => result.ok ? resolve() : reject(new Error(result.error)));
      socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  };
  const start = async () => {
    hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: Number(process.env.COUCH_PORT ?? 0) });
    return Promise.all(identities.map(connect));
  };
  const stop = async () => {
    await Promise.all(speakers.splice(0).map(speaker => speaker.disconnect()));
    for (const socket of sockets.splice(0)) socket.terminate();
    await hub.close();
  };
  return { devices: await start(),
    queue: (id: string, deviceId?: string): Action => ({ type: "enqueue", entry: { id, title: id, source: `${hub.origin}/api/health` }, deviceId, playNow: !!deviceId }),
    speaker: async (index: number) => {
      const identity = identities[index]!, levels: number[] = [];
      const client = new SendspinClient(identity.id, "Test speaker", [Roles.PLAYER], {
        encryption: { identity: identity.key },
        playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.VOLUME] },
      });
      speakers.push(client);
      client.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.VOLUME) levels.push(command.player.volume!); });
      await client.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
      return levels;
    },
    restart: async () => { await stop(); return start(); },
    close: async () => { await stop(); rmSync(directory, { recursive: true, force: true }); },
  };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected wire state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

const directLevel = (messages: ServerMessage[]) => {
  const message = messages.findLast(message => message.type === "player" && message.command.type === "volume");
  return message?.type === "player" && message.command.type === "volume" ? message.command.volume : undefined;
};

async function pause(device: Awaited<ReturnType<typeof fixture>>["devices"][number]) {
  await until(() => device.messages.some(message => message.type === "player" && message.command.type === "load"));
  device.socket.send(JSON.stringify({ type: "player", state: { ...device.state.player, status: "paused", duration: 100, seekable: true, speed: 1, buffering: false } }));
  await until(() => device.state.player.status === "paused");
}

for (const restart of [false, true]) {
  test(`new private speaker keeps its own level ${restart ? "after Core restart" : "without restart"}`, { timeout: 12_000 }, async () => {
    const f = await fixture();
    try {
      const original = f.devices[0]!;
      await original.command(f.queue("saved"));
      await original.command({ type: "allSpeakers", level: 20 });
      const [a, b] = restart ? await f.restart() : f.devices;
      await a!.command({ type: "play", entryId: "saved" });
      await until(() => directLevel(a!.messages) === 14);
      await b!.command({ type: "sharing", sharing: { audio: false, video: false } });
      await b!.command(f.queue("next", a!.id));
      await pause(a!);
      await b!.command({ type: "output", deviceId: b!.id, level: 40 });
      const levels = await Promise.all([f.speaker(0), f.speaker(1)]);
      await until(() => levels.every(wire => wire.length > 0));
      console.log("RESTART_WIRE", JSON.stringify({ restart, mixTrim: b!.state.mixTrim, shared: levels[0]!.at(-1), private: levels[1]!.at(-1) }));
      assert.equal(levels[1]!.at(-1), 40);
      assert.equal(levels[0]!.at(-1), 14);
      assert.equal(b!.state.mixTrim, 20);
    } finally { await f.close(); }
  });
}

test("restored All follows live audio consent in Direct and Synced delivery", { timeout: 12_000 }, async () => {
  const f = await fixture();
  try {
    await f.devices[0]!.command(f.queue("saved"));
    await f.devices[0]!.command({ type: "allSpeakers", level: 20 });
    const [a, b] = await f.restart();
    await a!.command({ type: "play", entryId: "saved" });
    await pause(a!);
    await until(() => directLevel(a!.messages) === 14);
    const outputs = a!.state.outputs;
    await a!.command({ type: "sharing", sharing: { audio: false, video: true } });
    await until(() => directLevel(a!.messages) === 70);
    assert.deepEqual(a!.state.outputs, outputs);
    await a!.command({ type: "sharing", sharing: { audio: true, video: true } });
    await until(() => directLevel(a!.messages) === 14);
    await b!.command(f.queue("next", a!.id));
    await pause(a!);
    await b!.command({ type: "output", deviceId: b!.id, level: 40 });
    const levels = await Promise.all([f.speaker(0), f.speaker(1)]);
    await until(() => levels[0]!.at(-1) === 14 && levels[1]!.at(-1) === 8);
    const localOutputs = b!.state.outputs;
    for (const audio of [false, true, false]) {
      await b!.command({ type: "sharing", sharing: { audio, video: true } });
      await until(() => levels[1]!.at(-1) === (audio ? 8 : 40));
      assert.deepEqual(b!.state.outputs, localOutputs);
      assert.equal(levels[0]!.at(-1), 14);
      assert.equal(b!.state.mixTrim, 20);
    }
    console.log("RESTART_WIRE", JSON.stringify({ scenario: "liveAudioConsent", shared: levels[0]!.at(-1), private: levels[1]!.at(-1) }));
  } finally { await f.close(); }
});

test("private Only here after restored All=0 stays audible and a positive fader still unsilences All", { timeout: 12_000 }, async () => {
  const f = await fixture();
  try {
    await f.devices[0]!.command(f.queue("saved"));
    await f.devices[0]!.command({ type: "allSpeakers", level: 0 });
    const [a, b] = await f.restart();
    await a!.command({ type: "play", entryId: "saved" });
    await until(() => directLevel(a!.messages) === 0);
    await b!.command({ type: "sharing", sharing: { audio: false, video: false } });
    await b!.command(f.queue("next", a!.id));
    await pause(a!);
    // Only here is exclusive: Device 70 shares, so it leaves and Device 40 plays Direct at its own level.
    await b!.command({ type: "solo", deviceId: b!.id });
    await until(() => b!.state.outputs?.map(output => output.deviceId).join() === b!.id && directLevel(b!.messages) === 40);
    assert.equal(b!.state.mixTrim, 0);
    await b!.command({ type: "output", deviceId: b!.id, level: 40 });
    await until(() => b!.state.mixTrim === 100);
    assert.equal(directLevel(b!.messages), 40);
    console.log("RESTART_WIRE", JSON.stringify({ scenario: "zeroUnsilence", private: directLevel(b!.messages), mixTrim: b!.state.mixTrim }));
  } finally { await f.close(); }
});

test("private resume does not adopt saved All authority; a fresh own All survives foreign All", { timeout: 12_000 }, async () => {
  const f = await fixture();
  try {
    const original = f.devices[1]!;
    await original.command({ type: "sharing", sharing: { audio: false, video: false } });
    await original.command(f.queue("own"));
    await original.command({ type: "allSpeakers", level: 25 });
    await until(() => directLevel(original.messages) === 10);
    const [a, b] = await f.restart();
    assert.equal(b!.state.outputs?.length ?? 0, 0);
    await b!.command({ type: "sharing", sharing: { audio: false, video: false } });
    await b!.command({ type: "play", entryId: "own" });
    await pause(b!);
    assert.equal(directLevel(b!.messages), 40);
    assert.equal(b!.state.mixTrim, 25);
    await b!.command({ type: "allSpeakers", level: 25 });
    await until(() => directLevel(b!.messages) === 10);
    await b!.command({ type: "output", deviceId: a!.id, picture: true, level: 70 });
    const levels = await Promise.all([f.speaker(0), f.speaker(1)]);
    await until(() => levels[0]!.at(-1) === 18 && levels[1]!.at(-1) === 10);
    await a!.command({ type: "allSpeakers", level: 0 });
    await until(() => levels[0]!.at(-1) === 0);
    assert.equal(levels[1]!.at(-1), 10);
    await b!.command({ type: "mute", deviceId: b!.id, muted: true });
    await until(() => levels[1]!.at(-1) === 0);
    await a!.command({ type: "allSpeakers", level: 50 });
    await until(() => levels[0]!.at(-1) === 35);
    await b!.command({ type: "mute", deviceId: b!.id, muted: false });
    await until(() => levels[1]!.at(-1) === 10);
    console.log("RESTART_WIRE", JSON.stringify({ scenario: "freshOwnAll", shared: levels[0]!.at(-1), private: levels[1]!.at(-1) }));
  } finally { await f.close(); }
});
