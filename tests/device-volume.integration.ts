import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { soundRaised } from "../src/server/sound-routing";
import { parseCommand } from "../src/server/validation";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-volume-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const identities = [70, 40, 90, 55].map(volume => {
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
    return { ...identity, messages, get state() { return state!; }, command: (action: Action) => new Promise<void>((resolve, reject) => {
      const requestId = String(++sequence);
      pending.set(requestId, result => result.ok ? resolve() : reject(new Error(result.error)));
      socket.send(JSON.stringify({ type: "command", requestId, action }));
    }) };
  };
  const start = async () => {
    hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
    return Promise.all(identities.map(connect));
  };
  const stop = async () => {
    await Promise.all(speakers.splice(0).map(speaker => speaker.disconnect()));
    for (const socket of sockets.splice(0)) socket.terminate();
    await hub.close();
  };
  return { devices: await start(), queue: (id: string): Action => ({ type: "enqueue", entry: { id, title: id, source: `${hub.origin}/api/health` } }), speaker: async (index: number) => {
    const identity = identities[index]!, levels: number[] = [];
    const speaker = new SendspinClient(identity.id, "Test speaker", [Roles.PLAYER], {
      encryption: { identity: identity.key },
      playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.VOLUME] },
    });
    speakers.push(speaker);
    speaker.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.VOLUME) levels.push(command.player.volume!); });
    await speaker.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
    return levels;
  }, restart: async () => { await stop(); return start(); }, close: async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  } };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected mixer state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// The volume a Direct renderer was last told to play at.
const level = (messages: ServerMessage[]) => { const message = messages.findLast(message => message.type === "player" && message.command.type === "volume"); return message?.type === "player" && message.command.type === "volume" ? message.command.volume : undefined; };

test("mute preserves the displayed volume and allows changing it before unmuting", { timeout: 10_000 }, async () => {
  const f = await fixture(), device = f.devices[0]!;
  try {
    assert.equal(device.state.player.volume, 70);
    await device.command({ type: "mute", muted: true });
    assert.equal(device.state.devices?.find(item => item.id === device.id)?.volume, 70);
    assert.equal(device.state.player.volume, 70);
    await device.command({ type: "volume", volume: 50 });
    assert.equal(device.state.devices?.find(item => item.id === device.id)?.muted, true);
    assert.equal(device.state.player.volume, 50);
    await device.command({ type: "mute", muted: false });
    assert.equal(device.state.player.volume, 50);
  } finally { await f.close(); }
});

test("All is independent attenuation, restores from zero and preserves individual volume and mute", { timeout: 15_000 }, async () => {
  const f = await fixture(), device = f.devices[0]!;
  try {
    await device.command(f.queue("first"));
    assert.equal(device.state.mixTrim, 100);
    const outputs = device.state.outputs;
    for (const trim of [50, 0, 100]) {
      await device.command({ type: "allSpeakers", level: trim });
      assert.equal(device.state.mixTrim, trim);
      // At 0 the band says so; otherwise it shows the Device's own level.
      assert.equal(device.state.player.volume, trim ? 70 : 0);
      assert.equal(device.state.devices?.find(item => item.id === device.id)?.volume, 70);
      assert.deepEqual(device.state.outputs, outputs);
      assert.equal(level(device.messages), Math.round(70 * trim / 100));
    }
    assert.throws(() => parseCommand(JSON.stringify({ type: "command", requestId: "1", action: { type: "allSpeakers", level: 50.5 } })));
    await device.command({ type: "allSpeakers", level: 50 });
    await device.command({ type: "volume", volume: 41 });
    assert.equal(device.state.mixTrim, 50);
    assert.equal(device.state.player.volume, 41);
    assert.equal(level(device.messages), 21);
    await device.command({ type: "volume", volume: 0 });
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(device.state.outputs?.[0]?.sound, true);
    assert.equal(level(device.messages), 0);
    await device.command({ type: "volume", volume: 41 });
    await device.command({ type: "mute", muted: true });
    assert.equal(level(device.messages), 0);
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(level(device.messages), 0);
    assert.equal(device.state.devices?.find(item => item.id === device.id)?.muted, true);
    await device.command({ type: "mute", muted: false });
    assert.equal(level(device.messages), 41);
    await device.command({ type: "output", deviceId: device.id, level: 0 });
    await device.command({ type: "allSpeakers", level: 0 });
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(device.state.outputs?.[0]?.sound, false);
    assert.equal(level(device.messages), 0);
  } finally { await f.close(); }
});

test("All trims synced speakers without joining inactive devices or disturbing another Playback", { timeout: 15_000 }, async () => {
  const f = await fixture(), [a, b, c, d] = f.devices;
  try {
    await a!.command(f.queue("mix"));
    await d!.command(f.queue("elsewhere"));
    const elsewhere = d!.state.playback;
    await a!.command({ type: "output", deviceId: b!.id, level: 40 });
    await a!.command({ type: "output", deviceId: c!.id, picture: true });
    const aLevels = await f.speaker(0), bLevels = await f.speaker(1);
    await until(() => aLevels.at(-1) === 70 && bLevels.at(-1) === 40);
    const outputs = a!.state.outputs, deviceLevels = a!.state.devices?.map(device => [device.id, device.volume, device.muted]);
    for (const trim of [50, 0, 100]) {
      await a!.command({ type: "allSpeakers", level: trim });
      await until(() => aLevels.at(-1) === Math.round(70 * trim / 100) && bLevels.at(-1) === Math.round(40 * trim / 100));
      assert.deepEqual(a!.state.outputs, outputs);
      assert.deepEqual(a!.state.devices?.map(device => [device.id, device.volume, device.muted]), deviceLevels);
      assert.equal(a!.state.outputs?.find(output => output.deviceId === c!.id)?.sound, false);
      assert.equal(a!.state.outputs?.some(output => output.deviceId === d!.id), false);
      await until(() => d!.state.playback === elsewhere && d!.state.mixTrim === 100);
    }
    await a!.command({ type: "allSpeakers", level: 50 });
    await a!.command(f.queue("next"));
    assert.equal(a!.state.mixTrim, 50);
    await a!.command({ type: "output", deviceId: c!.id, picture: false });
    await a!.command({ type: "output", deviceId: b!.id, level: 0 });
    assert.equal(level(a!.messages), 35);
    await a!.command({ type: "allSpeakers", level: 100 });
    assert.equal(a!.state.outputs?.some(output => output.deviceId === b!.id), false);
  } finally { await f.close(); }
});

test("Raising sound while All is at 0 brings All back and leaves muted devices silent", { timeout: 15_000 }, async () => {
  const f = await fixture(), [a, b] = f.devices;
  try {
    await a!.command(f.queue("mix"));
    await a!.command({ type: "output", deviceId: b!.id, level: 40 });
    const aLevels = await f.speaker(0), bLevels = await f.speaker(1);
    await a!.command({ type: "mute", deviceId: b!.id, muted: true });
    for (const raise of [[{ type: "volume", volume: 35 }], [{ type: "output", deviceId: a!.id, level: 50 }], [{ type: "mute", muted: true, deviceId: a!.id }, { type: "mute", muted: false, deviceId: a!.id }]] satisfies Action[][]) {
      await a!.command({ type: "allSpeakers", level: 0 });
      await until(() => aLevels.at(-1) === 0 && bLevels.at(-1) === 0);
      for (const action of raise) await a!.command(action);
      assert.equal(a!.state.mixTrim, 100);
      await until(() => aLevels.at(-1)! > 0);
      assert.equal(a!.state.player.volume, aLevels.at(-1));
      assert.equal(bLevels.at(-1), 0);
      assert.equal(a!.state.devices?.find(device => device.id === b!.id)?.muted, true);
    }
  } finally { await f.close(); }
});

test("The band at All 0 lowers nothing and raising it only brings All back", { timeout: 15_000 }, async () => {
  const f = await fixture(), [a, b] = f.devices;
  try {
    await a!.command(f.queue("mix"));
    await a!.command({ type: "output", deviceId: b!.id, level: 40 });
    const volumes = () => [a, b].map(device => a!.state.devices?.find(item => item.id === device!.id)?.volume);
    await a!.command({ type: "allSpeakers", level: 0 });
    await a!.command({ type: "volume", volume: 0 });
    assert.deepEqual(volumes(), [70, 40]);
    assert.equal(a!.state.mixTrim, 0);
    await a!.command({ type: "volume", volume: 5 });
    assert.deepEqual(volumes(), [70, 40]);
    assert.equal(a!.state.mixTrim, 100);
    assert.equal(a!.state.player.volume, 70);
  } finally { await f.close(); }
});

test("Unmuting brings All back only for muted sound in the looked-at Playback", { timeout: 15_000 }, async () => {
  const f = await fixture(), [a, , , d] = f.devices;
  try {
    await a!.command(f.queue("mix"));
    await d!.command(f.queue("elsewhere"));
    await a!.command({ type: "allSpeakers", level: 0 });
    await d!.command({ type: "allSpeakers", level: 0 });
    await d!.command({ type: "mute", muted: true });
    await a!.command({ type: "mute", muted: false });
    assert.equal(a!.state.mixTrim, 0);
    await a!.command({ type: "mute", deviceId: d!.id, muted: false });
    await until(() => d!.state.devices?.find(device => device.id === d!.id)?.muted === false);
    assert.equal(a!.state.mixTrim, 0);
    assert.equal(d!.state.mixTrim, 0);
    await a!.command({ type: "mute", muted: true });
    await a!.command({ type: "mute", muted: false });
    assert.equal(a!.state.mixTrim, 100);
  } finally { await f.close(); }
});

test("The TV's volume keys raising or unmuting system sound count as raising sound", () => {
  const system = (volume: number | null, muted = false) => ({ selectedOutput: "tv", observedOutput: "tv", volume, muted, error: null });
  assert.equal(soundRaised(system(30), system(35)), true);
  assert.equal(soundRaised(system(30, true), system(30)), true);
  assert.equal(soundRaised(system(30), system(25)), false);
  assert.equal(soundRaised(system(30), system(35, true)), false);
  assert.equal(soundRaised(system(null), system(30)), false);
  assert.equal(soundRaised(undefined, system(30)), false);
});

test("A Playback saved before the All trim plays at 100", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-volume-")), path = join(directory, "couch.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE playback (id TEXT PRIMARY KEY, queue TEXT NOT NULL, cursor TEXT, continuation TEXT); INSERT INTO playback VALUES ('old', '[]', NULL, NULL)");
    legacy.close();
    const store = openStore(path);
    assert.equal(store.playback("old").mixTrim(), 100);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("A Playback keeps its All trim across a Core restart", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    const a = f.devices[0]!;
    await a.command(f.queue("first"));
    await a.command(f.queue("second"));
    await a.command({ type: "allSpeakers", level: 20 });
    const entryId = a.state.queue[0]!.id;
    const restarted = (await f.restart())[0]!;
    await restarted.command({ type: "play", entryId });
    assert.equal(restarted.state.mixTrim, 20);
    await until(() => level(restarted.messages) === 14);
  } finally { await f.close(); }
});
