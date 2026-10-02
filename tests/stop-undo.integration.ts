import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { Identity } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

const until = async (predicate: () => boolean, timeout = 3_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
};

test("Stop keeps the last item until its Undo has had time, then the Playback ends", { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-stop-undo-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const id = Identity.generate().peerId, token = store.pair(id, "Phone");
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}&audio=1&video=1`, { headers: { Origin: hub.origin } });
  let state: SessionState | undefined, sequence = 0;
  const pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
    if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
  };
  const command = (action: Action) => new Promise<void>((resolve, reject) => {
    const requestId = String(++sequence);
    pending.set(requestId, result => result.ok ? resolve() : reject(new Error(result.error)));
    socket.send(JSON.stringify({ type: "command", requestId, action }));
  });
  try {
    await new Promise(resolve => socket.once("open", resolve));
    await until(() => !!state);
    await command({ type: "enqueue", entry: { id: "film", title: "Film", source: `${hub.origin}/api/health` }, playNow: true });
    await until(() => state!.currentEntryId === "film");
    await command({ type: "stop" });
    // Undo plays the stopped item again, so it stays in its Playback a while.
    await new Promise(resolve => setTimeout(resolve, 1_000));
    assert.equal(state!.currentEntryId, null);
    assert.deepEqual(state!.queue.map(entry => entry.id), ["film"]);
    await command({ type: "play", entryId: "film" });
    await until(() => state!.currentEntryId === "film");
    // A Stop nobody undoes still ends the Playback.
    await command({ type: "stop" });
    await until(() => state!.queue.length === 0 && !state!.playback, 15_000);
  } finally {
    socket.terminate();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
