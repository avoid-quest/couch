import { strict as assert } from "node:assert";
import { remoteSocketUrl } from "./build";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import { UiDriver } from "./ui";
import { addTVFolder } from "./folder-settings";
import type { LibraryItem } from "../../src/shared/library";

const origin = "http://127.0.0.1:4100", driverOrigin = "http://127.0.0.1:4444";
const checks: string[] = [];
async function until(name: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= deadline) { await Bun.write("/artifacts/sound-failure-state.json", JSON.stringify({ check: name, state }, null, 2)); throw new Error(name); }
    await Bun.sleep(50);
  }
  checks.push(name); console.log(`PASS ${name}`);
}
async function pactl(...args: string[]) {
  const child = Bun.spawn(["pactl", ...args], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(child.stdout).text(); assert.equal(await child.exited, 0); return text.trim();
}
async function wd(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const json = await response.json() as any;
  assert.ok(response.ok && !json.value?.error, `WebDriver ${JSON.stringify(json.value)}`); return json.value;
}
let sessionId = "", token = "", state: SessionState | null = null, socket: WebSocket;
const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
const ui = new UiDriver(wd, () => sessionId);
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file("/artifacts/sound-driver.log"), stderr: Bun.file("/artifacts/sound-native.log") });
const media = Bun.serve({ hostname: "127.0.0.1", port: 4204, fetch: () => new Response(Bun.file("/work/sound.wav")) });
const command = (action: Action) => new Promise<void>((resolve, reject) => {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Command timed out")); }, 5_000);
  pending.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
  socket.send(JSON.stringify({ type: "command", requestId, action }));
});
async function api(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); assert.ok(response.ok, `HTTP ${response.status} ${JSON.stringify(result)}`); return result;
}
async function connect() {
  socket = new (WebSocket as any)(await remoteSocketUrl(origin, token), { headers: { origin } });
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
    else if (message.type === "result") {
      const item = pending.get(message.requestId); pending.delete(message.requestId);
      if (message.ok) item?.resolve(); else item?.reject(new Error(message.error));
    }
  };
  await until("paired remote connected", () => socket.readyState === WebSocket.OPEN && state?.player.status === "idle");
}
async function launch() {
  sessionId = (await wd("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
}
let hdmi = await pactl("load-module", "module-null-sink", "sink_name=couch_sound_hdmi", "sink_properties=device.description=HDMI_Test");
await pactl("load-module", "module-null-sink", "sink_name=couch_sound_analog", "sink_properties=device.description=Analog_Test");
await pactl("set-default-sink", "couch_sound_hdmi");
await pactl("set-sink-volume", "couch_sound_hdmi", "64%");
try {
  await until("official Tauri driver ready", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  await launch();
  await until("native setup exposes pairing and separate claim codes", () => ui.execute("return !!document.querySelector('[data-pairing-code]') && !!document.querySelector('[data-administrator-code]')"));
  const codes = await ui.execute("return { pair: document.querySelector('[data-pairing-code]').textContent, claim: document.querySelector('[data-administrator-code]').textContent }");
  token = (await api("/api/pair", { code: codes.pair })).token;
  await api("/api/controllers/claim", { code: codes.claim });
  await connect();
  await until("system sink readback", () => state?.systemAudio?.volume === 64);
  await api("/api/sound/delay", { delay: 0.25 });
  await command({ type: "enqueue", entry: { id: "sound", title: "Sound qualification", source: "http://127.0.0.1:4204/sound.wav" }, playNow: true });
  await until("native PCM stream on saved HDMI sink", () => state?.player.status === "playing" && state.systemAudio?.observedOutput === "couch_sound_hdmi");
  await api("/api/sound/output", { output: "couch_sound_analog" });
  await until("current stream changes to analog with confirmed routing", () => state?.systemAudio?.observedOutput === "couch_sound_analog");
  await command({ type: "volume", volume: 31 }); await command({ type: "mute", muted: true });
  await until("shared system volume and mute", () => state?.player.volume === 31 && state.systemAudio?.muted === true);
  await pactl("set-sink-volume", "couch_sound_analog", "48%"); await pactl("set-sink-mute", "couch_sound_analog", "0");
  await until("external system changes reach the paired remote", () => state?.player.volume === 48 && state.systemAudio?.muted === false);
  await command({ type: "stop" }); await until("playback stopped", () => state?.player.status === "idle");
  await command({ type: "play", entryId: "sound" });
  await until("subsequent load uses saved analog and TV delay", () => state?.player.status === "playing" && state.systemAudio?.observedOutput === "couch_sound_analog" && state.player.audioDelay === 0.25);
  await api("/api/sound/output", { output: "couch_sound_hdmi" });
  await Bun.sleep(500);
  // Read only a synthetic output monitor, never a microphone.
  const silence = Bun.spawn(["pacat", "--playback", "--raw", "--device=couch_sound_analog", "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=50", "/dev/zero"], { stdout: "ignore", stderr: Bun.file("/artifacts/silence-clock.log") });
  const capture = Bun.spawn(["parec", "--device=couch_sound_analog.monitor", "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=50"], { stdout: Bun.file("/artifacts/fallback-monitor.pcm"), stderr: Bun.file("/artifacts/fallback-monitor.log") });
  await until("alternate monitor produces clocked samples before output loss", async () => (await Bun.file("/artifacts/fallback-monitor.pcm").stat()).size >= 4800);
  await pactl("unload-module", hdmi);
  await until("selected sink loss pauses seekable native media", () => state?.player.status === "paused" && !!state.player.error && !!state.systemAudio?.error);
  hdmi = await pactl("load-module", "module-null-sink", "sink_name=couch_sound_hdmi", "sink_properties=device.description=HDMI_Test");
  await until("reconnected output stays paused", () => state?.systemAudio?.error === null && state.player.status === "paused");
  await Bun.sleep(1_000); assert.equal(state!.player.status, "paused");
  capture.kill(); await capture.exited; silence.kill(); await silence.exited;
  const samples = new Int16Array(await Bun.file("/artifacts/fallback-monitor.pcm").arrayBuffer());
  assert.ok(samples.length > 0, "The alternate output monitor returned samples");
  assert.ok(samples.every(sample => sample === 0), "No audio may fall back to analog after HDMI disappears");
  checks.push("alternate output stays digitally silent throughout selected-output loss and reconnection");
  await command({ type: "pause", playbackId: state!.player.playbackId!, paused: false });
  await until("explicit resume restores native audio on HDMI", () => state?.player.status === "playing" && state.systemAudio?.observedOutput === "couch_sound_hdmi");
  await command({ type: "stop" }); await until("idle before restart", () => state?.player.status === "idle");
  await addTVFolder(ui, until, "sound-fixtures");
  let tracks: LibraryItem[] = [];
  await until("lossless boundary sources scanned", async () => {
    tracks = (await api("/api/library/items?q=Sound-&limit=10")).items.sort((a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title));
    return tracks.length === 2;
  });
  for (const [index, track] of tracks.entries()) await command({ type: "enqueueLibrary", itemId: track.id, entryId: `boundary-${index}` });
  await command({ type: "play", entryId: "boundary-0", fromStart: true });
  await until("native player adopts the queued successor", () => state?.currentEntryId === "boundary-1" && state.player.status === "playing");
  const successorId = state!.player.playbackId!;
  await pactl("unload-module", hdmi);
  await until("audio loss pauses the adopted successor with its current identity", () => state?.player.playbackId === successorId && state.player.status === "paused" && !!state.player.error);
  hdmi = await pactl("load-module", "module-null-sink", "sink_name=couch_sound_hdmi", "sink_properties=device.description=HDMI_Test");
  await until("successor remains paused after output reconnects", () => state?.systemAudio?.error === null && state.player.status === "paused");
  await Bun.sleep(1000); assert.equal(state!.player.status, "paused");
  await command({ type: "pause", playbackId: successorId, paused: false });
  await until("explicit successor resume retains its identity and restores audio", () => state?.player.playbackId === successorId && state.player.status === "playing" && state.systemAudio?.observedOutput === "couch_sound_hdmi");
  await command({ type: "stop" }); await until("idle after resumed successor", () => state?.player.status === "idle");
  socket.close(); await wd(`/session/${sessionId}`, undefined, "DELETE"); sessionId = ""; state = null;
  await launch(); await connect();
  await until("restart retains output and delay without autoplay", () => state?.systemAudio?.selectedOutput === "couch_sound_hdmi" && state.preferences?.device.audioDelay === 0.25 && state.player.status === "idle");
  await Bun.write("/artifacts/sound-routing-result.json", JSON.stringify({ checks, physicalAudibility: false }, null, 2));
} finally {
  socket!?.close(); if (sessionId) await wd(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill(); media.stop(true);
}
