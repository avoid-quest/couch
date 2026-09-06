import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { UiDriver, keys } from "../linux/ui";
import type { Action, SessionState } from "../../src/shared/protocol";

// Run outside the destination. Only /usr/bin/couch and its packaged child play media.
const container = process.env.SUBTITLE_CONTAINER ?? "couch-wave-subtitle-package";
const corpus = resolve(process.env.SUBTITLE_CORPUS!);
const artifacts = resolve(process.env.SUBTITLE_EVIDENCE!);
const origin = "http://127.0.0.1:45300";
const checks: string[] = [];
const phase = process.env.SUBTITLE_PHASE ?? "all";
const helperSha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(import.meta.path).arrayBuffer()).digest("hex");
assert.ok(["all", "rendering", "controls", "profiles", "replacement"].includes(phase), "Unknown subtitle qualification phase");
await mkdir(artifacts, { recursive: true });
const manifest = await Bun.file(`${corpus}/manifest.json`).json();
for (const name of ["text.mkv", "bitmap.mkv", "replacement.mkv"]) {
  assert.equal(new Bun.CryptoHasher("sha256").update(await Bun.file(`${corpus}/${name}`).arrayBuffer()).digest("hex"), manifest.files[name].sha256, `${name} matches the accepted corpus`);
}
const run = (args: string[]) => {
  const child = Bun.spawnSync(args, { stderr: "inherit" });
  assert.equal(child.exitCode, 0, args.join(" "));
  return child.stdout;
};
const exec = (...args: string[]) => run(["docker", "exec", "-u", "subtitle", "-e", "DISPLAY=:99", container, ...args]);
const record = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
async function until(label: string, predicate: () => unknown | Promise<unknown>, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { assert.ok(Date.now() < end, label); await Bun.sleep(100); }
  record(label);
}
async function driver(port: number, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, `${path}: ${JSON.stringify(result)}`);
  return result.value;
}
let native = "", browser = "";
const tv = new UiDriver((...args) => driver(45344, ...args), () => native);
const phone = new UiDriver((...args) => driver(45345, ...args), () => browser);
class Remote {
  state: SessionState | null = null;
  socket!: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  constructor(readonly token: string) { this.connect(); }
  connect() {
    this.state = null;
    const Socket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
    this.socket = new Socket(`${origin.replace("http", "ws")}/api/ws?token=${this.token}`, { headers: { origin } });
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.type === "state") this.state = message.state;
      else if (message.type === "result") {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        message.ok ? pending?.resolve() : pending?.reject(new Error(message.error));
      }
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
async function stop() {
  await command({ type: "stop" });
  await until("both remotes observe stopped native playback", () => all(s => s.player.status === "idle"));
}
const media = Bun.serve({ hostname: "0.0.0.0", port: 45312, fetch: request => {
  const name = new URL(request.url).pathname.slice(1);
  return ["text.mkv", "bitmap.mkv", "replacement.mkv"].includes(name) ? new Response(Bun.file(`${corpus}/${name}`)) : new Response("Not found", { status: 404 });
} });
async function start() {
  native = (await driver(45344, "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/usr/bin/couch" } } } })).sessionId;
  await until("packaged TV connects", () => tv.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  if (await tv.execute("return !!document.querySelector('[role=dialog]')")) await tv.key(keys.escape);
  return driver(45344, `/session/${native}/execute/async`, { script: "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('connection_info').then(done)", args: [] });
}
async function api(path: string, token: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json() as Promise<any>;
}
async function load(name: string) {
  await command({ type: "enqueueWeb", entryId: crypto.randomUUID(), url: `http://host.docker.internal:45312/${name}.mkv`, title: `Subtitle corpus ${name}`, playNow: true });
  await until(`${name} starts in the packaged native player`, () => all(state => state.player.status === "playing" && state.player.position > 0));
  await command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until(`${name} pauses`, () => all(state => state.player.status === "paused"));
}
async function seek(position: number) {
  await command({ type: "seek", playbackId: first().player.playbackId!, position });
  await until(`native paused seek to ${position}s`, () => all(state => state.player.status === "paused" && Math.abs(state.player.position - position) < 0.15));
  await Bun.sleep(300);
}
async function track(index: number) {
  await remotes[1]!.command({ type: "track", playbackId: first().player.playbackId!, kind: "subtitle", index });
  await until(`both remotes observe subtitle ${index}`, () => all(state => index < 0 ? !state.player.tracks?.some(t => t.kind === "subtitle" && t.selected) : state.player.tracks?.some(t => t.kind === "subtitle" && t.index === index && t.selected) === true));
  await Bun.sleep(300);
}
async function frame(name: string) {
  exec("ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", ":99", "-frames:v", "1", `/evidence/${name}.png`);
  const image = exec("ffmpeg", "-v", "error", "-i", `/evidence/${name}.png`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-");
  assert.equal(image.length, 1600 * 1000 * 3, "Native capture contains the complete RGB frame");
  return image;
}
const measurements: unknown[] = [];
async function pixels(name: string, index: number, position: number, expected: boolean) {
  await tv.watching();
  await seek(position);
  await track(-1);
  const off = await frame(`${name}-${position}-off`);
  await track(index);
  const on = await frame(`${name}-${position}-on`);
  let changed = 0, darkened = 0;
  // All authored subtitles lie within the native video's lower half.
  for (let y = 500; y < 950; y++) for (let x = 50; x < 1550; x++) {
    const offset = (y * 1600 + x) * 3;
    if ([0, 1, 2].some(c => Math.abs(on[offset + c]! - off[offset + c]!) > 35)) changed++;
    if ([0, 1, 2].every(c => off[offset + c]! - on[offset + c]! > 20)) darkened++;
  }
  assert.ok(expected ? changed > 300 : changed < 30, `${name} at ${position}s: ${changed} changed pixels, expected ${expected}`);
  if (name === "PGS" || name === "VobSub") assert.ok(darkened < 30, `${name} has no opaque black subtitle rectangle`);
  measurements.push({ name, position, changed, darkened, expected });
  record(`${name} at ${position}s ${expected ? "renders" : "clears"} actual native subtitle pixels`);
}
function replacementDifferences(image: Buffer) {
  let unexpected = 0;
  for (let y = 500; y < 950; y++) for (let x = 50; x < 1550; x++) {
    const offset = (y * 1600 + x) * 3;
    if ([24, 56, 88].some((color, c) => Math.abs(image[offset + c]! - color) > 12)) unexpected++;
  }
  return unexpected;
}
function assertReplacementBackground(image: Buffer) {
  assert.ok(replacementDifferences(image) < 30, "replacement shows its subtitle-free blue background");
}
async function replacementPixels(name: string) {
  await tv.watching();
  await seek(4);
  const image = await frame(name);
  assertReplacementBackground(image);
  measurements.push({ name, unexpected: replacementDifferences(image), maximum: 29 });
  record(`${name} has no stale subtitle pixels`);
}
async function replacementNegativeControl() {
  const response = await fetch(`${origin}/api/subtitles?${new URLSearchParams({ playbackId: first().player.playbackId!, name: "stale-control.srt" })}`, {
    method: "POST", headers: { origin, Authorization: `Bearer ${remotes[1]!.token}`, "Content-Type": "application/octet-stream" },
    body: "1\n00:00:02,000 --> 00:00:06,000\nSTALE SUBTITLE\n",
  });
  assert.equal(response.status, 200);
  await until("stale-cue negative control selects its native subtitle", () => all(s => s.player.tracks?.some(t => t.label === "stale-control.srt" && t.selected) === true));
  await Bun.sleep(300);
  const image = await frame("replacement-stale-negative");
  const unexpected = replacementDifferences(image);
  assert.ok(unexpected > 300, "The negative control has actual visible subtitle pixels");
  assert.throws(() => assertReplacementBackground(image), /subtitle-free blue background/);
  measurements.push({ name: "replacement-stale-negative", unexpected, rejected: true });
  record("the same replacement assertion rejects a real stale cue over the blue video");
  await load("replacement");
  await replacementPixels("replacement-after-negative");
}
async function settings(ui: UiDriver) {
  await ui.button("Playback settings");
  await until("subtitle settings opens", () => ui.execute("return !!document.querySelector('[role=dialog] #playback-subtitles')"));
}
async function closeSettings(ui: UiDriver) {
  await ui.key(keys.escape);
  await until("subtitle settings closes", () => ui.execute("return !document.querySelector('[role=dialog]')"));
}
async function portal(selector: string, name: string) {
  await until(`${name} opening animation settles`, () => tv.execute("return ![...document.querySelectorAll('[role=dialog], [role=listbox]')].some(e => e.getAnimations().some(a => a.playState === 'running'))"));
  const sample = await tv.execute(`const element = document.querySelector(arguments[0]), r = element.getBoundingClientRect();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(element).backgroundColor; ctx.fillRect(0,0,1,1);
    return { x: Math.ceil(r.x+4), y: Math.ceil(r.y+30), width: 6, height: Math.floor(r.height-60), color: [...ctx.getImageData(0,0,1,1).data] };`, [selector]);
  assert.equal(sample.color[3], 255);
  assert.ok(sample.height > 0);
  let matches = 0;
  await until(`${name} paints above native video`, async () => {
    const image = await frame(name);
    matches = 0;
    for (let y = sample.y; y < sample.y + sample.height; y++) for (let x = sample.x; x < sample.x + sample.width; x++) {
      const offset = (y * 1600 + x) * 3;
      if (sample.color.slice(0, 3).every((v: number, c: number) => Math.abs(image[offset + c]! - v) <= 2)) matches++;
    }
    await Bun.write(`${artifacts}/${name}.json`, JSON.stringify({ sample, matches }, null, 2));
    return matches >= sample.width * sample.height * 0.75;
  });
  await Bun.write(`${artifacts}/${name}.json`, JSON.stringify({ sample, matches }, null, 2));
}
async function startPhone(code: string) {
  browser = (await driver(45345, "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { args: ["--automation", "--class=SubtitlePhone"] } } } })).sessionId;
  await driver(45345, `/session/${browser}/url`, { url: origin });
  await until("phone displays the packaged pairing form", () => phone.execute("return !!document.querySelector('#pairing-code')"));
  phone.clickElement = async id => {
    await phone.revealElement(id);
    const element = { "element-6066-11e4-a52e-4f735466cecf": id };
    const point = await phone.execute(`const e=arguments[0]; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();
      return {x:(r.x+r.width/2)*devicePixelRatio,y:outerHeight-innerHeight*devicePixelRatio+(r.y+r.height/2)*devicePixelRatio};`, [element]);
    await Bun.sleep(250);
    const window = exec("xdotool", "search", "--onlyvisible", "--class", "^SubtitlePhone$").toString().trim().split("\n")[0]!;
    exec("xdotool", "windowactivate", "--sync", window, "mousemove", "--window", window, String(Math.round(point.x)), String(Math.round(point.y)), "click", "1");
  };
  await phone.type("#pairing-code", code);
  await phone.click(".pair-form button[type=submit], .pair-form button:not([type])");
  await until("phone pairs through the real form", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
}
async function selectorsAndUploads(code: string) {
  await load("bitmap");
  await seek(4);
  await settings(tv);
  await portal('[role=dialog]', "subtitle-settings-portal");
  await tv.click("#playback-subtitles");
  await portal('[role=listbox]', "subtitle-selector-portal");
  await tv.key(keys.escape);
  await tv.select("#playback-subtitles", "Off");
  await until("TV selector turns subtitles Off on both remotes", () => all(s => !s.player.tracks?.some(t => t.kind === "subtitle" && t.selected)));
  await tv.select("#playback-subtitles", "PGS images");
  await until("TV selector selects PGS on both remotes", () => all(s => s.player.tracks?.some(t => t.label === "PGS images" && t.selected) === true));
  await closeSettings(tv);
  await startPhone(code);
  await settings(phone);
  for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rect = await driver(45345, `/session/${browser}/window/rect`);
      const actual = await phone.execute("return innerWidth");
      if (actual === width) break;
      await driver(45345, `/session/${browser}/window/rect`, { width: Math.round(rect.width * width / actual), height: 950 });
    }
    await Bun.sleep(400);
    const geometry = await phone.execute("return {width:innerWidth,scroll:document.documentElement.scrollWidth,dialog:document.querySelector('[role=dialog]').getBoundingClientRect().toJSON()} ");
    assert.equal(geometry.width, width);
    await Bun.write(`${artifacts}/phone-subtitles-${width}.png`, Buffer.from(await driver(45345, `/session/${browser}/screenshot`), "base64"));
    // Match the existing HTTP helper's one CSS-pixel allowance for fractional GTK scale.
    assert.ok(geometry.scroll <= width + 1 && geometry.dialog.x >= 0 && geometry.dialog.right <= width, JSON.stringify(geometry));
    record(`packaged phone subtitle settings fits ${width}px`);
  }
  await phone.select("#playback-subtitles", "VobSub images");
  await until("phone selects VobSub on both remotes", () => all(s => s.player.tracks?.some(t => t.label === "VobSub images" && t.selected) === true));
  await phone.select("#playback-subtitles", "Off");
  await until("phone turns bitmap subtitles Off", () => all(s => !s.player.tracks?.some(t => t.kind === "subtitle" && t.selected)));
  const input = await phone.element("#playback-subtitle-file");
  await phone.request(`/session/${browser}/element/${input}/value`, { text: "/qualification/tests/fixtures/subtitles/plain.srt" });
  await until("phone uploads and selects real SRT bytes", () => all(s => s.player.tracks?.some(t => t.label.includes("plain.srt") && t.selected) === true));
  await closeSettings(phone);
  await driver(45345, `/session/${browser}/window/minimize`, {});
  const srt = first().player.tracks!.find(t => t.label.includes("plain.srt"))!;
  await pixels("uploaded-srt", srt.index, 4, true);
  await settings(tv);
  const tvInput = await tv.element("#playback-subtitle-file");
  await tv.request(`/session/${native}/element/${tvInput}/value`, { text: "/qualification/tests/fixtures/subtitles/forced.ass" });
  await until("TV uploads and selects real ASS bytes", () => all(s => s.player.tracks?.some(t => t.label.includes("forced.ass") && t.selected) === true));
  await closeSettings(tv);
  const ass = first().player.tracks!.find(t => t.label.includes("forced.ass"))!;
  await pixels("uploaded-ass", ass.index, 4, true);
  const files = exec("sh", "-c", "find /tmp -path '/tmp/couch-subtitles-*/*' -type f -printf '%m %p\\n'").toString().trim().split("\n");
  assert.equal(files.length, 2);
  assert.ok(files.every(line => line.startsWith("600 ")));
  for (const remote of remotes) for (const secret of ["/tmp/couch-subtitles-", "/qualification/", remote.token]) assert.ok(!JSON.stringify(remote.state).includes(secret));
  for (const [name, body, expected] of [["../../escape.srt", "1\n00:00:01,000 --> 00:00:02,000\ntext", 400], ["big.srt", "x".repeat(2 * 1024 * 1024 + 1), 413], ["invalid.srt", "No timestamps", 400]] as const) {
    const response = await fetch(`${origin}/api/subtitles?${new URLSearchParams({ playbackId: first().player.playbackId!, name })}`, { method: "POST", headers: { origin, Authorization: `Bearer ${remotes[1]!.token}`, "Content-Type": "application/octet-stream" }, body });
    assert.equal(response.status, expected);
  }
  record("uploads enforce size/content/path bounds and private files/snapshots");
  await load("replacement");
  await replacementPixels("replacement-after-uploads");
  await until("replacement cleans up both uploaded subtitle files", () => exec("sh", "-c", "find /tmp -path '/tmp/couch-subtitles-*/*' -type f").toString().trim() === "");
}
async function preferencesAndRestart(token: string) {
  const defaults = first().preferences!.profile;
  const household = first().activeProfile;
  const other = (await api("/api/profiles", token)).profiles.find((p: { name: string }) => p.name === "Subtitle Italian") ?? (await api("/api/profiles", token, { name: "Subtitle Italian" })).profile;
  const selections: unknown[] = [];
  for (const language of ["", "eng", "ita", "rus"]) {
    await command({ type: "preferences", profileId: household.id, preferences: { subtitleLanguage: language, subtitles: "auto" } });
    await load("text");
    const selected = first().player.tracks?.find(t => t.kind === "subtitle" && t.selected);
    assert.ok(selected);
    assert.equal(selected.language, language || "eng");
    if (!language) assert.equal(selected.label, "ASS styled and mixed scripts");
    selections.push({ language, selected });
  }
  await command({ type: "preferences", profileId: household.id, preferences: { subtitleLanguage: "ita", subtitles: "off" } });
  await load("text");
  assert.ok(!first().player.tracks?.some(t => t.kind === "subtitle" && t.selected));
  record("saved Off suppresses even the Italian forced/default candidates");
  await stop();
  await api(`/api/profiles/${other.id}/select`, token, {});
  await until("second profile becomes active on both remotes", () => all(s => s.activeProfile.id === other.id));
  await command({ type: "preferences", profileId: other.id, preferences: { subtitleLanguage: "ita", subtitles: "auto" } });
  await load("text");
  const forced = first().player.tracks!.find(t => t.language === "ita" && t.kind === "subtitle")!;
  assert.ok(forced.selected);
  await command({ type: "subtitleDelay", playbackId: first().player.playbackId!, delay: 1 });
  await pixels("forced-delayed", forced.index, 3.5, false);
  await pixels("forced-delayed", forced.index, 4.5, true);
  await load("text");
  assert.equal(first().player.subtitleDelay, 0);
  record("next item resets temporary subtitle delay and selects profile language");
  await stop();
  await api(`/api/profiles/${household.id}/select`, token, {});
  await until("Household retains its independent Off default", () => all(s => s.activeProfile.id === household.id && s.preferences?.profile.subtitles === "off"));
  for (const remote of remotes) remote.socket.close();
  await driver(45344, `/session/${native}`, undefined, "DELETE");
  native = "";
  token = (await start()).token;
  for (const remote of remotes) remote.connect();
  await until("restart preserves pairing/profile/Off without autoplay", () => all(s => s.player.status === "idle" && s.activeProfile.id === household.id && s.preferences?.profile.subtitles === "off"));
  await load("text");
  assert.ok(!first().player.tracks?.some(t => t.kind === "subtitle" && t.selected));
  if (browser) {
    await until("paired phone reconnects after native restart", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
    await settings(phone);
    await until("phone shows the restarted Household subtitle Off selection", () => phone.execute("return document.querySelector('#playback-subtitles')?.textContent.trim() === 'Off'"));
    await Bun.write(`${artifacts}/phone-restarted-off.png`, Buffer.from(await driver(45345, `/session/${browser}/screenshot`), "base64"));
    await closeSettings(phone);
  }
  await stop();
  await api(`/api/profiles/${other.id}/select`, token, {});
  await until("second profile survives restart", () => all(s => s.activeProfile.id === other.id && s.preferences?.profile.subtitleLanguage === "ita"));
  await load("text");
  assert.ok(first().player.tracks?.some(t => t.kind === "subtitle" && t.language === "ita" && t.selected));
  await stop();
  await api(`/api/profiles/${household.id}/select`, token, {});
  await Bun.write(`${artifacts}/profile-selections.json`, JSON.stringify({ defaults, selections, household, other, restarted: true }, null, 2));
  record("both profile defaults still control native selection after restart");
}
try {
  await until("packaged runtime WebDriver is ready", () => fetch("http://127.0.0.1:45344/status").then(r => r.ok).catch(() => false));
  const connection = await start();
  const identity = await api("/api/build", connection.token);
  assert.equal(identity.packaged, true);
  assert.equal(identity.target, "x86_64-unknown-linux-gnu");
  await Bun.write(`${artifacts}/identity.json`, JSON.stringify({ build: identity, binaries: exec("sha256sum", "/usr/bin/couch", "/usr/bin/couch-server").toString(), packages: exec("dpkg-query", "-W", "couch", "libmpv2", "libass9", "libwebkit2gtk-4.1-0").toString(), runtime: "Ubuntu amd64 under Docker Desktop emulation, Xvfb 1600x1000, basic rendering, null audio" }, null, 2));
  for (const name of ["Subtitle controller one", "Subtitle controller two"]) remotes.push(new Remote((await api("/api/pair", "", { code: connection.pairingCode, name })).token));
  await until("two remotes connect to the packaged coordinator", () => all(state => state.player.status === "idle"));
  if (phase === "all" || phase === "rendering") {
  await load("text");
  await Bun.write(`${artifacts}/text-tracks.json`, JSON.stringify(first().player.tracks, null, 2));
  const styled = first().player.tracks!.find(t => t.label === "ASS styled and mixed scripts")!;
  assert.ok(styled, "Styled ASS track is exposed");
  for (const [time, visible] of [[1, false], [4, true], [7, false], [10, true], [13, false], [4, true]] as const) await pixels("ass", styled.index, time, visible);
  await load("bitmap");
  await Bun.write(`${artifacts}/bitmap-tracks.json`, JSON.stringify(first().player.tracks, null, 2));
  for (const label of ["PGS images", "VobSub images"]) {
    const subtitle = first().player.tracks!.find(t => t.label === label)!;
    assert.ok(subtitle, `${label} track is exposed`);
    for (const [time, visible] of [[1, false], [4, true], [7, false], [10, true], [13, false], [4, true]] as const) await pixels(label.split(" ")[0]!, subtitle.index, time, visible);
  }
  await load("replacement");
  assert.ok(!first().player.tracks?.some(t => t.kind === "subtitle"));
  record("replacement removes embedded subtitle tracks");
  await replacementPixels("replacement-after-bitmap");
  await replacementNegativeControl();
  }
  if (phase === "replacement") {
    await load("bitmap");
    await seek(4);
    await track(first().player.tracks!.find(t => t.label === "VobSub images")!.index);
    await load("replacement");
    await replacementPixels("replacement-after-bitmap");
    await replacementNegativeControl();
  }
  if (phase === "all" || phase === "controls") await selectorsAndUploads(connection.pairingCode);
  if (phase === "all" || phase === "profiles") await preferencesAndRestart(connection.token);
  await stop();
  await until("packaged playback stops", () => all(state => state.player.status === "idle"));
  await Bun.write(`${artifacts}/result-${phase}.json`, JSON.stringify({ phase, helperSha256, checks, measurements, corpus: manifest.files }, null, 2));
} catch (error) {
  await Bun.write(`${artifacts}/failure.json`, JSON.stringify({ error: String(error), checks, measurements, state: remotes[0]?.state?.player }, null, 2));
  throw error;
} finally {
  for (const remote of remotes) remote.socket.close();
  if (browser) await driver(45345, `/session/${browser}`, undefined, "DELETE").catch(() => {});
  if (native) await driver(45344, `/session/${native}`, undefined, "DELETE").catch(() => {});
  await media.stop(true);
}
