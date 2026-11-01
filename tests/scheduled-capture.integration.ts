import { test } from "node:test";
import assert from "node:assert/strict";
import { createSendspin } from "../src/server/sendspin";
import { createScheduledAudio } from "../src/server/scheduled-audio";
import type { PlayerState } from "../src/shared/protocol";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string, ms = 5000) => { const deadline = Date.now() + ms; while (!check()) { if (Date.now() > deadline) throw new Error(message); await sleep(10); } };

test("repeated resume cannot leave a picture timeline running after Stop", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const states: PlayerState[] = [];
  const core = createScheduledAudio({ name: "Resume fixture", admit: () => false, changed() {} });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.send({ type: "load", playbackId: "pictures", source: "", duration: 60 });
  group.send({ type: "pause", playbackId: "pictures", paused: true });
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.send({ type: "stop" });
  const stopped = states.length;
  t.mock.timers.tick(100);
  assert.equal(states.length, stopped, "Stop retires every timeline callback");
  assert.equal(states.at(-1)!.status, "idle");
});

test("picture-only media has a controllable timeline without opening an audio decoder", { timeout: 5000 }, async t => {
  let lookups = 0; const states: PlayerState[] = [];
  const core = createSendspin({ name: "Picture fixture", admit: () => false, changed() {}, ffmpeg: async () => { lookups++; throw new Error("No audio decoder expected"); } });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.members([]); group.screens([]);
  group.send({ type: "load", playbackId: "pictures", source: "http://127.0.0.1:1/video-only.webm", duration: 60 });
  await until(() => states.at(-1)?.status === "playing", "picture timeline never started");
  assert.equal(lookups, 0);
  group.send({ type: "seek", playbackId: "pictures", position: 12 });
  group.send({ type: "pause", playbackId: "pictures", paused: true });
  await until(() => states.at(-1)?.status === "paused", "picture pause failed");
  assert.ok(states.at(-1)!.position >= 12);
  group.send({ type: "speed", playbackId: "pictures", speed: 1.5 });
  await until(() => states.at(-1)?.speed === 1.5, "picture speed failed");
  assert.equal(lookups, 0);
  group.send({ type: "pause", playbackId: "pictures", paused: false });
  group.members([{ deviceId: "new-sound", level: 100 }]);
  await until(() => lookups === 1, "adding sound did not transition to decoder");
});

test("a picture-only VOD without a listed duration ends at the length its screen reports", { timeout: 5000 }, async t => {
  const states: PlayerState[] = [];
  const core = createSendspin({ name: "Picture fixture", admit: () => false, changed() {}, ffmpeg: async () => { throw new Error("No audio decoder expected"); } });
  const group = core.group("pictures", state => states.push(state));
  t.after(() => { group.close(); core.close(); });
  group.members([]);
  group.send({ type: "load", playbackId: "pictures", source: "http://127.0.0.1:1/video-only.mp4" });
  await until(() => states.at(-1)?.status === "playing", "picture timeline never started");
  assert.equal(states.at(-1)!.duration, null);
  group.duration("other", 0.2);
  group.duration("pictures", 0.2);
  await until(() => states.at(-1)?.status === "ended", "the timeline never ended");
  assert.equal(states.at(-1)!.duration, 0.2);
});
