import { expect, test } from "bun:test";
import { createSound } from "./sound";
import { soundOutputs, testTone, type SoundBackend } from "./sound-pulse";
import type { ControllerIdentity } from "../shared/controllers";
const administrator = () => ({ authority: "administrator" }) as ControllerIdentity;
const output = { id: "sink.hdmi", name: "HDMI TV", state: "IDLE", availability: "available" as const, muted: false, volume: 65 };
const request = (path = "", body?: unknown) => new Request(`http://localhost/api/sound${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function fixture() {
  let idle = true, stopped = 0, holds = 0, launches = 0;
  let route: string | null = output.id;
  const backend: SoundBackend = {
    inventory: async () => ({ outputs: [output], defaultOutput: output.id }),
    start: () => { launches++; return { pid: 42, exited: new Promise(() => {}), stop: () => { stopped++; } }; },
    route: async () => route,
  };
  const sound = createSound({ available: true, idle: () => idle, begin: () => { holds++; return () => { holds--; }; }, backend });
  return { sound, backend, idle: (value: boolean) => { idle = value; }, route: (value: string | null) => { route = value; }, counts: () => ({ stopped, holds, launches }) };
}
test("only administrators may inspect or test the output", async () => {
  const f = fixture();
  try {
    expect((await f.sound.handle(request(), () => null)).status).toBe(401);
    expect((await f.sound.handle(request("/test", { output: output.id }), () => ({ authority: "controller" }) as ControllerIdentity)).status).toBe(403);
    expect(f.counts().launches).toBe(0);
  } finally { f.sound.close(); }
});
test("idle and current output are required before any sound process starts", async () => {
  const f = fixture();
  try {
    f.idle(false);
    expect((await f.sound.handle(request("/test", { output: output.id }), administrator)).status).toBe(409);
    f.idle(true);
    expect((await f.sound.handle(request("/test", { output: "missing" }), administrator)).status).toBe(409);
    expect(f.counts().launches).toBe(0);
  } finally { f.sound.close(); }
});
test("confirmed route, stoppable test and stale stop rejection", async () => {
  const f = fixture();
  try {
    await f.sound.handle(request("/test", { output: output.id }), administrator);
    const started = await (await f.sound.handle(request(), administrator)).json();
    expect(started.test.observedOutput).toBe(output.id);
    expect(started.test.status).toBe("playing");
    expect(f.counts().holds).toBe(1);
    expect((await f.sound.handle(request("/test", { output: output.id }), administrator)).status).toBe(409);
    expect((await f.sound.handle(request("/stop", { testId: "stale" }), administrator)).status).toBe(409);
    expect((await f.sound.handle(request("/stop", { testId: started.test.id }), administrator)).status).toBe(200);
    expect(f.counts()).toEqual({ stopped: 1, holds: 0, launches: 1 });
  } finally { f.sound.close(); }
});
test("playback interruption and route mismatch stop the test without resuming media", async () => {
  const f = fixture();
  try {
    await f.sound.handle(request("/test", { output: output.id }), administrator);
    f.idle(false); f.sound.interrupt();
    expect(f.counts()).toEqual({ stopped: 1, holds: 0, launches: 1 });
    f.idle(true); f.route("other-speakers");
    await f.sound.handle(request("/test", { output: output.id }), administrator);
    const state = await (await f.sound.handle(request(), administrator)).json();
    expect(state.test.status).toBe("error");
    expect(f.counts()).toEqual({ stopped: 2, holds: 0, launches: 2 });
  } finally { f.sound.close(); }
});
test("revocation and playback changes during inventory block launch", async () => {
  const f = fixture();
  try {
    let authorized = true;
    f.backend.inventory = async () => { authorized = false; return { outputs: [output], defaultOutput: output.id }; };
    expect((await f.sound.handle(request("/test", { output: output.id }), () => authorized ? administrator() : null)).status).toBe(401);
    expect(f.counts().launches).toBe(0);
  } finally { f.sound.close(); }
});
test("output facts preserve unavailable/mute and report observed channel volume", () => {
  expect(soundOutputs([{ index: 1, name: "hdmi", description: "HDMI TV", mute: true, active_port: "hdmi-port", ports: [{ name: "hdmi-port", availability: "not available" }], volume: { left: { value: 32768 }, right: { value: 65536 } } }])).toEqual([{ testBlocked: null, id: "hdmi", name: "HDMI TV", state: "Unknown", muted: true, availability: "unavailable", volume: 100 }]);
});
test("test PCM is exactly three seconds with a controlled peak and initial silence", () => {
  const bytes = testTone();
  expect(bytes.length).toBe(48000 * 3 * 2 * 2);
  const samples = new Int16Array(bytes.buffer);
  expect(samples.slice(0, 9600 * 2).every(sample => sample === 0)).toBe(true);
  expect(samples.some(sample => sample !== 0)).toBe(true);
  expect(samples.every(sample => Math.abs(sample) <= 3932)).toBe(true);
});

test("legacy flat-volume outputs cannot raise system volume through a test stream", () => {
  expect(soundOutputs([{ index: 1, name: "speakers", flags: ["FLAT_VOLUME"] }])[0]!.testBlocked).toContain("preserve your output level");
});
test("muted outputs and audio-server failures never launch a tone", async () => {
  const f = fixture();
  try {
    f.backend.inventory = async () => ({ outputs: [{ ...output, muted: true }], defaultOutput: output.id });
    expect((await f.sound.handle(request("/test", { output: output.id }), administrator)).status).toBe(409);
    f.backend.inventory = async () => { throw new Error("Audio server offline"); };
    expect((await f.sound.handle(request("/test", { output: output.id }), administrator)).status).toBe(503);
    expect(f.counts().launches).toBe(0);
  } finally { f.sound.close(); }
});
