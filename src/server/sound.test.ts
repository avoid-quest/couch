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

test("Ubuntu JSON card profiles expose output-only choices and retain active duplex for rollback", async () => {
  const { soundProfiles } = await import("./sound-pulse");
  const profiles = soundProfiles([{ index: 3, name: "alsa_card.pci-stable", active_profile: "output:hdmi+input:analog", properties: { "device.description": "Built-in Audio" }, profiles: {
    "output:analog": { description: "Analog Stereo Output", sinks: 1, sources: 0, available: true },
    "output:hdmi": { description: "HDMI", sinks: 1, sources: 0, available: false },
    "output:hdmi+input:analog": { description: "Duplex", sinks: 1, sources: 1, available: true },
  } }]);
  expect(profiles[0]).toMatchObject({ card: "alsa_card.pci-stable", id: "output:analog", available: true, selectable: true });
  expect(profiles[1]!.available).toBe(false);
  expect(profiles[2]).toMatchObject({ active: true, selectable: false });
});


test("PipeWire sink properties identify the ALSA and Bluetooth card without PulseAudio card indices", () => {
  const cards = [
    { index: 44, name: "alsa_card.pci-0000_00_1f.3" },
    { index: 215, name: "bluez_card.14_0F_92_24_EE_40", properties: { "api.bluez5.address": "14:0F:92:24:EE:40" } },
    { index: 33, name: "unrelated_card" },
  ];
  const outputs = soundOutputs([
    { index: 64, name: "alsa_output.pci-0000_00_1f.3.hdmi-stereo", properties: { "device.name": cards[0]!.name, "device.id": "44" } },
    { index: 216, name: "bluez_output.14_0F_92_24_EE_40.1", description: "C39S", properties: { "device.name": cards[1]!.name, "device.id": "33", "api.bluez5.address": "14:0F:92:24:EE:40" } },
  ], cards);
  expect(outputs[0]).toMatchObject({ card: cards[0]!.name });
  expect(outputs[1]).toMatchObject({ card: cards[1]!.name, bluetoothAddress: "14:0F:92:24:EE:40", name: "C39S" });
});

test("explicit PulseAudio card indices take precedence over PipeWire properties", () => {
  const cards = [{ index: 3, name: "pulse_card" }, { index: 7, name: "other_card" }];
  expect(soundOutputs([{ index: 1, name: "speakers", card: 3, properties: { "device.name": "other_card" } }], cards)[0]!.card).toBe("pulse_card");
  expect(soundOutputs([{ index: 2, name: "virtual", properties: { "device.id": "3" } }], cards)[0]!.card).toBeUndefined();
});
