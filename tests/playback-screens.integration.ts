import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { Action, MediaTrack, PlayerState, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Expected state was not published."); await new Promise(resolve => setTimeout(resolve, 10)); }
}

// A sleeping laptop's tab reconnects on every DarkWake, becomes a screen again and reports before its
// media has loaded. The TV's state must keep the picture, or its player shows the HUD (user-1).
test("a screen still loading doesn't take the picture out of a Synced Playback", { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-playback-screens-")), databasePath = join(directory, "couch.sqlite");
  const store = openStore(databasePath, true);
  const tvId = "t".repeat(43), laptopId = "l".repeat(43);
  const tokens = { [tvId]: store.pair(tvId, "TV"), [laptopId]: store.pair(laptopId, "Laptop") };
  store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  const connect = async (id: string) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${tokens[id]}&device=${id}&audio=1&video=1`, { headers: { Origin: hub.origin } });
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
    return { messages, get state() { return state!; },
      report: (player: Partial<PlayerState>) => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, buffering: false, duration: 100, seekable: true, speed: 1, ...player } })),
      command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
        const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
      }) };
  };
  const loads = (messages: ServerMessage[]) => messages.filter(message => message.type === "player" && message.command.type === "load").length;
  const kinds = (tracks: MediaTrack[] | undefined) => tracks?.map(track => track.kind).sort() ?? [];
  try {
    const tv = await connect(tvId), laptop = await connect(laptopId);
    assert.equal((await tv.command({ type: "enqueue", entry: { id: "film", title: "Film", source: `${hub.origin}/api/health` }, playNow: true, deviceId: tvId })).ok, true);
    await until(() => loads(tv.messages) === 1);
    const playbackId = tv.state.player.playbackId!;
    const picture: MediaTrack[] = [{ id: "video", index: 0, kind: "video", label: "Video", language: "", selected: true }, { id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true }];
    // Paused, so the Sendspin group needs no FFmpeg when the laptop's picture makes it Synced.
    tv.report({ playbackId, status: "paused", tracks: picture });
    await until(() => tv.state.player.status === "paused");
    assert.equal((await tv.command({ type: "output", deviceId: laptopId, picture: true })).ok, true);
    await until(() => loads(laptop.messages) === 1);
    tv.report({ playbackId, status: "paused", tracks: picture });
    await until(() => kinds(tv.state.player.tracks).includes("video"));
    laptop.report({ playbackId, status: "loading", tracks: [] });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(kinds(tv.state.player.tracks), ["audio", "video"]);
  } finally {
    for (const socket of sockets) socket.terminate();
    await hub.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
