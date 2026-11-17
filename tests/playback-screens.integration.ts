import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type {
  Action,
  MediaTrack,
  PlayerState,
  ServerMessage,
  SessionState,
} from "../src/shared/protocol";
import { withState } from "./whole-state.fixture";
import { liveFixture } from "./live-input.fixture";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected state was not published.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// A sleeping laptop's tab reconnects on every DarkWake, becomes a screen again and reports before its
// media has loaded. The TV's state must keep the picture, or its player shows the HUD (user-1).
test(
  "a screen still loading doesn't take the picture out of a Synced Playback",
  { timeout: 20_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "couch-playback-screens-")),
      databasePath = join(directory, "couch.sqlite");
    const store = openStore(databasePath, true);
    const tvId = "t".repeat(43),
      laptopId = "l".repeat(43);
    const tokens = { [tvId]: store.pair(tvId, "TV"), [laptopId]: store.pair(laptopId, "Laptop") };
    store.close();
    const hub = await createHub({
      databasePath,
      hostToken: "h".repeat(64),
      hostname: "127.0.0.1",
      port: 0,
    });
    const sockets: WebSocket[] = [];
    const connect = async (id: string) => {
      const socket = new WebSocket(
        `${hub.origin.replace("http:", "ws:")}/api/ws?token=${tokens[id]}&device=${id}&audio=1&video=1`,
        { headers: { Origin: hub.origin } },
      );
      sockets.push(socket);
      const messages: ServerMessage[] = [],
        pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
      let state: SessionState | undefined,
        sequence = 0;
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.onmessage = (event) => {
          const message = withState(socket, JSON.parse(String(event.data)) as ServerMessage);
          messages.push(message);
          if (message.type === "state") {
            state = message.state;
            resolve();
          }
          if (message.type === "result") {
            pending.get(message.requestId)?.(message);
            pending.delete(message.requestId);
          }
        };
      });
      return {
        messages,
        get state() {
          return state!;
        },
        report: (player: Partial<PlayerState>) =>
          socket.send(
            JSON.stringify({
              type: "player",
              state: {
                ...state!.player,
                buffering: false,
                duration: 100,
                seekable: true,
                speed: 1,
                ...player,
              },
            }),
          ),
        command: (action: Action) =>
          new Promise<Extract<ServerMessage, { type: "result" }>>((resolve) => {
            const requestId = String(++sequence);
            pending.set(requestId, resolve);
            socket.send(JSON.stringify({ type: "command", requestId, action }));
          }),
      };
    };
    const loads = (messages: ServerMessage[]) =>
      messages.filter((message) => message.type === "player" && message.command.type === "load")
        .length;
    const kinds = (tracks: MediaTrack[] | undefined) =>
      tracks?.map((track) => track.kind).sort() ?? [];
    try {
      const tv = await connect(tvId),
        laptop = await connect(laptopId);
      assert.equal(
        (
          await tv.command({
            type: "enqueue",
            entry: { id: "film", title: "Film", source: `${hub.origin}/api/health` },
            playNow: true,
            deviceId: tvId,
          })
        ).ok,
        true,
      );
      await until(() => loads(tv.messages) === 1);
      const playbackId = tv.state.player.playbackId!;
      const picture: MediaTrack[] = [
        { id: "video", index: 0, kind: "video", label: "Video", language: "", selected: true },
        { id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true },
      ];
      // Paused, so the Sendspin group needs no FFmpeg when the laptop's picture makes it Synced.
      tv.report({ playbackId, status: "paused", tracks: picture });
      await until(() => tv.state.player.status === "paused");
      assert.equal(
        (await tv.command({ type: "output", deviceId: laptopId, picture: true })).ok,
        true,
      );
      await until(() => loads(laptop.messages) === 1);
      tv.report({ playbackId, status: "paused", tracks: picture });
      await until(() => kinds(tv.state.player.tracks).includes("video"));
      laptop.report({ playbackId, status: "loading", tracks: [] });
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(kinds(tv.state.player.tracks), ["audio", "video"]);
    } finally {
      for (const socket of sockets) socket.terminate();
      await hub.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

// Adding an output starts a new output generation; screens already showing the item keep playing.
test("a playing screen stays Playing when another output joins", { timeout: 20_000 }, async () => {
  const f = await liveFixture({ extraDevices: 1 });
  try {
    const tv = await f.connect(2, "&video=1&audio=1"),
      laptop = await f.connect(3, "&video=1&audio=1");
    await f.speaker(2);
    await f.receiver.command({
      type: "enqueue",
      entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` },
      playNow: true,
      deviceId: tv.id,
    });
    await until(() => !!tv.load());
    tv.report();
    await until(() => f.receiver.state.player.status === "playing");
    const loads = tv.messages.length;
    await f.receiver.command({ type: "output", deviceId: laptop.id, picture: true });
    await until(() => !!laptop.load() && tv.messages.slice(loads).some((m) => m.type === "player"));
    const states = () =>
      Object.fromEntries((f.receiver.state.outputs ?? []).map((o) => [o.deviceId, o.state]));
    const playing = () => states()[tv.id] === "playing" && states()[laptop.id] === "playing";
    const report = setInterval(() => {
      tv.report({ playbackId: tv.load()!.playbackId });
      laptop.report({ playbackId: laptop.load()!.playbackId });
    }, 100);
    try {
      await until(playing);
      await f.speaker(1);
      assert.equal(
        (await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 50 })).ok,
        true,
      );
      await until(() => states()[f.receiver.id] !== undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual([states()[tv.id], states()[laptop.id]], ["playing", "playing"]);
    } finally {
      clearInterval(report);
    }
  } finally {
    await f.close();
  }
});

// Back to Direct, the TV's follower loses the group's clock and pauses its picture before its own
// load arrives: the Playback still plays on as it did.
test(
  "a film playing on two screens plays on when one of them leaves",
  { timeout: 20_000 },
  async () => {
    const f = await liveFixture({ extraDevices: 1 });
    try {
      const tv = await f.connect(2, "&video=1"),
        laptop = await f.connect(3, "&video=1");
      await f.receiver.command({
        type: "enqueue",
        entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` },
        playNow: true,
        deviceId: tv.id,
      });
      await until(() => !!tv.load());
      tv.report();
      await until(() => f.receiver.state.player.status === "playing");
      await f.receiver.command({ type: "output", deviceId: laptop.id, picture: true });
      await until(
        () => !!laptop.load() && !!f.receiver.state.playbacks?.some((p) => p.mode === "relaxed"),
      );
      const loads = tv.messages.length;
      await f.receiver.command({ type: "output", deviceId: laptop.id, picture: false });
      tv.report({ playbackId: tv.load()!.playbackId, status: "paused", position: 12 });
      await until(() =>
        tv.messages.slice(loads).some((m) => m.type === "player" && m.command.type === "load"),
      );
      assert.notEqual(tv.load()!.paused, true);
    } finally {
      await f.close();
    }
  },
);

// Someone presses Pause on the TV while the film goes back to Direct and the TV confirms it before
// its load: the reload keeps it paused, not the play the group had when the handover began.
test(
  "a Pause pressed while a film goes back to one screen holds",
  { timeout: 20_000 },
  async () => {
    const f = await liveFixture({ extraDevices: 1 });
    try {
      const tv = await f.connect(2, "&video=1"),
        laptop = await f.connect(3, "&video=1");
      await f.receiver.command({
        type: "enqueue",
        entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` },
        playNow: true,
        deviceId: tv.id,
      });
      await until(() => !!tv.load());
      tv.report();
      await until(() => f.receiver.state.player.status === "playing");
      await f.receiver.command({ type: "output", deviceId: laptop.id, picture: true });
      await until(
        () => !!laptop.load() && !!f.receiver.state.playbacks?.some((p) => p.mode === "relaxed"),
      );
      const loads = tv.messages.length;
      const { playbackId } = tv.load()!;
      await f.receiver.command({ type: "output", deviceId: laptop.id, picture: false });
      void tv.command({ type: "pause", playbackId, paused: true });
      tv.report({ playbackId, status: "paused", position: 12 });
      await until(() =>
        tv.messages.slice(loads).some((m) => m.type === "player" && m.command.type === "load"),
      );
      assert.equal(tv.load()!.paused, true);
    } finally {
      await f.close();
    }
  },
);
