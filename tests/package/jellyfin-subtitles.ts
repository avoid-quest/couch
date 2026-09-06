import { Database } from "bun:sqlite";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Action, SessionState } from "../../src/shared/protocol";
import { UiDriver, keys } from "../linux/ui";
import { sha256, startSubtitleFixture } from "./jellyfin-subtitle-fixture";

// Opt-in: the named disposable runtime must already contain the exact reviewed package.
const container = process.env.JELLYFIN_NATIVE_CONTAINER!;
assert.ok(container && process.env.JELLYFIN_SUBTITLE_EVIDENCE && process.env.SUBTITLE_CORPUS && process.env.JELLYFIN_EXPECTED_REVISION, "Set the runtime, private evidence directory, corpus and reviewed revision");
const artifacts = resolve(process.env.JELLYFIN_SUBTITLE_EVIDENCE!);
const corpus = resolve(process.env.SUBTITLE_CORPUS!);
const port = Number(process.env.JELLYFIN_NATIVE_PORT ?? 45500);
const endpoint = `http://127.0.0.1:${port}`;
const origin = "http://127.0.0.1:45300";
const nativePort = Number(process.env.JELLYFIN_NATIVE_DRIVER ?? 45544), phonePort = Number(process.env.JELLYFIN_PHONE_DRIVER ?? 45545);
await mkdir(artifacts, { recursive: true, mode: 0o700 });
const checks: string[] = [], measurements: unknown[] = [];
const record = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const run = (...args: string[]) => { const result = Bun.spawnSync(args, { stderr: "inherit", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.exitCode, 0, args[0]); return result.stdout; };
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
    this.socket = new Socket(`${endpoint.replace("http", "ws")}/api/ws?token=${token}`, { headers: { origin, host: new URL(origin).host } });
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
  const response = await fetch(endpoint + path, { method, headers: { origin, host: new URL(origin).host, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
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
  await until("two HTTP remotes receive stopped native state", () => all(state => state.player.status === "idle"));
  await api("/api/jellyfin", connection.token, { url: fixture.containerUrl, username: fixture.username, password: fixture.password });
  const build = await api("/api/build", connection.token);
  assert.ok(build.packaged && !build.dirty); assert.equal(build.revision, process.env.JELLYFIN_EXPECTED_REVISION, "Exact reviewed package revision");
  await Bun.write(`${artifacts}/identity.json`, JSON.stringify({ build, binaries: exec("sha256sum", "/usr/bin/couch", "/usr/bin/couch-server").toString(), helper: sha256(await Bun.file(import.meta.path).arrayBuffer()), environment: "Ubuntu amd64 package, Xvfb software pixels, null audio" }, null, 2));
  let lastPgsPath = "";
  const load = async (title: string) => {
    const previous = first().player.playbackId;
    await command({ type: "enqueueJellyfin", entryId: crypto.randomUUID(), itemId: fixture.item(title).Id, playNow: true });
    await until(`${title} plays natively on both remotes`, () => all(state => state.player.playbackId !== previous && state.player.status === "playing" && state.player.position > 0));
    await command({ type: "pause", playbackId: first().player.playbackId!, paused: true }); await until("native playback pauses", () => all(state => state.player.status === "paused"));
    if (title === "Zero") {
      const downloaded = files(); assert.equal(downloaded.length, 1); assert.match(downloaded[0]!, /\.sup$/);
      assert.notEqual(downloaded[0], lastPgsPath, "Each retirement starts with a freshly downloaded PGS file");
      assert.equal(exec("stat", "-c", "%a", downloaded[0]!).toString().trim(), "600");
      assert.equal(sha256(exec("cat", downloaded[0]!)), fixture.summary.zero.responseHash);
      lastPgsPath = downloaded[0]!; record("fresh complete private PGS exists before retirement");
    }
  };
  await load("Zero");
  const index = first().player.tracks!.find(track => track.kind === "subtitle" && track.language === "eng")!.index;
  const privateFiles = files();
  assert.ok(all(state => state.player.subtitleError?.includes("start after zero") === true));
  await select(tv, -1); await select(tv, index);
  browser = (await driver(phonePort, "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { args: ["--automation", "--class=JellyfinSubtitlePhone"] } } } })).sessionId;
  await driver(phonePort, `/session/${browser}/url`, { url: `http://127.0.0.1:45300` });
  await until("phone shows pairing form", () => phone.execute("return !!document.querySelector('#pairing-code')"));
  await driver(phonePort, `/session/${browser}/window/rect`, { x: 0, y: 0, width: 488, height: 950 });
  const phoneRect = await driver(phonePort, `/session/${browser}/window/rect`), phoneWidth = await phone.execute("return innerWidth");
  await driver(phonePort, `/session/${browser}/window/rect`, { width: Math.round(phoneRect.width * 390 / phoneWidth), height: 950 });
  await until("pairing viewport is phone sized", async () => await phone.execute("return innerWidth") === 390);
  // The retained WebKitGTK fixture uses fractional scale; use its tested native click coordinates.
  phone.clickElement = async id => {
    const window = exec("xdotool", "search", "--onlyvisible", "--class", "^JellyfinSubtitlePhone$").toString().trim().split("\n")[0]!;
    exec("xdotool", "windowmap", "--sync", window, "windowactivate", "--sync", window);
    await phone.revealElement(id);
    const target = { "element-6066-11e4-a52e-4f735466cecf": id };
    let previous = "";
    await phone.waitFor("HTTP click target is stable and unobstructed", async () => {
      await phone.execute("const e=arguments[0], r=e.getBoundingClientRect(); if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))) e.scrollIntoView({block:'center',inline:'nearest'});", [target]);
      await driver(phonePort, `/session/${browser}/execute/async`, { script: "const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)));", args: [] });
      const point = await phone.execute("const e=arguments[0], r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2; return !e.matches(':disabled') && r.width>0 && r.height>0 && e.contains(document.elementFromPoint(x,y)) ? JSON.stringify({x:x*devicePixelRatio,y:outerHeight-innerHeight*devicePixelRatio+y*devicePixelRatio}) : '';", [{ "element-6066-11e4-a52e-4f735466cecf": id }]);
      const stable = !!point && point === previous; previous = point; return stable;
    });
    const point = JSON.parse(previous);
    await phone.execute("const target=arguments[0]; window.__httpPointer=null; document.addEventListener('pointerdown', event => { window.__httpPointer={hit:target.contains(event.target)}; }, {once:true,capture:true});", [{ "element-6066-11e4-a52e-4f735466cecf": id }]);
    exec("xdotool", "windowactivate", "--sync", window, "mousemove", "--window", window, String(Math.round(point.x)), String(Math.round(point.y)), "click", "1");
    assert.ok((await phone.execute("return window.__httpPointer"))?.hit, "HTTP pointer reaches its intended control after X11 translation");
  };
  await phone.type("#pairing-code", connection.pairingCode); await phone.button("Connect");
  await until("real phone pairs", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await select(phone, -1); await select(phone, index);
  for (const width of [390, 768, 1440]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rect = await driver(phonePort, `/session/${browser}/window/rect`), actual = await phone.execute("return innerWidth");
      if (actual === width) break;
      await driver(phonePort, `/session/${browser}/window/rect`, { x: 0, y: 0, width: Math.round(rect.width * width / actual), height: 950 });
    }
    await settings(phone);
    const geometry = await phone.execute("const r=document.querySelector('[role=dialog]').getBoundingClientRect(); return {width:innerWidth,scroll:document.documentElement.scrollWidth,left:r.left,right:r.right};");
    assert.equal(geometry.width, width); assert.ok(geometry.scroll <= width + 1 && geometry.left >= 0 && geometry.right <= width);
    assert.ok(await phone.execute("return document.querySelector('[role=dialog]').textContent.includes('subtitle timing')"));
    await phone.execute("document.querySelector('[role=dialog] [role=alert]').scrollIntoView({block:'center'})");
    await Bun.write(`${artifacts}/phone-${width}.png`, Buffer.from(await driver(phonePort, `/session/${browser}/screenshot`), "base64")); await phone.key(keys.escape);
  }
  await driver(phonePort, `/session/${browser}/window/minimize`, {});
  for (const [time, visible] of [[1, false], [4, true], [7, false], [10, true], [13, false], [4, true]] as const) await pixels(index, time, visible);
  const playingSessions = (await fixture.request("/Sessions")).filter((session: any) => session.Client === "Couch" && session.NowPlayingItem);
  assert.equal(playingSessions.length, 1); record("one upstream Couch playback session serves all remotes");
  const database = new Database(`${artifacts}/data/couch.sqlite`, { readonly: true });
  let couchToken: string;
  try {
    const row = database.query<{ device_id: string; configuration: string }, []>("SELECT device_id, configuration FROM jellyfin WHERE id=1").get()!;
    const configuration = JSON.parse(row.configuration);
    assert.ok(configuration.accessToken && configuration.accessToken !== fixture.token, "Inspect the actual Couch credential privately");
    assert.equal(configuration.url, fixture.containerUrl);
    assert.equal(row.device_id, playingSessions[0].DeviceId); assert.equal(configuration.userId, playingSessions[0].UserId);
    couchToken = configuration.accessToken;
  } finally { database.close(); }
  for (const remote of remotes) for (const secret of [couchToken, fixture.token, fixture.password, fixture.containerUrl, ...privateFiles, "/media/"]) assert.ok(!JSON.stringify(remote.state).includes(secret));
  record("ordinary snapshots contain no upstream credentials or native paths");
  await load("Raw"); assert.deepEqual(files(), []); assert.ok(!first().player.tracks?.some(track => track.kind === "subtitle")); assert.ok(first().player.subtitleError?.includes("sidecars are unavailable"));
  for (const title of ["Invalid", "Missing"]) { await load(title); assert.deepEqual(files(), []); assert.ok(!first().player.tracks?.some(track => track.kind === "subtitle")); assert.ok(first().player.subtitleError?.includes("could not be loaded")); }
  record("direct SUP and invalid or missing Matroska sidecars leave video playable with a useful error");
  await load("Zero");
  const failedEntry = crypto.randomUUID();
  await command({ type: "enqueueJellyfin", entryId: failedEntry, itemId: fixture.item("Failed").Id });
  await fixture.removeQueuedMovie();
  await command({ type: "play", entryId: failedEntry });
  await until("failed source resolution leaves an error on both remotes", () => all(state => state.player.status === "error"));
  await until("failed-before-load replacement releases retired PGS after native Stop", () => files().length === 0);
  await load("Zero"); await stop();
  await load("Zero"); await api("/api/jellyfin", connection.token, undefined, "DELETE"); await until("disconnect stops playback on both remotes", () => all(state => state.player.status === "idle")); assert.deepEqual(files(), []);
  await api("/api/jellyfin", connection.token, { url: fixture.containerUrl, username: fixture.username, password: fixture.password }); await load("Zero");
  await driver(nativePort, `/session/${native}`, undefined, "DELETE"); native = "";
  await until("native shutdown removes subtitle files", () => files().length === 0);
  await until("upstream playback session ends at native shutdown", async () => !(await fixture.request("/Sessions")).some((session: any) => session.Client === "Couch" && session.NowPlayingItem));
  await Bun.write(`${artifacts}/result.json`, JSON.stringify({ checks, measurements, api: fixture.summary, limits: "Only zero-origin PGS-in-MKS sample. Direct SUP remains unavailable; unanchored MKS timing is not qualified. No physical TV/audio claim." }, null, 2));
} catch (error) {
  if (browser) {
    await Bun.write(`${artifacts}/phone-failure.json`, JSON.stringify(await phone.execute("const e=document.querySelector('#pairing-code'),r=e?.getBoundingClientRect(); return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,visibility:document.visibilityState,focused:document.hasFocus(),scale:devicePixelRatio,rect:r?.toJSON(),hit:r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)}").catch(() => null), null, 2));
    const png = await driver(phonePort, `/session/${browser}/screenshot`).catch(() => null);
    if (png) await Bun.write(`${artifacts}/phone-failure.png`, Buffer.from(png, "base64"));
  }
  await Bun.write(`${artifacts}/failure.json`, JSON.stringify({ error: String(error), checks, measurements, player: remotes[0]?.state?.player }, null, 2)); throw error; }
finally {
  remotes.forEach(remote => remote.socket.close());
  if (browser) await driver(phonePort, `/session/${browser}`, undefined, "DELETE").catch(() => {});
  if (native) await driver(nativePort, `/session/${native}`, undefined, "DELETE").catch(() => {});
  try { if (connected) run("docker", "network", "disconnect", fixture.network, container); }
  finally { await fixture.close(); }
}
