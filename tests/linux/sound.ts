import { strict as assert } from "node:assert";
import { createSound } from "../../src/server/sound";
let idle = true, holds = 0;
const sound = createSound({ available: true, idle: () => idle, begin: () => { holds++; return () => { holds--; }; } });
const identity = () => ({ authority: "administrator" }) as any;
async function api(path = "", body?: unknown) {
 const response = await sound.handle(new Request(`http://localhost/api/sound${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), identity);
 const result: any = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
async function until(fn: () => Promise<boolean>, ms = 5000) {
 const deadline = Date.now() + ms;
 while (!await fn()) { assert.ok(Date.now() < deadline, "Timed out"); await Bun.sleep(50); }
}
const before = await api();
await Bun.write("/artifacts/before.json", JSON.stringify(before, null, 2));
assert.equal(before.defaultOutput, "couch_test_analog");
const capture = Bun.spawn(["parec", "--device=couch_test_hdmi.monitor", "--format=s16le", "--rate=48000", "--channels=2"], { stdout: Bun.file("/artifacts/tone.pcm"), stderr: "ignore" });
const began = performance.now();
await api("/test", { output: "couch_test_hdmi" });
assert.equal(holds, 1);
await until(async () => (await api()).test.status === "finished");
const duration = performance.now() - began;
assert.ok(duration < 4000, String(duration));
assert.equal(holds, 0);
capture.kill(); await capture.exited;
const pcm = new Int16Array(await Bun.file("/artifacts/tone.pcm").arrayBuffer());
assert.ok(pcm.some(value => value !== 0), "Requested null-sink monitor must contain actual audio samples");
let state = await api();
assert.equal(state.test.observedOutput, "couch_test_hdmi");
assert.equal(state.defaultOutput, before.defaultOutput);
assert.equal(state.outputs.find((output: any) => output.id === "couch_test_hdmi").volume, before.outputs.find((output: any) => output.id === "couch_test_hdmi").volume);
state = await api("/test", { output: "couch_test_hdmi" });
await api("/stop", { testId: state.test.id }); assert.equal((await api()).test.status, "stopped"); assert.equal(holds, 0);
await api("/test", { output: "couch_test_hdmi" });
idle = false; sound.interrupt(); assert.equal((await api()).test.status, "stopped"); assert.equal(holds, 0);
idle = true;
sound.close();
await Bun.write("/artifacts/result.json", JSON.stringify({ durationMs: duration, observedOutput: "couch_test_hdmi", nonzeroAudio: true, defaultPreserved: true, volumePreserved: true, stop: true, playbackInterrupt: true }, null, 2));
console.log("PASS real PulseAudio null-output route, audio samples, timeout, stop, playback interruption and preserved default/volume");
