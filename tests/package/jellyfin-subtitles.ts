import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Action, SessionState } from "../../src/shared/protocol";
import { UiDriver, keys } from "../linux/ui";
import { sha256, startSubtitleFixture } from "./jellyfin-subtitle-fixture";

// Opt-in: the named disposable runtime must already contain the exact reviewed package.
const container = process.env.JELLYFIN_NATIVE_CONTAINER!;
const artifacts = resolve(process.env.JELLYFIN_SUBTITLE_EVIDENCE!);
const corpus = resolve(process.env.SUBTITLE_CORPUS!);
const port = Number(process.env.JELLYFIN_NATIVE_PORT ?? 45500);
const origin = `http://127.0.0.1:${port}`;
const nativePort = Number(process.env.JELLYFIN_NATIVE_DRIVER ?? 45544), phonePort = Number(process.env.JELLYFIN_PHONE_DRIVER ?? 45545);
assert.ok(container && process.env.JELLYFIN_SUBTITLE_EVIDENCE && process.env.SUBTITLE_CORPUS);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const checks: string[] = [], measurements: unknown[] = [];
const record = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const run = (...args: string[]) => { const result = Bun.spawnSync(args, { stderr: "inherit" }); assert.equal(result.exitCode, 0, args[0]); return result.stdout; };
const exec = (...args: string[]) => run("docker", "exec", "-u", "subtitle", "-e", "DISPLAY=:99", container, ...args);
async function until(label: string, check: () => unknown | Promise<unknown>, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (!await check()) { assert.ok(Date.now() < end, label); await Bun.sleep(100); }
  record(label);
}
async function driver(port: number, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json(); assert.ok(response.ok && !result.value?.error, `${path}: ${JSON.stringify(result)}`); return result.value;
}
let native = "", browser = "";
const tv = new UiDriver((...args) => driver(nativePort, ...args), () => native);
const phone = new UiDriver((...args) => driver(phonePort, ...args), () => browser);
class Remote {
  state: SessionState | null = null;
  socket: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  constructor(readonly token: string) {
    const Socket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
    this.socket = new Socket(`${origin.replace("http", "ws")}/api/ws?token=${token}`, { headers: { origin } });
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "state") this.state = message.state;
      if (message.type === "result") { const pending = this.pending.get(message.requestId); this.pending.delete(message.requestId); message.ok ? pending?.resolve() : pending?.reject(new Error(message.error)); }
    };
  }
  command(action: Action) {
    return new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`${action.type} timeout`)); }, 20_000);
      this.pending.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ type: "command", requestId, action }));
    });
  }
}
const remotes: Remote[] = [];
const first = () => remotes[0]!.state!;
const all = (predicate: (state: SessionState) => boolean) => remotes.every(remote => remote.state && predicate(remote.state));
const command = (action: Action) => remotes[0]!.command(action);
async function api(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${response.status}`); return response.json() as Promise<any>;
}
const files = () => exec("find", "/tmp", "-maxdepth", "2", "-path", "/tmp/couch-subtitles-*/*", "-type", "f").toString().trim().split("\n").filter(Boolean);
async function stop() { await command({ type: "stop" }); await until("both remotes observe Stop", () => all(state => state.player.status === "idle")); assert.deepEqual(files(), []); }
async function settings(ui: UiDriver) { await ui.button("Playback settings"); await until("subtitle settings opens", () => ui.execute("return !!document.querySelector('[role=dialog] #playback-subtitles')")); }
async function select(ui: UiDriver, index: number) {
  const label = index < 0 ? "Off" : first().player.tracks!.find(track => track.kind === "subtitle" && track.index === index)!.label;
  await settings(ui); await ui.select("#playback-subtitles", label); await ui.key(keys.escape);
  await until("TV and both remotes observe selected subtitle", () => all(state => index < 0 ? !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected) : !!state.player.tracks?.some(track => track.kind === "subtitle" && track.index === index && track.selected)));
}
async function track(index: number) { await remotes[1]!.command({ type: "track", playbackId: first().player.playbackId!, kind: "subtitle", index }); await until(`both remotes observe subtitle ${index}`, () => all(state => index < 0 ? !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected) : !!state.player.tracks?.some(track => track.kind === "subtitle" && track.index === index && track.selected))); await Bun.sleep(250); }
async function seek(position: number) { await command({ type: "seek", playbackId: first().player.playbackId!, position }); await until(`paused seek to ${position}`, () => all(state => state.player.status === "paused" && Math.abs(state.player.position - position) < 0.15)); await Bun.sleep(250); }
async function frame(name: string) {
  exec("ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", ":99", "-frames:v", "1", `/evidence/${name}.png`);
  return exec("ffmpeg", "-v", "error", "-i", `/evidence/${name}.png`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-");
}
async function pixels(index: number, position: number, visible: boolean) {
  await tv.watching(); await seek(position); await track(-1); const off = await frame(`pgs-${position}-off`);
  await track(index); const on = await frame(`pgs-${position}-on`); assert.equal(on.length, 1600 * 1000 * 3); assert.equal(off.length, on.length);
  let changed = 0, darkened = 0;
  for (let y = 500; y < 950; y++) for (let x = 50; x < 1550; x++) {
    const offset = (y * 1600 + x) * 3;
    if ([0, 1, 2].some(c => Math.abs(on[offset + c]! - off[offset + c]!) > 35)) changed++;
    if ([0, 1, 2].every(c => off[offset + c]! - on[offset + c]! > 20)) darkened++;
  }
  assert.ok(visible ? changed > 300 : changed < 30, `PGS ${position}: ${changed} changed pixels`); assert.ok(darkened < 30, "No opaque subtitle rectangle");
  measurements.push({ position, visible, changed, darkened }); record(`external PGS ${visible ? "renders" : "clears"} native pixels at ${position}s`);
}
const fixture = await startSubtitleFixture(corpus, `${artifacts}/upstream`);
let connected = false;
try {
  run("docker", "network", "connect", fixture.network, container); connected = true;
  native = (await driver(nativePort, "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/usr/bin/couch" } } } })).sessionId;
  await until("packaged TV connects", () => tv.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  if (await tv.execute("return !!document.querySelector('[role=dialog]')")) await tv.key(keys.escape);
  const connection = await driver(nativePort, `/session/${native}/execute/async`, { script: "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('connection_info').then(done)", args: [] });
  for (const name of ["PGS remote one", "PGS remote two"]) remotes.push(new Remote((await api("/api/pair", "", { code: connection.pairingCode, name })).token));
  await until("two HTTP remotes receive shared state", () => all(() => true));
  await api("/api/jellyfin", connection.token, { url: fixture.containerUrl, username: fixture.username, password: fixture.password });
  const build = await api("/api/build", connection.token);
  assert.ok(build.packaged && !build.dirty); assert.equal(build.revision, process.env.JELLYFIN_EXPECTED_REVISION, "Exact reviewed package revision");
  await Bun.write(`${artifacts}/identity.json`, JSON.stringify({ build, binaries: exec("sha256sum", "/usr/bin/couch", "/usr/bin/couch-server").toString(), helper: sha256(await Bun.file(import.meta.path).arrayBuffer()), environment: "Ubuntu amd64 package, Xvfb software pixels, null audio" }, null, 2));
  const load = async (title: string) => {
    const previous = first().player.playbackId;
    await command({ type: "enqueueJellyfin", entryId: crypto.randomUUID(), itemId: fixture.item(title).Id, playNow: true });
    await until(`${title} plays natively on both remotes`, () => all(state => state.player.playbackId !== previous && state.player.status === "playing" && state.player.position > 0));
    await command({ type: "pause", playbackId: first().player.playbackId!, paused: true }); await until("native playback pauses", () => all(state => state.player.status === "paused"));
  };
  await load("Zero");
  const index = first().player.tracks!.find(track => track.kind === "subtitle" && track.language === "eng")!.index;
  const privateFiles = files(); assert.equal(privateFiles.length, 1); assert.match(privateFiles[0]!, /\.sup$/);
  assert.equal(exec("stat", "-c", "%a", privateFiles[0]!).toString().trim(), "600");
  assert.equal(sha256(exec("cat", privateFiles[0]!)), fixture.summary.zero.responseHash);
  assert.ok(all(state => state.player.subtitleError?.includes("start after zero") === true));
  await select(tv, -1); await select(tv, index);
  browser = (await driver(phonePort, "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { args: ["--automation", "--class=JellyfinSubtitlePhone"] } } } })).sessionId;
  await driver(phonePort, `/session/${browser}/url`, { url: `http://127.0.0.1:45300` });
  await until("phone shows pairing form", () => phone.execute("return !!document.querySelector('#pairing-code')"));
  await phone.type("#pairing-code", connection.pairingCode); await phone.button("Connect");
  await until("real phone pairs", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await select(phone, -1); await select(phone, index);
  for (const width of [390, 768, 1440]) {
    await driver(phonePort, `/session/${browser}/window/rect`, { width, height: 900 }); await settings(phone);
    assert.ok(await phone.execute("return document.querySelector('[role=dialog]').textContent.includes('subtitle timing')"));
    await Bun.write(`${artifacts}/phone-${width}.png`, Buffer.from(await driver(phonePort, `/session/${browser}/screenshot`), "base64")); await phone.key(keys.escape);
  }
  await driver(phonePort, `/session/${browser}/window/minimize`, {});
  for (const [time, visible] of [[1, false], [4, true], [7, false], [10, true], [13, false], [4, true]] as const) await pixels(index, time, visible);
  const playingSessions = (await fixture.request("/Sessions")).filter((session: any) => session.Client === "Couch" && session.NowPlayingItem);
  assert.equal(playingSessions.length, 1); record("one upstream Couch playback session serves all remotes");
  for (const remote of remotes) for (const secret of [fixture.token, fixture.password, fixture.containerUrl, ...privateFiles, "/media/"]) assert.ok(!JSON.stringify(remote.state).includes(secret));
  record("ordinary snapshots contain no upstream credentials or native paths");
  await load("Raw"); assert.deepEqual(files(), []); assert.ok(!first().player.tracks?.some(track => track.kind === "subtitle")); assert.ok(first().player.subtitleError?.includes("sidecars are unavailable"));
  for (const title of ["Invalid", "Missing"]) { await load(title); assert.deepEqual(files(), []); assert.ok(!first().player.tracks?.some(track => track.kind === "subtitle")); assert.ok(first().player.subtitleError?.includes("could not be loaded")); }
  record("direct SUP and invalid or missing Matroska sidecars leave video playable with a useful error");
  await load("Zero"); await stop();
  await load("Zero"); await api("/api/jellyfin", connection.token, undefined, "DELETE"); await until("disconnect stops playback on both remotes", () => all(state => state.player.status === "idle")); assert.deepEqual(files(), []);
  await api("/api/jellyfin", connection.token, { url: fixture.containerUrl, username: fixture.username, password: fixture.password }); await load("Zero");
  await driver(nativePort, `/session/${native}`, undefined, "DELETE"); native = "";
  await until("native shutdown removes subtitle files", () => files().length === 0);
  await until("upstream playback session ends at native shutdown", async () => !(await fixture.request("/Sessions")).some((session: any) => session.Client === "Couch" && session.NowPlayingItem));
  await Bun.write(`${artifacts}/result.json`, JSON.stringify({ checks, measurements, api: fixture.summary, limits: "Only zero-origin PGS-in-MKS sample. Direct SUP remains unavailable; unanchored MKS timing is not qualified. No physical TV/audio claim." }, null, 2));
} catch (error) { await Bun.write(`${artifacts}/failure.json`, JSON.stringify({ error: String(error), checks, measurements, player: remotes[0]?.state?.player }, null, 2)); throw error; }
finally {
  remotes.forEach(remote => remote.socket.close());
  if (browser) await driver(phonePort, `/session/${browser}`, undefined, "DELETE").catch(() => {});
  if (native) await driver(nativePort, `/session/${native}`, undefined, "DELETE").catch(() => {});
  if (connected) run("docker", "network", "disconnect", fixture.network, container);
  await fixture.close();
}
