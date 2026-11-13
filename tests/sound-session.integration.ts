import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { createSoundRouting } from "../src/server/sound-routing";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { PlaybackCommand } from "../src/shared/protocol";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";

// Replace only the Linux process boundary; exercise the real inventory, API,
// subscription and routing lifecycle on Core's Node runtime without hardware.
function audioSession(t: TestContext) {
  let failure: "ENOENT" | "ECONNREFUSED" | "invalid" | null = "ENOENT";
  const subscribers: Array<EventEmitter & { stdout: PassThrough; kill: () => void }> = [];
  const readdir = fs.readdirSync,
    exists = fs.existsSync;
  t.mock.method(fs, "existsSync", (path) =>
    path === "/usr/bin/pactl" ? failure !== "ENOENT" : exists(path),
  );
  t.mock.method(fs, "readdirSync", (path, ...args) =>
    path === "/proc" ? [] : readdir(path, ...args),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(childProcess, "execFile", (_file, args, _options, callback) => {
    const failed = failure;
    queueMicrotask(() => {
      if (failed === "ENOENT" || failed === "ECONNREFUSED")
        return callback(
          Object.assign(new Error("private subprocess detail"), { code: failed }),
          "",
        );
      const value = args.includes("sinks")
        ? [{ index: 1, name: "speakers", volume: { left: { value: 32768 } } }]
        : [];
      callback(
        null,
        failed === "invalid"
          ? "private invalid response"
          : args[0] === "get-default-sink"
            ? "speakers"
            : JSON.stringify(value),
      );
    });
  });
  t.mock.method(childProcess, "spawn", () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill() {
        this.stdout.end();
      },
    });
    subscribers.push(child);
    queueMicrotask(() => {
      if (failure === "ENOENT") child.emit("error", new Error("missing pactl"));
      else {
        child.emit("spawn");
        if (failure) child.stdout.end();
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    subscribers,
    set: (value: typeof failure) => {
      failure = value;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await setImmediate();
};

test("a repaired audio session clears the startup failure without a server event", async (t) => {
  const session = audioSession(t);
  let saved: string | null = null;
  const routing = createSoundRouting({
    saved: () => saved,
    save: (output) => {
      saved = output;
    },
    active: () => false,
    lost: () => assert.fail("idle playback was interrupted"),
    changed() {},
  });
  t.after(() => routing.close());
  await flush();
  assert.ok(routing.state.error);
  assert.throws(() => routing.prepare());
  session.set(null);
  t.mock.timers.tick(5_000);
  await flush();
  t.mock.timers.tick(250);
  await flush();
  assert.equal(session.subscribers.length, 1);
  assert.equal(routing.state.error, null);
  assert.equal(routing.prepare(), "speakers");
});

test("audio session loss interrupts playback and recovery preserves its saved output", async (t) => {
  const session = audioSession(t);
  session.set(null);
  let active = true,
    interruptions = 0;
  const routing = createSoundRouting({
    saved: () => "speakers",
    save: () => assert.fail("saved output changed"),
    active: () => active,
    lost: () => {
      interruptions++;
      active = false;
    },
    changed() {},
  });
  t.after(() => routing.close());
  await flush();
  assert.equal(routing.state.error, null);
  session.set("ECONNREFUSED");
  session.subscribers[0]!.stdout.end();
  await flush();
  t.mock.timers.tick(250);
  await flush();
  assert.equal(interruptions, 1);
  assert.match(routing.state.error!, /pactl info/);
  session.set(null);
  t.mock.timers.tick(5_000);
  await flush();
  t.mock.timers.tick(250);
  await flush();
  assert.equal(routing.state.error, null);
  assert.equal(routing.prepare(), "speakers");
  assert.equal(active, false, "recovery must not resume playback");
  routing.close();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(session.subscribers.length, 2, "closed routing resubscribed");
});

for (const destination of ["browser", "host picture"] as const)
  test(
    `${destination} playback resumes without the host's audio session`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const exists = fs.existsSync;
      t.mock.method(fs, "existsSync", (path) => (path === "/usr/bin/pactl" ? false : exists(path)));
      syncBuiltinESMExports();
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      const f = await authorityFixture(t, { native: true });
      try {
        const publisher = await f.connect(f.devices[1]);
        const receiver = await f.connect(
          destination === "browser" ? f.devices[2] : f.host,
          "&audio=1&video=1",
        );
        resultOk(
          await publisher.command({
            type: "publishLive",
            sourceId: "screen",
            uploadToken: "1".repeat(64),
            kind: "screen",
            audio: destination === "browser",
            video: true,
          }),
        );
        resultOk(
          await receiver.command({ type: "playLive", sourceId: "screen", deviceId: receiver.id }),
        );
        await until(() => !!receiver.state.player.playbackId);
        const playbackId = receiver.state.player.playbackId!;
        receiver.report({ status: "playing", playbackId });
        await until(() => receiver.state.player.status === "playing");
        resultOk(await receiver.command({ type: "pause", playbackId, paused: true }));
        receiver.report({ status: "paused", playbackId });
        await until(() => receiver.state.player.status === "paused");
        resultOk(await receiver.command({ type: "pause", playbackId, paused: false }));
        receiver.report({ status: "playing", playbackId });
        await until(() => receiver.state.player.status === "playing");
        if (destination === "browser") {
          const host = await f.connect(f.host);
          const local = await host.command({
            type: "playLive",
            sourceId: "screen",
            deviceId: host.id,
          });
          assert.equal(local.ok, false);
          assert.match(local.error!, /pactl/);
        }
      } finally {
        await f.close();
      }
    },
  );

test("losing an audio output while buffering preserves the paused programme for explicit resume", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const session = createSession(
    { ...store, ...store.playback("interrupted") },
    (command) => commands.push(command),
    () => {},
  );
  try {
    await session.command({
      type: "enqueue",
      entry: { id: "programme", title: "Programme", source: "https://media.example/movie.mp4" },
      playNow: true,
    });
    session.observe({
      ...session.state.player,
      status: "loading",
      buffering: true,
      seekable: true,
      position: 42,
      duration: 120,
    });
    const playbackId = session.state.player.playbackId!;
    session.audioLost("The sound output disconnected.");
    assert.equal(session.state.player.status, "paused");
    assert.equal(session.state.player.buffering, false);
    assert.equal(session.state.player.playbackId, playbackId);
    assert.equal(session.state.player.position, 42);
    assert.deepEqual(commands.at(-1), { type: "audioPause" });
    session.observe({ ...session.state.player, status: "playing", position: 43, error: null });
    assert.equal(
      session.state.player.status,
      "paused",
      "a refill report cannot resume interrupted playback",
    );
    assert.equal(session.state.player.position, 42);
    await session.command({ type: "pause", playbackId, paused: false });
    assert.deepEqual(commands.at(-1), { type: "pause", playbackId, paused: false });
    session.observe({ ...session.state.player, status: "playing", position: 42, error: null });
    assert.equal(session.state.player.status, "playing");
  } finally {
    session.close();
    store.close();
  }
});
