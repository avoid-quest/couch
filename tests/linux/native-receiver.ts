import { strict as assert } from "node:assert";
import { mkdir, mkdtemp } from "node:fs/promises";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import { seedConfiguredFixture } from "./configured-fixture";
import { remoteSocketUrl } from "./build";
import { assertNativeVideoPixels } from "./pixels";
import { UiDriver, type Wait } from "./ui";

// Run in the existing Linux X11/DBus/PulseAudio fixture after a native build.
const artifacts = process.env.COUCH_ARTIFACTS ?? "/artifacts/native-receiver";
await mkdir(artifacts, { recursive: true });
const origin = "http://127.0.0.1:4201", driverOrigin = "http://127.0.0.1:4444";
const binary = process.env.COUCH_NATIVE_BINARY ?? "/work/bin/couch";
const sidecar = process.env.COUCH_NATIVE_SIDECAR ?? "/work/bin/couch-server";
const checks: string[] = [];
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < deadline, description); await Bun.sleep(50); }
  checks.push(description);
  console.log(`PASS ${description}`);
};
async function commandOutput(...command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(code, 0, `${command.join(" ")}: ${error}`);
  return output.trim();
}
async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(driverOrigin + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const result = await response.json() as { value: any };
  assert.ok(response.ok && !result.value?.error, `WebDriver ${path}: ${JSON.stringify(result.value)}`);
  return result.value;
}
const health = async () => { try { return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } };
const hostData = await mkdtemp("/tmp/couch-receiver-core-"), clientData = await mkdtemp("/tmp/couch-receiver-client-");
seedConfiguredFixture(hostData);
seedConfiguredFixture(clientData);
await Bun.write(`${clientData}/operating-mode.json`, JSON.stringify({ mode: "remote", address: origin, targets: [origin], localSetupComplete: true }));
const core = Bun.spawn([sidecar], { env: { ...process.env, COUCH_NATIVE: "0", COUCH_HOST: "127.0.0.1", COUCH_PORT: "4201", COUCH_ADVERTISE_URLS: origin, COUCH_DATA_DIR: hostData }, stdout: Bun.file(`${artifacts}/core.log`), stderr: Bun.file(`${artifacts}/core-error.log`) });
const driver = Bun.spawn(["tauri-driver"], { env: { ...process.env, COUCH_DATA_DIR: clientData, COUCH_TV_PRESENTATION: "0" }, stdout: Bun.file(`${artifacts}/driver.log`), stderr: Bun.file(`${artifacts}/native.log`) });
const media = Bun.serve({ hostname: "127.0.0.1", port: 4200, fetch: () => new Response(Bun.file("/mnt/fixtures/multitrack.mkv")) });
let session = "", controller: WebSocket | undefined, state: SessionState | undefined, coreStopped = false;
let receiverId: string | undefined, observedDisconnect = false;
const ui = new UiDriver(request, () => session);
const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
const command = (action: Action) => new Promise<void>((resolve, reject) => {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${action.type} timed out`)); }, 8_000);
  pending.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
  controller!.send(JSON.stringify({ type: "command", requestId, action }));
});
async function menu(label: string) {
  await ui.button("Playback output");
  const elements = await ui.elements("xpath", `//*[@role="menuitem" and normalize-space(.)="${label}"]`);
  assert.equal(elements.length, 1, label);
  await ui.clickElement(elements[0]!["element-6066-11e4-a52e-4f735466cecf"]);
}
try {
  await until("separate Core is reachable", health, 30_000);
  await until("Tauri driver is reachable", async () => { try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; } });
  session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: binary } } } })).sessionId;
  await request(`/session/${session}/window/rect`, { x: 100, y: 100, width: 1280, height: 800 });
  await commandOutput("xdotool", "search", "--onlyvisible", "--name", "^Couch( ·|$)", "windowmove", "100", "100");
  await until("remote native shell offers pairing", () => ui.execute("return !!document.querySelector('#pairing-code')"), 30_000);
  const code = (await Bun.file(`${artifacts}/core-error.log`).text()).match(/Pairing code: (\d{6})/)?.[1];
  assert.ok(code);
  for (const [selector, value] of [["#remote-name", "Native receiver qualification"], ["#pairing-code", code]]) {
    await until(`pairing input ${selector} settles`, async () => {
      try { await ui.type(selector!, value!); return true; }
      catch (error) { if (/stale element reference/.test(String(error))) return false; throw error; }
    });
  }
  await ui.button("Pair", ".pair-form");
  await until("remote native shell saves its Core pairing", () => ui.execute("return !!localStorage.getItem('couch.pairing:' + arguments[0]) && !document.querySelector('#pairing-code')", [origin]));
  const token = JSON.parse(await ui.execute("return localStorage.getItem('couch.pairing:' + arguments[0])", [origin])).token as string;
  controller = new (WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket })(await remoteSocketUrl(origin, token), { headers: { origin } });
  controller.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") {
      state = message.state;
      if (receiverId && !state.targets?.some(target => target.id === receiverId && target.connected)) observedDisconnect = true;
    }
    if (message.type === "result") { const item = pending.get(message.requestId); pending.delete(message.requestId); message.ok ? item?.resolve() : item?.reject(new Error(message.error)); }
  };
  await until("paired controller receives Core state", () => !!state);
  assert.equal(state!.targets?.filter(target => target.backend === "native" && target.connected).length, 0, "remote mode does not implicitly enroll native playback");
  assert.equal((await request(`/session/${session}/window/handles`)).length, 1);
  assert.equal(await ui.execute("return document.querySelectorAll('header').length"), 1);
  assert.equal(await fetch("http://127.0.0.1:4100/api/health", { signal: AbortSignal.timeout(500) }).then(() => true, () => false), false, "remote mode never starts a local playback Core; its private maintenance sidecar remains permitted");
  await menu("Enable playback on this computer");
  await until("explicit enrollment advertises native playback", () => !!state?.targets?.some(target => target.backend === "native" && target.connected));
  const targetId = state!.targets!.find(target => target.backend === "native" && target.connected)!.id;
  receiverId = targetId;
  assert.notEqual(state!.player.status, "playing");
  await command({ type: "selectTarget", targetId });
  const entryId = crypto.randomUUID();
  await command({ type: "enqueue", entry: { id: entryId, title: "Native receiver fixture", source: "http://127.0.0.1:4200/generated-local-media.mkv" } });
  await command({ type: "play", entryId, fromStart: true });
  await until("independent Core observes real libmpv playback", () => state?.targetId === targetId && state.currentEntryId === entryId && state.player.status === "playing" && state.player.position > 0);
  await ui.watching();
  await assertNativeVideoPixels(ui.execute, artifacts, "receiver-video");
  await command({ type: "pause", playbackId: state!.player.playbackId!, paused: true });
  await until("Core Pause reaches libmpv", () => state?.player.status === "paused");
  await command({ type: "seek", playbackId: state!.player.playbackId!, position: 5 });
  await until("Core Seek reaches paused libmpv", () => state?.player.status === "paused" && Math.abs(state.player.position - 5) < 1);
  await command({ type: "pause", playbackId: state!.player.playbackId!, paused: false });
  await until("Core Resume advances libmpv", () => state?.player.status === "playing" && state.player.position > 5.2);
  await until("libmpv owns an actual PulseAudio stream", async () => (await commandOutput("pactl", "list", "short", "sink-inputs")).length > 0);
  core.kill("SIGSTOP"); coreStopped = true;
  const suspended = Date.now();
  await until("missing Core lease acknowledgements silence native audio", async () => (await commandOutput("pactl", "list", "short", "sink-inputs")) === "", 14_000);
  const silenceMs = Date.now() - suspended;
  core.kill("SIGCONT"); coreStopped = false;
  await until("Core recovers after its process resumes", health);
  await until("receiver reconnects with the same target identity", () => observedDisconnect && !!state?.targets?.some(target => target.id === targetId && target.connected), 30_000);
  await Bun.sleep(1_500);
  assert.notEqual(state!.player.status, "playing", "reconnection requires explicit playback");
  assert.equal(await commandOutput("pactl", "list", "short", "sink-inputs"), "");
  await command({ type: "selectTarget", targetId });
  await command({ type: "play", entryId });
  await until("explicit Play resumes the retained queue on the same receiver", () => state?.targetId === targetId && state.currentEntryId === entryId && state.player.status === "playing");
  await ui.browse();
  await menu("Disable playback on this computer");
  await until("disable unregisters the receiver", () => !state?.targets?.some(target => target.id === targetId && target.connected));
  await until("disable silences actual native audio", async () => (await commandOutput("pactl", "list", "short", "sink-inputs")) === "");
  await request(`/session/${session}`, undefined, "DELETE"); session = "";
  assert.equal(await health(), true, "closing the native app preserves the independently owned Core");
  const build = await (await fetch(`${origin}/api/build`, { headers: { authorization: `Bearer ${token}` } })).json();
  await Bun.write(`${artifacts}/results.json`, JSON.stringify({ build, targetId, silenceMs, checks, binaries: await commandOutput("sha256sum", binary, sidecar), limitations: "Real Linux Tauri/libmpv under Xvfb software rendering and a PulseAudio null sink; no physical display/audio, macOS/Windows or hung-player failure-path qualification." }, null, 2));
} finally {
  if (coreStopped) core.kill("SIGCONT");
  controller?.close();
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill(); core.kill();
  await Promise.all([driver.exited, core.exited]);
  await media.stop(true);
}
