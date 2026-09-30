import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { AudioCodec, Identity, PlayerCommand, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "couch-mixer-trim-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const identities = [70, 40, 90, 55].map(volume => {
    const key = Identity.generate(), id = key.peerId, token = store.pair(id, `Device ${volume}`);
    store.saveDeviceSound(id, { volume });
    return { key, id, token };
  });
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [];
  const devices = await Promise.all(identities.map(async identity => {
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
  }));
  const queue = (id: string): Action => ({ type: "enqueue", entry: { id, title: id, source: `${hub.origin}/api/health` } });
  return { devices, queue, speaker: async (index: number) => {
    const device = devices[index]!, levels: number[] = [];
    const speaker = new SendspinClient(device.id, "Test speaker", [Roles.PLAYER], {
      encryption: { identity: device.key },
      playerSupport: { supported_formats: [{ codec: AudioCodec.PCM, channels: 2, sample_rate: 48_000, bit_depth: 16 }], buffer_capacity: 512 * 1024, supported_commands: [PlayerCommand.VOLUME] },
    });
    speakers.push(speaker);
    speaker.addServerCommandListener(command => { if (command.player?.command === PlayerCommand.VOLUME) levels.push(command.player.volume!); });
    await speaker.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3_000 });
    return levels;
  }, close: async () => {
    await Promise.all(speakers.map(speaker => speaker.disconnect()));
    for (const socket of sockets) socket.terminate();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  } };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected mixer state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

const renderedLevel = (messages: ServerMessage[]) => messages.findLast(message => message.type === "player" && message.command.type === "volume");

test("All is independent attenuation, restores from zero and preserves individual volume and mute", { timeout: 15_000 }, async () => {
  const f = await fixture(), device = f.devices[0]!;
  const level = () => { const message = renderedLevel(device.messages); return message?.type === "player" && message.command.type === "volume" ? message.command.volume : undefined; };
  try {
    await device.command(f.queue("first"));
    assert.equal(device.state.mixTrim, 100);
    const outputs = device.state.outputs;
    for (const trim of [50, 0, 100]) {
      await device.command({ type: "allSpeakers", level: trim });
      assert.equal(device.state.mixTrim, trim);
      assert.equal(device.state.player.volume, 70);
      assert.equal(device.state.devices?.find(item => item.id === device.id)?.volume, 70);
      assert.deepEqual(device.state.outputs, outputs);
      assert.equal(level(), Math.round(70 * trim / 100));
    }
    await device.command({ type: "allSpeakers", level: 50 });
    await device.command({ type: "volume", volume: 41 });
    assert.equal(device.state.mixTrim, 50);
    assert.equal(device.state.player.volume, 41);
    assert.equal(level(), 21);
    await device.command({ type: "volume", volume: 0 });
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(device.state.outputs?.[0]?.sound, true);
    assert.equal(level(), 0);
    await device.command({ type: "volume", volume: 41 });
    await device.command({ type: "mute", muted: true });
    assert.equal(level(), 0);
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(level(), 0);
    assert.equal(device.state.devices?.find(item => item.id === device.id)?.muted, true);
    await device.command({ type: "mute", muted: false });
    assert.equal(level(), 41);
    await device.command({ type: "output", deviceId: device.id, level: 0 });
    await device.command({ type: "allSpeakers", level: 0 });
    await device.command({ type: "allSpeakers", level: 100 });
    assert.equal(device.state.outputs?.[0]?.sound, false);
    assert.equal(level(), 0);
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
    const direct = renderedLevel(a!.messages);
    assert.equal(direct?.type === "player" && direct.command.type === "volume" && direct.command.volume, 35);
    await a!.command({ type: "allSpeakers", level: 100 });
    assert.equal(a!.state.outputs?.some(output => output.deviceId === b!.id), false);
  } finally { await f.close(); }
});
