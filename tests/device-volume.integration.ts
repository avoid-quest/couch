import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

test("mute preserves the displayed volume and allows changing it before unmuting", { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-device-volume-"));
  const databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const id = "v".repeat(43);
  const token = store.pair(id, "Speaker");
  store.saveDeviceSound(id, { volume: 70 });
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}`, { headers: { Origin: hub.origin } });
  let state: SessionState;
  let requestSequence = 0;
  const results = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
  const initial = new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "state") { state = message.state; resolve(); }
      if (message.type === "result") { results.get(message.requestId)?.(message); results.delete(message.requestId); }
    };
  });
  const command = (action: Action) => new Promise<void>((resolve, reject) => {
    const requestId = String(++requestSequence);
    results.set(requestId, message => message.ok ? resolve() : reject(new Error(message.error)));
    socket.send(JSON.stringify({ type: "command", requestId, action }));
  });
  try {
    await initial;
    await command({ type: "control", deviceId: id });
    const deadline = Date.now() + 3_000;
    while (state!.controlling !== id) {
      if (Date.now() > deadline) throw new Error("The selected output was not published.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(state!.player.volume, 70);
    await command({ type: "mute", muted: true });
    assert.equal(state!.devices?.find(device => device.id === id)?.volume, 70);
    assert.equal(state!.player.volume, 70);
    await command({ type: "volume", volume: 50 });
    assert.equal(state!.devices?.find(device => device.id === id)?.muted, true);
    assert.equal(state!.player.volume, 50);
    await command({ type: "mute", muted: false });
    assert.equal(state!.player.volume, 50);
  } finally {
    socket.terminate();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
