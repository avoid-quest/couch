import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { createSound } from "../src/server/sound";
import { createSoundRouting } from "../src/server/sound-routing";

// Replace only the Linux process boundary; exercise the real inventory, API,
// subscription and routing lifecycle on Core's Node runtime without hardware.
function audioSession(t: TestContext) {
  let failure: "ENOENT" | "ECONNREFUSED" | "invalid" | null = "ENOENT";
  const subscribers: Array<EventEmitter & { stdout: PassThrough; kill: () => void }> = [];
  const readdir = fs.readdirSync, exists = fs.existsSync;
  const calls = { queries: 0, subscriptions: 0 };
  t.mock.method(fs, "existsSync", path => path === "/usr/bin/pactl" ? failure !== "ENOENT" : exists(path));
  t.mock.method(fs, "readdirSync", (path, ...args) => path === "/proc" ? [] : readdir(path, ...args));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(childProcess, "execFile", (_file, args, _options, callback) => {
    calls.queries++;
    const failed = failure;
    queueMicrotask(() => {
      if (failed === "ENOENT" || failed === "ECONNREFUSED") return callback(Object.assign(new Error("private subprocess detail"), { code: failed }), "");
      const value = args.includes("sinks") ? [{ index: 1, name: "speakers", volume: { left: { value: 32768 } } }] : [];
      callback(null, failed === "invalid" ? "private invalid response" : args[0] === "get-default-sink" ? "speakers" : JSON.stringify(value));
    });
  });
  t.mock.method(childProcess, "spawn", () => {
    calls.subscriptions++;
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill() { this.stdout.end(); } });
    subscribers.push(child);
    queueMicrotask(() => {
      if (failure === "ENOENT") child.emit("error", new Error("missing pactl"));
      else { child.emit("spawn"); if (failure) child.stdout.end(); }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { calls, subscribers, set: (value: typeof failure) => { failure = value; } };
}

const flush = async () => { for (let i = 0; i < 10; i++) await setImmediate(); };

test("sound settings explains missing tools and audio services without exposing subprocess output", async t => {
  const session = audioSession(t);
  const sound = createSound({ available: true, idle: () => true });
  t.after(() => sound.close());
  const request = () => sound.handle(new Request("http://localhost/api/sound"), () => ({ authority: "host", device: null, claimAvailable: false }));
  let response = await request();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Install pulseaudio-utils/);
  session.set("ECONNREFUSED");
  response = await request();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /pactl info.*pipewire-pulse.*ALSA/);
  session.set("invalid");
  assert.deepEqual(await (await request()).json(), { error: "Couldn't read sound settings." });
  session.set(null);
  response = await request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outputs[0].id, "speakers");
});

test("a repaired audio session clears the startup failure without a server event", async t => {
  const session = audioSession(t);
  let saved: string | null = null;
  const routing = createSoundRouting({ saved: () => saved, save: output => { saved = output; }, active: () => false, lost: () => assert.fail("idle playback was interrupted"), changed() {} });
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

test("audio session loss interrupts playback and recovery preserves its saved output", async t => {
  const session = audioSession(t);
  session.set(null);
  let active = true, interruptions = 0;
  const routing = createSoundRouting({ saved: () => "speakers", save: () => assert.fail("saved output changed"), active: () => active, lost: () => { interruptions++; active = false; }, changed() {} });
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


test("missing pactl retries availability without spawning and recovers after installation", async t => {
  const session = audioSession(t);
  const routing = createSoundRouting({ saved: () => "speakers", save: () => {}, active: () => false, lost: () => assert.fail("idle playback interrupted"), changed() {} });
  t.after(() => routing.close());
  for (let i = 0; i < 4; i++) { await flush(); t.mock.timers.tick(5_000); await flush(); t.mock.timers.tick(250); }
  await flush();
  assert.deepEqual(session.calls, { queries: 0, subscriptions: 0 }, "missing helper spawned on the audio bridge's event loop");
  assert.match(routing.state.error!, /Install pulseaudio-utils/);
  session.set(null); t.mock.timers.tick(5_000); await flush(); t.mock.timers.tick(250); await flush();
  assert.equal(session.calls.subscriptions, 1);
  assert.ok(session.calls.queries > 0);
  assert.equal(routing.state.error, null);
  const before = { ...session.calls }; routing.close(); t.mock.timers.tick(10_000); await flush();
  assert.deepEqual(session.calls, before, "closed routing restarted a helper");
});
