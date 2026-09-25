import { seedConfiguredFixture } from "./configured-fixture";
seedConfiguredFixture();
import { strict as assert } from "node:assert";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { Diagnostics } from "../../src/shared/diagnostics";
import { remoteSocketUrl } from "./build";
import { assertNativeVideoPixels } from "./pixels";
import { UiDriver, keys, type Wait } from "./ui";

// The routine desktop gate intentionally covers only the process boundary. Feature
// behaviour belongs to the focused suites listed in native-coverage.md.
const origin = "http://127.0.0.1:4100", driverOrigin = "http://127.0.0.1:4444", artifacts = "/artifacts";
const revision = process.env.COUCH_SOURCE_REVISION!;
const mpvThreading = process.env.COUCH_TEST_MPV_THREADING === "1";
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(50);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
};
const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
  const response = await fetch(driverOrigin + path, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json() as { value: any };
  assert.ok(response.ok && !value.value?.error, `WebDriver ${path} succeeded: ${JSON.stringify(value.value)}`);
  return value.value;
};
const sidecar = async () => { try { return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } };
let session = "", state: SessionState | undefined;
const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
const tv = new UiDriver(request, () => session);
const media = Bun.serve({ hostname: "127.0.0.1", port: 4200, fetch: () => new Response(Bun.file("/mnt/fixtures/multitrack.mkv")) });
await Promise.all([Bun.write(`${artifacts}/smoke-driver.log`, ""), Bun.write(`${artifacts}/smoke-native.log`, "")]);
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifacts}/smoke-driver.log`), stderr: Bun.file(`${artifacts}/smoke-native.log`) });
let controller: WebSocket | undefined;
const connect = async (token: string) => {
  state = undefined;
  controller = new (WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket })(await remoteSocketUrl(origin, token), { headers: { origin } });
  controller.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
    else if (message.type === "result") {
      const request = pending.get(message.requestId);
      pending.delete(message.requestId);
      message.ok ? request?.resolve() : request?.reject(new Error(message.error || "Command rejected"));
    }
  };
};
const command = (action: Action) => {
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${action.type} acknowledgement timed out`)); }, 5_000);
    pending.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
    controller!.send(JSON.stringify({ type: "command", requestId, action }));
  });
};

try {
  assert.match(revision, /^[a-f0-9]{40}$/, "launcher supplies the immutable source revision");
  await until("Tauri WebDriver starts", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  if (process.env.COUCH_TEST_DESKTOP_SMOKE === "1") await request(`/session/${session}/window/rect`, { x: 0, y: 0, width: 1280, height: 800 });
  await until("compiled Tauri app starts its compiled sidecar", sidecar, 30_000);
  if (process.env.COUCH_TEST_DESKTOP_SMOKE === "1") {
    const placed = Bun.spawn(["xdotool", "search", "--onlyvisible", "--name", "^Couch$", "windowmove", "100", "100"]);
    assert.equal(await placed.exited, 0, "desktop smoke places the native window inside Xvfb before pixel sampling");
  }
  await tv.button("Settings");
  await tv.settingsSection("connection");
  await tv.button("Pair a remote", 'section[aria-label="Settings"]');
  await until("native app presents a pairing code", async () => /^\d{6}$/.test(await tv.pairingCode().catch(() => "")));
  const code = await tv.pairingCode();
  await tv.key(keys.escape);
  const paired = await fetch(`${origin}/api/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  assert.equal(paired.status, 200);
  const token = (await paired.json() as { token: string }).token;
  await connect(token);
  await until("paired controller receives the idle native state", () => state?.player.status === "idle");
  const build = await (await fetch(`${origin}/api/build`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(build.revision, revision, "running sidecar identifies the launched revision");
  assert.equal(build.dirty, false, "native smoke starts from a clean build");

  await tv.addDirectMedia("http://127.0.0.1:4200/generated-local-media.mkv");
  await until("native app queues generated local media", () => state?.queue.length === 1 && state.queue[0]?.title === "127.0.0.1/generated-local-media.mkv");
  const entryId = state!.queue[0]!.id;
  if (mpvThreading) {
    assert.equal(process.env.TAURI_VIDEO_TELEMETRY, "1", "threading qualification records native frame telemetry");
    await command({ type: "enqueue", entry: { ...state!.queue[0]!, id: crypto.randomUUID(), title: "Replacement local media" } });
    await until("replacement source is queued", () => state?.queue.length === 2);
  }
  await command({ type: "play", entryId, fromStart: true });
  await until("one paired-controller Play command reaches libmpv", () => state?.currentEntryId === entryId && state.player.status === "playing" && state.player.position > 0);
  await tv.watching();
  await assertNativeVideoPixels(tv.execute, artifacts, "native-smoke-video");
  checks.push("native pixels show generated local media");

  if (mpvThreading) {
    const latency: Record<string, number> = {};
    const measured = async (name: string, action: Action) => {
      const started = performance.now();
      await command(action);
      latency[name] = Number((performance.now() - started).toFixed(2));
      return started;
    };
    const firstPlayback = state!.player.playbackId!;
    for (const position of [4, 8, 2]) {
      const started = await measured(`seek-${position}`, { type: "seek", playbackId: firstPlayback, position });
      await until(`seek ${position} keeps the native position truthful`, () => state?.player.playbackId === firstPlayback && Math.abs(state.player.position - position) < 1.5);
      latency[`seek-${position}-observed`] = Number((performance.now() - started).toFixed(2));
    }
    const beforeDiagnostics = state!.player.position;
    const collected = performance.now();
    const exported = await fetch(`${origin}/api/diagnostics/export`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    latency.diagnostics = Number((performance.now() - collected).toFixed(2));
    assert.equal(exported.status, 200);
    const report = await exported.json() as Diagnostics;
    assert.ok(report.native?.facts.some(fact => fact.name === "mpv version" && fact.value));
    await until("diagnostics leave native playback advancing", () => state?.player.playbackId === firstPlayback && state.player.position > beforeDiagnostics);

    const replacement = state!.queue[1]!.id;
    const replacementStarted = await measured("replacement", { type: "play", entryId: replacement, fromStart: true });
    await until("replacement owns the observed queue and picture", () => state?.currentEntryId === replacement && state.player.status === "playing" && state.player.playbackId !== firstPlayback && state.player.position > 0);
    latency["replacement-observed"] = Number((performance.now() - replacementStarted).toFixed(2));
    await assertNativeVideoPixels(tv.execute, artifacts, "native-replacement-video");
    const stopStarted = await measured("stop", { type: "stop" });
    await until("Stop leaves no active native playback", () => state?.currentEntryId === null && state.player.status === "idle" && state.player.playbackId === null);
    latency["stop-observed"] = Number((performance.now() - stopStarted).toFixed(2));
    await command({ type: "seek", playbackId: firstPlayback, position: 17 }).catch(() => {});
    await Bun.sleep(500);
    assert.equal(state?.player.status, "idle", "a stale seek cannot revive the stopped source");

    const log = await Bun.file(`${artifacts}/smoke-native.log`).text();
    const frames = [...log.matchAll(/mpv telemetry: presented=(\d+) dropped=(\d+) fps=([\d.]+)/g)]
      .map(([, presented, dropped, fps]) => ({ presented: Number(presented), dropped: Number(dropped), fps: Number(fps) }));
    assert.ok(frames.length > 0 && frames.some(frame => frame.presented > 0 && frame.fps > 0), "GTK presented native frames during control calls");
    assert.ok(!log.includes("mpv_render_context_render() not being called or stuck"), "libmpv reported no stuck render");
    await Bun.write(`${artifacts}/gtk-mpv-threading.json`, JSON.stringify({ revision, latency, frames, nativePixels: ["native-smoke-video.png", "native-replacement-video.png"], stuckRenderLog: false, diagnosticsMs: latency.diagnostics, checks }, null, 2));
  }

  const queuedIds = state!.queue.map(item => item.id).join();
  controller.close();
  await request(`/session/${session}`, undefined, "DELETE");
  session = "";
  await until("closing the compiled desktop app stops its sidecar", async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } });
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("restarted compiled desktop app starts its sidecar", sidecar, 30_000);
  await connect(token);
  await until("paired queue persists across restart without autoplay", () => state?.queue.map(item => item.id).join() === queuedIds && state.currentEntryId === null && state.player.status === "idle");

  const binaries = await Bun.file(`${artifacts}/binaries.sha256`).text();
  assert.match(binaries, /\/work\/bin\/couch$/m, "receipt includes the launched Tauri binary hash");
  await Bun.write(`${artifacts}/results.json`, JSON.stringify({ revision, build, binaries, checks, nativePixels: "native-smoke-video.png", limitations: "Xvfb software rendering and a PulseAudio null sink prove neither physical display nor audio hardware." }, null, 2));
} finally {
  controller?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill();
  await driver.exited;
  await media.stop(true);
}
