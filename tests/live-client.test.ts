import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Each browser session gets its own module globals and clock.
const check = (source: string) => {
  const result = spawnSync(process.execPath, ["-e", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    mock.module("./src/client/session/native-context.ts", () => ({ couchApp: undefined }));
    mock.module("./src/client/session/device-id.ts", () => ({ deviceId: () => "receiver", localDeviceName: () => "Receiver" }));
    mock.module("./src/client/session/renderer.ts", () => ({ attachLive() {}, detachLive() {}, play() {} }));
    let now = 0, nextTimer = 0;
    const timers = new Map();
    globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    const advance = milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].callback();
      }
      now = target;
    };
    const peers = [], failures = [];
    globalThis.RTCPeerConnection = class {
      connectionState = "new";
      signalingState = "stable";
      constructor(configuration) { this.configuration = configuration; peers.push(this); }
      close() { this.connectionState = this.signalingState = "closed"; this.onconnectionstatechange?.(); }
    };
    globalThis.MediaStream = class { getTracks() { return []; } };
    const { createLiveSession } = await import("./src/client/session/live.ts");
    const iceServers = [{ urls: "turn:relay.example:3478?transport=tcp", username: "fixture", credential: "fixture-credential" }];
    const session = createLiveSession({ iceServers, command: async () => {}, send() {}, failed: state => failures.push(state), published() {} });
    const load = playbackId => ({ type: "load", id: playbackId, playbackId, liveSourceId: "screen", livePeerId: playbackId, liveOutput: { picture: true, sound: true, volume: 80 } });
    ${source}
    session.close();
    assert.equal(timers.size, 0, "closing a session retires its connection deadline");
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
};

test("live peers use the authenticated standard ICE configuration", () => check(`
  session.play(load("one"));
  assert.deepEqual(peers[0].configuration.iceServers, iceServers);
`));

test("a live receiver with no network connection stops buffering after 30 seconds", () => check(`
  session.play(load("one"));
  advance(29999);
  assert.equal(failures.length, 0);
  advance(1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].playbackId, "one");
  assert.equal(failures[0].status, "error");
  assert.equal(failures[0].buffering, false);
  assert.match(failures[0].error, /connect/i);
  assert.equal(peers[0].connectionState, "closed");
`));

test("connected receivers and replaced or stopped loads never report a stale timeout", () => check(`
  session.play(load("old"));
  advance(20000);
  session.play(load("current"));
  advance(10000);
  assert.equal(failures.length, 0);
  peers[1].connectionState = "connected";
  peers[1].onconnectionstatechange();
  advance(60000);
  assert.equal(failures.length, 0);
  session.play(load("stopped"));
  session.play({ type: "stop" });
  advance(30000);
  assert.equal(failures.length, 0);
`));
