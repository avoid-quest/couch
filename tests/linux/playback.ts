import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import type { ProviderItem } from "../../src/shared/providers";
import { assertNativeUiPixels, assertNativeVideoPixels } from "./pixels";
import { UiDriver, assertNativePortal, assertResponsive, assertTheme, keys, qualityLabel, startHttpRemote } from "./ui";
import { verifyLocalProgress, assertLocalProgressAfterRestart, verifyJellyfinResume } from "./progress";
import { verifyExternalSubtitles, assertSubtitleCleanup, verifyJellyfinSubtitles, verifyPlaybackPreferences, assertPlaybackPreferencesAfterRestart } from "./subtitles";
import { addTVFolder, verifyFolderSettings } from "./folder-settings";
import { verifyMusic, assertMusicAfterRestart } from "./music";
import { verifyVideoLibrary, assertVideoLibraryAfterRestart } from "./video-library";
import { createRadioFixture } from "./radio-fixture";
import { verifyRadio } from "./radio";
import { verifyRadioSettings } from "./radio-settings";
import { assertTvFullscreen, verifyTvRemote } from "./tv-remote";
import { verifyClaim } from "./claim";
import { verifyJellyfinSettings } from "./jellyfin-settings";
import { verifyVideoQuality } from "./video-quality";
import { verifyProfileManagement, assertProfilesAfterRestart } from "./profiles";

const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const artifactDir = "/artifacts";
const checks: string[] = [];
const radioFixture = await createRadioFixture();
const plainMediaAuth: boolean[] = [];
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const driver = Bun.spawn(["tauri-driver"], {
  stdout: Bun.file(`${artifactDir}/driver.log`), stderr: Bun.file(`${artifactDir}/native.log`),
});
const media = Bun.serve({
  hostname: "127.0.0.1", port: 4200,
  routes: {
    "/multitrack.mkv": () => new Response(Bun.file("/mnt/fixtures/multitrack.mkv")),
    "/radio.mp3": request => {
      plainMediaAuth.push(request.headers.has("authorization") || request.headers.has("x-emby-token"));
      return new Response(Bun.file("/mnt/fixtures/radio.mp3"));
    },
    "/web.html": () => new Response('<!doctype html><title>Local web fixture</title><meta property="og:image" content="http://127.0.0.1:4200/logo.svg"><video controls poster="http://127.0.0.1:4200/logo.svg"><source src="/dash/manifest.mpd" type="application/dash+xml"></video>', { headers: { "Content-Type": "text/html" } }),
    "/dash/:file": request => new Response(Bun.file(`/web-fixtures/${request.params.file}`)),
    "/quality.html": () => new Response('<!doctype html><title>DASH quality fixture</title><video src="/quality/manifest.mpd"></video>', { headers: { "Content-Type": "text/html" } }),
    "/quality/:file": request => new Response(Bun.file(`/quality-fixtures/${request.params.file}`)),
    "/logo.svg": () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#baf3dd"/></svg>', { headers: { "content-type": "image/svg+xml" } }),
  },
  fetch: () => new Response("Not found", { status: 404 }),
});
let sessionId = "";
const clients: Remote[] = [];
let httpRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
let secondHttpRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
let startShutdownPlayback: (() => Promise<void>) | undefined;
let verifyShutdownReport: (() => Promise<void>) | undefined;

async function until(description: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`${description} timed out. Players: ${JSON.stringify(clients.map(client => client.state?.player))}`);
    await Bun.sleep(50);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
}

async function webdriver(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json() as { value: any };
  if (!response.ok || result.value?.error) throw new Error(`WebDriver ${path}: ${JSON.stringify(result.value ?? response.status)}`);
  return result.value;
}

const ui = new UiDriver(webdriver, () => sessionId);
const execute = ui.execute;
async function element(selector: string): Promise<string> {
  const found = await webdriver(`/session/${sessionId}/element`, { using: "css selector", value: selector }).catch(error => { throw new Error(`Cannot find ${selector}: ${error}`); });
  return found["element-6066-11e4-a52e-4f735466cecf"];
}
const click = (selector: string) => ui.click(selector);
const section = (name: string) => ui.section(name);
async function type(selector: string, value: string) {
  await ui.type(selector, value);
}
async function api(path: string, body?: unknown, index = 0) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000),
    headers: { origin, Authorization: `Bearer ${clients[index]!.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.ok, true, `HTTP ${response.status} for ${path}`);
  return response.json() as Promise<any>;
}
async function xdotool(...args: string[]) {
  const process = Bun.spawn(["xdotool", ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, output] = await Promise.all([process.exited, new Response(process.stdout).text()]);
  return { code, output: output.trim() };
}
async function screenshot(name: string) {
  await execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong, [data-administrator-code], [data-pairing-code], #administrator-code').forEach(pairing => pairing.style.visibility = 'hidden')");
  await Bun.sleep(250);
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifactDir}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0);
}
async function resources(stage: string) {
  const processList = Bun.spawn(["ps", "-eo", "pid,ppid,rss,comm"], { stdout: "pipe", stderr: "inherit" });
  const processes = await new Response(processList.stdout).text();
  assert.equal(await processList.exited, 0);
  const binaries = [];
  for (const path of ["/work/bin/couch", "/work/bin/couch-server"]) {
    const file = Bun.file(path);
    if (await file.exists()) binaries.push({ path, bytes: file.size });
  }
  await Bun.write(`${artifactDir}/resources-${stage}.json`, JSON.stringify({
    note: "Debug binaries, Xvfb software rendering and a clocked PulseAudio null sink. RSS is KiB; this is not a hardware or release-build benchmark.",
    processes, binaries,
  }, null, 2));
}

class Remote {
  state: SessionState | null = null;
  socket!: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(readonly token: string) { this.connect(); }

  connect() {
    this.state = null;
    this.socket = new BunWebSocket(`${origin.replace("http", "ws")}/api/ws?token=${this.token}`, { headers: { origin } });
    this.socket.onmessage = event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "state") this.state = message.state;
      else if (message.type === "navigation") assert.fail("TV navigation must reach only the native host, never another controller");
      else {
        const pending = this.pending.get(message.requestId);
        this.pending.delete(message.requestId);
        if (message.ok) pending?.resolve();
        else pending?.reject(new Error(message.error || "Command rejected"));
      }
    };
    this.socket.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Remote disconnected"));
      this.pending.clear();
    };
  }

  command(action: Action) {
    const requestId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`${action.type} acknowledgement timed out`)); }, 5_000);
      this.pending.set(requestId, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ type: "command", requestId, action }));
    });
  }
}

const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));

try {
  await until("official Tauri WebDriver ready", async () => {
    try { return (await fetch(`${driverOrigin}/status`)).ok; } catch { return false; }
  });
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: {
    browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" },
  } } })).sessionId;
  await until("native UI connects to its Bun sidecar", async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected", 30_000);
  await assertTvFullscreen(ui, until, "startup");
  await until("an unclaimed TV shows its separate administrator setup code and address QR", () => execute("return /^[0-9]{10}$/.test(document.querySelector('[data-administrator-code]')?.textContent || '') && !!document.querySelector('[role=dialog] svg title')"));
  await ui.key(keys.escape);
  await until("setup dismisses to the fullscreen TV browser", () => execute("return !document.querySelector('[role=dialog]')"));
  await ui.click(".pair-shortcut");
  const code = await execute("return document.querySelector('.pairing-display strong')?.textContent") as string;
  await ui.key(keys.escape);
  await until("pairing dialog closes and restores its trigger focus", async () => await execute("return !document.querySelector('[role=dialog]') && document.activeElement?.textContent.includes('Pair a remote')"));
  const nativeTheme = await assertTheme(ui);
  assert.match(code, /^\d{6}$/);
  for (let index = 0; index < 2; index++) {
    const paired = await fetch(`${origin}/api/pair`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code }),
    });
    assert.equal(paired.status, 200);
    clients.push(new Remote((await paired.json() as { token: string }).token));
  }
  await until("two paired remotes receive authoritative snapshots", () => all(state => state.player.status === "idle"));
  await resources("idle");

  await type("#media-url", "http://127.0.0.1:4200/multitrack.mkv");
  await type("#media-title", "Linux multitrack fixture");
  await click(".queue-add-form button[type=submit]");
  await until("native UI queues media for both remotes", () => all(state => state.queue.length === 1));
  await click('[aria-label="Play Linux multitrack fixture"]');
  await until("native libmpv playback observed by both remotes", () => all(state => state.player.status === "playing" && state.player.position > 0));
  assert.ok((await Bun.file(`${artifactDir}/native.log`).text()).includes("Couch: basic GPU rendering enabled (COUCH_BASIC_RENDERING=1)"), "the explicit software-display renderer is active");
  const playbackId = clients[0]!.state!.player.playbackId!;
  await clients[0]!.command({ type: "pause", playbackId, paused: true });
  await until("first remote pauses native playback for all clients", () => all(state => state.player.status === "paused"));
  await until("native UI shows remote pause", async () => await execute("return document.querySelector('.playback-status')?.textContent") === "Paused");
  await clients[1]!.command({ type: "seek", playbackId, position: 6 });
  await until("second remote seek is confirmed by native playback", () => all(state => Math.abs(state.player.position - 6) < 0.3));
  await clients[0]!.command({ type: "volume", volume: 37 });
  await until("native volume update reaches both remotes", () => all(state => state.player.volume === 37));

  await until("native audio, subtitle and chapter metadata reaches both remotes", () => all(state =>
    state.player.tracks?.filter(track => track.kind === "audio").length === 2 &&
    state.player.tracks.some(track => track.kind === "subtitle") && state.player.chapters?.length === 2,
  ));
  const tracks = clients[0]!.state!.player.tracks!;
  const secondAudio = tracks.filter(track => track.kind === "audio")[1]!;
  const subtitle = tracks.find(track => track.kind === "subtitle")!;
  await clients[1]!.command({ type: "track", playbackId, kind: "audio", index: secondAudio.index });
  await until("native audio track selection reaches both remotes", () => all(state =>
    !!state.player.tracks?.some(track => track.kind === "audio" && track.index === secondAudio.index && track.selected),
  ));
  await clients[0]!.command({ type: "track", playbackId, kind: "subtitle", index: -1 });
  await until("native subtitles can be disabled", () => all(state => !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected)));
  await clients[1]!.command({ type: "track", playbackId, kind: "subtitle", index: subtitle.index });
  await until("native subtitles can be selected again", () => all(state =>
    !!state.player.tracks?.some(track => track.kind === "subtitle" && track.index === subtitle.index && track.selected),
  ));
  await clients[0]!.command({ type: "speed", playbackId, speed: 1.5 });
  await clients[0]!.command({ type: "audioDelay", playbackId, delay: 0.25 });
  await clients[0]!.command({ type: "subtitleDelay", playbackId, delay: -0.5 });
  await until("native speed and sync offsets reach both remotes", () => all(state =>
    state.player.speed === 1.5 && state.player.audioDelay === 0.25 && state.player.subtitleDelay === -0.5,
  ));
  const chapterPosition = clients[0]!.state!.player.chapters![1]!.position;
  await clients[1]!.command({ type: "seek", playbackId, position: chapterPosition });
  await until("native chapter seek reaches both remotes", () => all(state => Math.abs(state.player.position - chapterPosition) < 0.3));

  const keyboardWindow = (await xdotool("search", "--onlyvisible", "--name", "^Couch$")).output.split("\n")[0]!;
  await ui.controls();
  assert.equal((await xdotool("windowactivate", "--sync", keyboardWindow)).code, 0);
  const keyboardPoint = await execute("const rect = document.querySelector('.media-title').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }");
  await xdotool("mousemove", "--sync", "--window", keyboardWindow, String(Math.round(keyboardPoint.x)), String(Math.round(keyboardPoint.y)), "click", "1");
  await until("native keyboard tests focus the actual GTK WebView", async () => await execute("return document.hasFocus()"));
  await execute("window.__videoStageBeforeNavigation = document.querySelector('.video-stage'); document.querySelector('[aria-label=\"Stop playback\"]').focus()");
  await xdotool("key", "Left");
  await until("directional navigation moves focus between native transport controls", async () => await execute("return document.activeElement?.getAttribute('aria-label')") === "Next in queue");
  await until("native keyboard focus has a visible focus indicator", async () => await execute("const style = getComputedStyle(document.activeElement); return (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none') || style.boxShadow !== 'none'"));
  await xdotool("key", "Tab");
  await until("Tab reaches the next native transport control", async () => await execute("return document.activeElement?.getAttribute('aria-label')") === "Stop playback");
  await xdotool("key", "shift+Tab");
  await until("Shift-Tab restores the previous native transport focus", async () => await execute("return document.activeElement?.getAttribute('aria-label')") === "Next in queue");
  await ui.section("Queue");
  await xdotool("key", "Right");
  await xdotool("key", "Return");
  await until("source tabs support real arrow-key navigation", async () => await execute("return document.querySelector('.source-nav [data-state=active]')?.textContent.trim()") === "Online");
  await xdotool("key", "Escape");
  await until("Escape closes TV Home while retaining its browsed source", async () => await execute("return !!document.querySelector('.tv-browser[hidden]') && document.querySelector('.source-nav [data-state=active]')?.textContent.trim() === 'Online'"));
  await ui.home();
  await until("TV Home restores source-tab focus without resetting browsing", async () => await execute("return document.activeElement?.getAttribute('role') === 'tab' && document.activeElement?.textContent.trim() === 'Online'"));
  await ui.section("Queue");
  await until("VideoStage retains DOM identity and playback across source navigation", async () => await execute("return window.__videoStageBeforeNavigation === document.querySelector('.video-stage')") && all(state => state.player.playbackId === playbackId && state.player.status === "paused"));

  httpRemote = await startHttpRemote(origin, code, artifactDir, until);
  assert.equal(httpRemote.theme.primary, nativeTheme.primary, "Static native and compiled HTTP app use the same primary theme");
  assert.equal(httpRemote.theme.background, nativeTheme.background, "Static native and compiled HTTP app use the same background theme");
  await until("real HTTP browser receives the same queue and native pause", async () => await httpRemote!.ui.execute("return document.querySelector('.queue-entry-title')?.textContent === 'Linux multitrack fixture' && document.querySelector('.playback-status')?.textContent === 'Paused'"));
  await httpRemote.ui.controls();
  await httpRemote.ui.execute("document.querySelector('[role=slider][aria-label=Volume]').focus()");
  await httpRemote.ui.key(keys.right);
  await until("HTTP remote keyboard slider changes native volume for both controllers", () => all(state => state.player.volume === 38));
  await httpRemote.ui.key(keys.left);
  await until("HTTP remote slider restores native volume", () => all(state => state.player.volume === 37));
  await httpRemote.ui.section("Radio");
  await assertResponsive(httpRemote.ui, "Phone radio");
  await until("HTTP remote browsing stays local to that browser", async () => await execute("return document.querySelector('.source-nav [data-state=active]')?.textContent.startsWith('Queue')") && await httpRemote!.ui.execute("return document.querySelector('.source-nav [data-state=active]')?.textContent") === "Radio");
  await httpRemote.ui.button("Resume");
  await until("real HTTP remote starts the same native player while browsing", () => all(state => state.player.playbackId === playbackId && state.player.status === "playing" && state.player.position > chapterPosition + 1));
  await httpRemote.ui.button("Pause");
  await until("real HTTP remote pauses the shared native player", () => all(state => state.player.status === "paused"));
  await httpRemote.ui.section("Library");
  await assertResponsive(httpRemote.ui, "Phone library");
  await httpRemote.ui.section("Queue");
  await httpRemote.ui.button("Queue options for Linux multitrack fixture");
  await until("phone queue actions open in an accessible popover", async () => await httpRemote!.ui.execute("return !!document.querySelector('[data-slot=popover-content]') && !!document.activeElement?.closest('[data-slot=popover-content]')"));
  await assertResponsive(httpRemote.ui, "Phone queue popover");
  await httpRemote.ui.key(keys.escape);
  await until("Escape closes phone queue popover and restores its trigger", async () => await httpRemote!.ui.execute("return !document.querySelector('[data-slot=popover-content]') && document.activeElement?.getAttribute('aria-label') === 'Queue options for Linux multitrack fixture'"));
  await httpRemote.ui.select("#media-kind", "Webpage");
  await httpRemote.ui.select("#media-quality", qualityLabel("720p"));
  await assertResponsive(httpRemote.ui, "Phone webpage queue form");
  await httpRemote.screenshot("http-remote-phone");
  await httpRemote.refresh();
  await until("HTTP browser refresh retains pairing and receives current state", async () => await httpRemote!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected' && document.querySelector('.playback-status')?.textContent === 'Paused'"));
  await verifyTvRemote({ ui, until, clients, httpRemote, artifactDir });
  await httpRemote.minimize();
  await clients[0]!.command({ type: "seek", playbackId, position: chapterPosition });
  await until("native paused chapter is restored after HTTP UI checks", () => all(state => Math.abs(state.player.position - chapterPosition) < 0.3));

  // Capture the complete native window, including the GL video layer absent from DOM screenshots.
  await assertNativeUiPixels(execute, artifactDir);
  checks.push("WebView pixels remain visible with native video");
  console.log("PASS WebView pixels remain visible with native video");
  await resources("playback");
  await ui.watching();
  await assertNativeVideoPixels(execute, artifactDir, "native-paused-video");
  checks.push("native video pixels survive pause and chapter seek");
  await screenshot("native-playback");
  await assertTvFullscreen(ui, until, "paused playback");
  await screenshot("native-fullscreen");
  await assertNativeVideoPixels(execute, artifactDir, "native-fullscreen-video");
  checks.push("native video pixels fill the fullscreen TV aperture while paused");
  await ui.button("Playback settings");
  await until("settings dialog opens above fullscreen playback", async () => await execute("return !!document.querySelector('[role=dialog]') && !!document.querySelector('.tv-shell:not(.tv-browsing)')"));
  await assertNativePortal(ui, "[data-slot=dialog-content]", artifactDir, "native-settings-portal");
  await ui.click("#playback-speed");
  await until("playback select opens in a portal above its dialog", async () => await execute("return !!document.querySelector('[role=listbox]') && document.querySelectorAll('[role=dialog]').length === 1"));
  await assertNativePortal(ui, "[data-slot=select-content]", artifactDir, "native-select-portal");
  await ui.key(keys.escape);
  await until("Escape closes only the topmost select and restores its focus", async () => await execute("return !document.querySelector('[role=listbox]') && !!document.querySelector('[role=dialog]') && document.activeElement?.id === 'playback-speed'"));
  await ui.select("#playback-speed", "Normal");
  await until("native settings Select updates libmpv and both remote snapshots", () => all(state => state.player.speed === 1));
  await ui.select("#playback-speed", "1.5×");
  await until("native settings Select restores playback speed", () => all(state => state.player.speed === 1.5));
  await ui.key(keys.escape);
  await until("Escape closes settings and restores its trigger while TV remains fullscreen", async () => await execute("return !document.querySelector('[role=dialog]') && document.activeElement?.textContent.trim() === 'Playback settings'") && all(state => state.player.status === "paused" && state.player.playbackId === playbackId));
  await ui.watching();
  await assertTvFullscreen(ui, until, "Back to watching");
  await assertNativeVideoPixels(execute, artifactDir, "native-back-to-watching-video");
  await ui.home();
  await assertTvFullscreen(ui, until, "Home over paused playback");
  await until("Home preserves the same mounted stage and paused native player", async () => await execute("return window.__videoStageBeforeNavigation === document.querySelector('.video-stage') && !!document.querySelector('.tv-browser:not([hidden])')") && all(state => state.player.status === "paused" && state.player.playbackId === playbackId));
  await ui.watching();
  await assertNativeVideoPixels(execute, artifactDir, "native-restored-video");
  checks.push("native video pixels survive Home and Back without leaving fullscreen");
  await verifyExternalSubtitles({ origin, ui, until, clients, httpRemote, artifactDir });

  clients[1]!.socket.close();
  await until("second remote disconnects", () => clients[1]!.socket.readyState === WebSocket.CLOSED);
  await clients[0]!.command({ type: "volume", volume: 43 });
  clients[1]!.connect();
  await until("reconnected remote receives current native state", () => all(state => state.player.volume === 43 && state.player.status === "paused"));
  await clients[1]!.command({ type: "seek", playbackId, position: 18 });
  await clients[1]!.command({ type: "pause", playbackId, paused: false });
  await until("native EOF reaches both remotes", () => all(state => state.player.status === "ended"));

  const badId = crypto.randomUUID();
  await clients[0]!.command({ type: "enqueue", entry: { id: badId, title: "Unavailable test source", source: "http://127.0.0.1:1/missing.mp4" } });
  await clients[0]!.command({ type: "play", entryId: badId });
  await until("native source error reaches both remotes", () => all(state => state.player.status === "error" && !!state.player.error));
  await until("failed new source clears previous track metadata", () => all(state => !state.player.tracks?.length && !state.player.chapters?.length));
  await clients[1]!.command({ type: "stop" });
  await until("stop clears native playback for every remote", () => all(state => state.player.status === "idle"));
  await assertTvFullscreen(ui, until, "Stop returns to Home");
  await until("Stop returns the TV to its fullscreen Home", () => execute("return !!document.querySelector('.tv-browser:not([hidden])')"));
  await assertSubtitleCleanup({ until, clients });

  const station = { id: crypto.randomUUID(), name: "Local radio fixture", url: "http://127.0.0.1:4200/radio.mp3", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
  await api("/api/radio/favorites", { station });
  await until("saved radio station is shared with the second remote", async () => (await api("/api/radio/favorites", undefined, 1)).favorites.some((favorite: any) => favorite.id === station.id));
  await section("Radio");
  await until("native radio UI shows shared favorite", async () => await execute("return document.querySelector('.radio-station h3')?.textContent") === station.name);
  await click('.radio-station .secondary-button');
  await until("native radio UI adds its station to the shared queue", () => all(state => state.queue.some(entry => entry.title === station.name)));
  const radioEntry = clients[0]!.state!.queue.find(entry => entry.title === station.name)!;
  await clients[1]!.command({ type: "play", entryId: radioEntry.id });
  await until("audio-only station plays with fresh native metadata", () => all(state =>
    state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "audio") === true &&
    !state.player.tracks.some(track => track.kind === "video" || track.kind === "subtitle") && !state.player.chapters?.length,
  ));
  await clients[0]!.command({ type: "stop" });
  await httpRemote!.restore();
  await httpRemote!.ui.section("Radio");
  await httpRemote!.ui.click(".radio-station .radio-play");
  await until("phone station Play starts native radio with one action", () => all(state => state.player.status === "playing" && state.currentEntryId !== radioEntry.id && state.queue.find(entry => entry.id === state.currentEntryId)?.title === station.name));
  await assertResponsive(httpRemote!.ui, "Phone radio actions");
  await clients[0]!.command({ type: "stop" });
  await httpRemote!.minimize();

  if (process.env.COUCH_TEST_LIVE_RADIO === "1") {
    const catalog = await api("/api/radio/stations?q=Radio%20Paradise&countrycode=");
    const liveStation = catalog.stations.find((station: any) => station.name.toLowerCase().includes("paradise"));
    assert.ok(liveStation, "Live Radio Browser directory returns a Radio Paradise station");
    const entryId = crypto.randomUUID();
    await clients[0]!.command({ type: "enqueue", entry: { id: entryId, title: liveStation.name, source: liveStation.url, kind: "radio" } });
    await clients[1]!.command({ type: "play", entryId });
    await until("live directory station plays natively for both remotes", () => all(state =>
      state.currentEntryId === entryId && state.player.status === "playing" && state.player.position > 2,
    ), 30_000);
    await Bun.write(`${artifactDir}/live-radio.json`, JSON.stringify({ name: liveStation.name, streamHost: new URL(liveStation.url).host, nowPlaying: clients[0]!.state!.player.nowPlaying ?? null, testedAt: new Date().toISOString(), result: "Native playback and advancing position observed by both remotes" }, null, 2));
    await clients[0]!.command({ type: "stop" });

  }

  const radioAcceptance = await verifyRadio({ origin, ui, until, clients, api, httpRemote, artifactDir }, radioFixture);

  if (process.env.COUCH_TEST_JELLYFIN) {
    const config = await Bun.file(process.env.COUCH_TEST_JELLYFIN).json() as {
      containerUrl: string; username: string; password: string; accessToken: string; userId: string;
    };
    await section("Jellyfin");
    async function connectJellyfin() {
      await click('[data-action="jellyfin-settings"]');
      await until("native Jellyfin connection form appears", async () => !!await execute("return document.querySelector('#jellyfin-url')"));
      await type("#jellyfin-url", config.containerUrl);
      await type("#jellyfin-user", config.username);
      await type("#jellyfin-password", config.password);
      await click(".jellyfin-connect button.primary-button");
      await until("native UI authenticates with real Jellyfin server", async () => (await api("/api/jellyfin")).connected === true, 30_000);
      await ui.key(keys.escape);
      await until("native Jellyfin Sources form closes before library playback", () => execute("return !document.querySelector('[role=dialog]')"));
    }
    await connectJellyfin();
    const catalog = await api("/api/jellyfin/items?q=Linux&startIndex=0", undefined, 1);
    const movie = catalog.items.find((item: any) => item.title === "Linux playback fixture");
    assert.ok(movie, "Real Jellyfin catalog contains generated movie");
    const entryId = crypto.randomUUID();
    await clients[1]!.command({ type: "enqueueJellyfin", itemId: movie.id, entryId });
    await clients[0]!.command({ type: "play", entryId });
    await until("real Jellyfin authenticated media plays natively", () => all(state => state.player.status === "playing" && state.currentEntryId === entryId), 30_000);
    await verifyJellyfinSubtitles({ ui, until, clients, artifactDir, config });
    const sessions = async () => {
      const response = await fetch(`${config.containerUrl}/Sessions`, { headers: { "X-Emby-Token": config.accessToken } });
      assert.equal(response.status, 200);
      return response.json() as Promise<any[]>;
    };
    await until("real Jellyfin observes app playback reporting", async () => (await sessions()).some(session => session.NowPlayingItem?.Id === movie.id && session.UserId === config.userId));
    await clients[0]!.command({ type: "stop" });
    await until("real Jellyfin observes playback stop", async () => !(await sessions()).some(session => session.NowPlayingItem?.Id === movie.id && session.UserId === config.userId));
    await verifyJellyfinResume({ ui, until, clients, api, entryId, item: movie, config });
    plainMediaAuth.length = 0;
    await clients[0]!.command({ type: "play", entryId: radioEntry.id });
    await until("plain source plays after authenticated Jellyfin media", () => all(state => state.player.status === "playing" && state.currentEntryId === radioEntry.id));
    assert.ok(plainMediaAuth.length > 0);
    assert.equal(plainMediaAuth.some(Boolean), false, "Jellyfin credentials must not reach ordinary sources");
    checks.push("Jellyfin credentials clear before the next ordinary source");
    console.log("PASS Jellyfin credentials clear before the next ordinary source");
    await clients[0]!.command({ type: "stop" });
    await clients[1]!.command({ type: "play", entryId });
    await until("Jellyfin playback can restart before disconnect", () => all(state => state.player.status === "playing" && state.currentEntryId === entryId));
    await click('[data-action="jellyfin-settings"]');
    await click('[data-action="jellyfin-disconnect"]');
    await ui.button("Disconnect and stop Jellyfin", '[aria-label="Jellyfin settings"]');
    await until("disconnecting Jellyfin stops its active media for every remote", async () =>
      all(state => state.player.status === "idle") && (await api("/api/jellyfin")).connected === false,
    );
    await ui.key(keys.escape);
    await until("native disconnect confirmation closes before reconnect", () => execute("return !document.querySelector('[role=dialog]')"));
    await connectJellyfin();
    startShutdownPlayback = async () => {
      await clients[1]!.command({ type: "play", entryId });
      await until("Jellyfin plays before the desktop window closes", () => all(state => state.player.status === "playing" && state.currentEntryId === entryId && state.player.position > 1));
      await until("Jellyfin reports the session before desktop exit", async () => (await sessions()).some(session => session.NowPlayingItem?.Id === movie.id && session.UserId === config.userId));
    };
    verifyShutdownReport = () => until("closing the desktop reports stopped playback to real Jellyfin", async () => !(await sessions()).some(session => session.NowPlayingItem?.Id === movie.id && session.UserId === config.userId));
  }

  await section("Queue");
  await ui.select("#media-kind", "Webpage");
  await ui.select("#media-quality", qualityLabel("480p"));
  await type("#media-url", "http://127.0.0.1:4200/web.html");
  await type("#media-title", "");
  await click(".queue-add-form button[type=submit]");
  await until("native webpage form shares chosen quality with both remotes", () => all(state => state.queue.some(entry => entry.source === "web:http://127.0.0.1:4200/web.html" && entry.quality === "480p")));
  const webEntryId = clients[0]!.state!.queue.find(entry => entry.source === "web:http://127.0.0.1:4200/web.html")!.id;
  await until("real yt-dlp fills automatic webpage title and artwork for both remotes", () => all(state => state.queue.some(entry =>
    entry.id === webEntryId && entry.title.startsWith("Local web fixture") && entry.thumbnail === "http://127.0.0.1:4200/logo.svg",
  )), 30_000);
  await until("native shared queue displays webpage artwork and quality", async () => await execute(`
    const row = [...document.querySelectorAll('.queue-entry')].find(row => row.querySelector('.queue-entry-title')?.textContent.startsWith('Local web fixture'));
    return row?.querySelector('img')?.naturalWidth > 0 && row.textContent.includes('480p');
  `));
  const webTitle = clients[0]!.state!.queue.find(entry => entry.id === webEntryId)!.title;
  await click(`[aria-label=${JSON.stringify(`Play ${webTitle}`)}]`);
  await until("real yt-dlp resolves webpage DASH into native playback", () => all(state =>
    state.player.status === "playing" && state.player.tracks?.some(track => track.kind === "audio") === true &&
    state.player.tracks.some(track => track.kind === "video"),
  ), 30_000);
  await clients[0]!.command({ type: "stop" });

  await until("native webpage Stop is observed before the DASH quality sequence", () => all(state => state.player.status === "idle"));
  for (const [quality, selectedVideo, color] of [["best", 1, [255, 0, 0]], ["480p", 0, [0, 0, 255]], ["720p", 1, [255, 0, 0]]] as const) {
    const title = `DASH quality ${quality}`;
    await ui.select("#media-quality", qualityLabel(quality));
    await type("#media-url", "http://127.0.0.1:4200/quality.html");
    await type("#media-title", title);
    await click(".queue-add-form button[type=submit]");
    await until(`native webpage form queues multiresolution DASH at ${quality}`, () => all(state => state.queue.some(entry => entry.title === title && entry.quality === quality)));
    const entry = clients[0]!.state!.queue.find(entry => entry.title === title)!;
    const playButton = `[aria-label=${JSON.stringify(`Play ${title}`)}]`;
    await until(`native queue displays the ${quality} DASH play control`, async () => await execute("return !!document.querySelector(arguments[0])", [playButton]));
    await click(playButton);
    await until(`native ${quality} DASH selects the expected video and preserves audio for both remotes`, () => all(state => {
      const video = state.player.tracks?.filter(track => track.kind === "video");
      return state.currentEntryId === entry.id && state.player.status === "playing" && state.player.position > 0.5 &&
        video?.length === 2 && video[selectedVideo]?.selected === true && video.filter(track => track.selected).length === 1 &&
        state.player.tracks?.some(track => track.kind === "audio" && track.selected) === true;
    }), 30_000);
    await clients[1]!.command({ type: "pause", playbackId: clients[0]!.state!.player.playbackId!, paused: true });
    await until(`both remotes pause the selected ${quality} DASH representation`, () => all(state => state.player.status === "paused"));
    await execute("window.scrollTo(0, 0)");
    await ui.watching();
    await assertNativeVideoPixels(execute, artifactDir, `native-dash-${quality}`, color);
    checks.push(`native ${quality} DASH renders the ${selectedVideo === 0 ? 360 : 720}p fixture color`);
    console.log(`PASS native ${quality} DASH renders the ${selectedVideo === 0 ? 360 : 720}p fixture color`);
    await clients[0]!.command({ type: "stop" });
    await until(`native ${quality} DASH Stop opens Home before the next source`, async () => all(state => state.player.status === "idle") && await execute("return !!document.querySelector('.tv-browser:not([hidden])')"));
  }
  await clients[0]!.command({ type: "play", entryId: clients[0]!.state!.queue.find(entry => entry.title === "Linux multitrack fixture")!.id });
  await until("ordinary media resets DASH selection and restores its native tracks", () => all(state =>
    state.player.status === "playing" && state.player.position > 0.5 && state.player.tracks?.filter(track => track.kind === "video").length === 1 &&
    state.player.tracks.some(track => track.kind === "video" && track.selected) && state.player.tracks.filter(track => track.kind === "audio").length === 2,
  ));
  await clients[1]!.command({ type: "pause", playbackId: clients[0]!.state!.player.playbackId!, paused: true });
  await until("ordinary media remains pausable after DASH quality changes", () => all(state => state.player.status === "paused"));
  await ui.watching();
  await assertNativeVideoPixels(execute, artifactDir, "native-video-after-dash-quality");
  checks.push("ordinary video pixels survive DASH selection reset");
  console.log("PASS ordinary video pixels survive DASH selection reset");
  await clients[0]!.command({ type: "stop" });
  await until("native Stop opens Home before saved-provider browsing", async () => all(state => state.player.status === "idle") && await execute("return !!document.querySelector('.tv-browser:not([hidden])')"));

  const favoriteUrl = "https://www.youtube.com/watch?v=YE7VzlLtp-4";
  const providerFavorite: ProviderItem = { id: `youtube-${createHash("sha256").update(favoriteUrl).digest("hex").slice(0, 32)}`, provider: "youtube", kind: "media", title: "Saved provider fixture", url: favoriteUrl, thumbnail: "http://127.0.0.1:4200/logo.svg" };
  const providerVersion = clients[0]!.state!.providerVersion ?? 0;
  await api("/api/providers/favorites", { item: providerFavorite });
  await until("saving provider favorites invalidates both remote catalogs", () => all(state => (state.providerVersion ?? 0) > providerVersion));
  await until("provider favorite metadata is shared with the second remote", async () => (await api("/api/providers/favorites", undefined, 1)).favorites.some((item: ProviderItem) => item.id === providerFavorite.id && item.thumbnail === providerFavorite.thumbnail));
  await section("Online");
  await click(".provider-views button:nth-child(2)");
  await until("native Online Saved view displays shared provider favorites", async () => await execute("return document.querySelector('.provider-item h4')?.textContent") === providerFavorite.title);
  await click('[aria-label="Remove Saved provider fixture from favorites"]');
  await until("native provider favorite removal reaches the other remote", async () => !(await api("/api/providers/favorites", undefined, 1)).favorites.some((item: ProviderItem) => item.id === providerFavorite.id));
  await api("/api/providers/favorites", { item: providerFavorite }, 1);
  await until("another remote restores the native Saved card without reload", async () => await execute("return document.querySelector('.provider-item h4')?.textContent") === providerFavorite.title);

  secondHttpRemote = await startHttpRemote(origin, code, artifactDir, until, 4447);
  await verifyVideoQuality({ ui, httpRemote: httpRemote!, otherRemote: secondHttpRemote, until, clients, artifactDir, screenshot });
  await secondHttpRemote.minimize();

  await addTVFolder(ui, until, "fixtures");
  await until("Sources folder selection scans media for paired remotes", async () => {
    const { sources } = await api("/api/library/sources");
    return sources.some((source: any) => source.status === "ready" && source.itemCount >= 2);
  }, 30_000);
  const library = await api("/api/library/items?q=Linux&offset=0&limit=30", undefined, 1);
  assert.equal(library.items.length, 1);
  await clients[1]!.command({ type: "enqueueLibrary", itemId: library.items[0].id, entryId: crypto.randomUUID() });
  await until("second remote queues scanned media by library ID", () => all(state => state.queue.some(entry => entry.source === `library:${library.items[0].id}`)));
  const localEntry = clients[0]!.state!.queue.find(entry => entry.source === `library:${library.items[0].id}`)!;
  await clients[0]!.command({ type: "play", entryId: localEntry.id });
  await until("scanned local file plays through native libmpv", () => all(state => state.player.status === "playing" && state.currentEntryId === localEntry.id));
  await clients[0]!.command({ type: "stop" });

  const progressContext = {
    origin, ui, until, clients, api, item: library.items[0], entryId: localEntry.id,
    switchEntryId: clients[0]!.state!.queue.find(entry => entry.title === "Linux multitrack fixture")!.id,
  };
  const persistedProgress = await verifyLocalProgress(progressContext);
  await httpRemote!.restore();
  await httpRemote!.ui.section("Library");
  await httpRemote!.ui.button("History", '[aria-label="Library view"]');
  await until("HTTP phone history shows the shared Household profile and committed local resume point", async () => await httpRemote!.ui.execute("return document.querySelector('.history-panel')?.textContent.includes(arguments[1]) && !!document.querySelector(arguments[0])", [`.history-items [aria-label=${JSON.stringify(`Resume ${library.items[0].title}`)}]`, `${persistedProgress.household.name}'s local history.`]));
  await assertResponsive(httpRemote!.ui, "HTTP phone local history");
  await httpRemote!.ui.click(".watching-profile");
  await until("HTTP phone can inspect both watching profiles independently of its controller identity", async () => await httpRemote!.ui.execute("return document.querySelector('[role=dialog]')?.textContent.includes(arguments[0]) && document.querySelector('[role=dialog]')?.textContent.includes('Household')", [persistedProgress.otherProfile.name]));
  await assertResponsive(httpRemote!.ui, "HTTP phone watching profiles");
  await httpRemote!.ui.key(keys.escape);
  await until("HTTP phone Escape restores the watching profile trigger", async () => await httpRemote!.ui.execute("return !document.querySelector('[role=dialog]') && document.activeElement?.matches('.watching-profile')"));
  await httpRemote!.ui.section("Queue");
  const preferenceItem = (await api("/api/library/items?q=Playback%20preference%20fixture&offset=0&limit=30")).items[0];
  assert.equal(preferenceItem?.title, "Playback preference fixture", "Preferences use their own scanned multitrack file without changing the progress fixture");
  const preferenceEntryId = crypto.randomUUID();
  await clients[0]!.command({ type: "enqueueLibrary", itemId: preferenceItem.id, entryId: preferenceEntryId });
  await until("preference fixture is queued through the scanned local library", () => all(state => state.queue.some(entry => entry.id === preferenceEntryId && entry.source === `library:${preferenceItem.id}`)));
  const queueBeforeRestart = clients[0]!.state!.queue.map(entry => entry.id);
  const preferenceContext = { origin, ui, until, clients, httpRemote, otherRemote: secondHttpRemote, artifactDir, api, entryId: preferenceEntryId };
  const persistedPreferences = await verifyPlaybackPreferences({ ...preferenceContext, otherProfile: persistedProgress.otherProfile });
  const musicContext = { origin, ui, until, clients, api, httpRemote, artifactDir };
  const persistedMusic = await verifyMusic(musicContext);
  const persistedVideoLibrary = await verifyVideoLibrary(musicContext);
  const persistedClaim = await verifyClaim({ origin, ui, httpRemote, clients, until, artifactDir });
  const persistedFolderSettings = await verifyFolderSettings(musicContext);
  const persistedRadioSettings = await verifyRadioSettings({ origin, ui, until, clients, api, httpRemote, artifactDir }, radioFixture);
  const persistedJellyfinSettings = await verifyJellyfinSettings({ origin, ui, httpRemote, clients, until, artifactDir });
  const profileContext = { origin, ui, httpRemote, otherRemote: secondHttpRemote, until, clients, api, entryId: preferenceEntryId, artifactDir };
  const persistedProfiles = await verifyProfileManagement(profileContext);
  await httpRemote.restore();
  await httpRemote.ui.section("Queue");
  await httpRemote.ui.addMedia();
  await startShutdownPlayback?.();
  clients.forEach(client => client.socket.close());
  const exitStarted = performance.now();
  await webdriver(`/session/${sessionId}`, undefined, "DELETE");
  sessionId = "";
  await until("desktop exit stops its Bun sidecar", async () => {
    try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
  });
  assert.ok(performance.now() - exitStarted < 3_000, "desktop and sidecar shut down within three seconds");
  await verifyShutdownReport?.();
  await until("real HTTP browser disables stale controls after host shutdown", async () => await httpRemote!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Reconnecting' && document.querySelector('#media-url')?.disabled"));
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: {
    browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" },
  } } })).sessionId;
  await until("desktop restarts with current persistent state", async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected", 30_000);
  await assertTvFullscreen(ui, until, "desktop restart");
  clients.forEach(client => client.connect());
  await until("paired remotes, queue and volume survive desktop restart without autoplay", () => all(state =>
    state.player.status === "idle" && state.player.volume === 43 &&
    JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queueBeforeRestart),
  ));
  await until("real HTTP browser reconnects after desktop restart without stale actions", async () => await httpRemote!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected' && document.querySelector('.playback-status')?.textContent === 'Ready' && document.querySelectorAll('.queue-entry').length === arguments[0]", [queueBeforeRestart.length]));
  await httpRemote.ui.key(keys.escape);
  await assertProfilesAfterRestart(profileContext, persistedProfiles);
  await assertLocalProgressAfterRestart(progressContext, persistedProgress);
  await assertPlaybackPreferencesAfterRestart(preferenceContext, persistedPreferences);
  await assertMusicAfterRestart(musicContext, persistedMusic);
  await assertVideoLibraryAfterRestart(musicContext, persistedVideoLibrary);
  await persistedClaim.verifyAfterRestart(clients, httpRemote);
  await persistedJellyfinSettings?.verifyAfterRestart();
  await persistedRadioSettings.verifyAfterRestart();
  await persistedFolderSettings.verifyAfterRestart();
  const persistentFavorites = (await api("/api/radio/favorites")).favorites;
  assert.ok(persistentFavorites.some((favorite: any) => favorite.id === station.id));
  assert.equal((await api("/api/library/items?q=Linux&offset=0&limit=30")).items[0].id, library.items[0].id);
  checks.push("radio playlists, favorites and scanned library survive desktop restart");
  console.log("PASS radio playlists, favorites and scanned library survive desktop restart");
  await until("automatic webpage metadata and chosen quality survive desktop restart on both remotes", () => all(state => state.queue.some(entry =>
    entry.id === webEntryId && entry.title === webTitle && entry.thumbnail === "http://127.0.0.1:4200/logo.svg" && entry.quality === "480p",
  )));
  assert.ok((await api("/api/providers/favorites", undefined, 1)).favorites.some((item: ProviderItem) => item.id === providerFavorite.id));
  await section("Online");
  await click(".provider-views button:nth-child(2)");
  await until("provider favorites survive desktop restart in the native Saved view", async () => await execute("return document.querySelector('.provider-item h4')?.textContent") === providerFavorite.title);

  await radioAcceptance.prepareShutdown();
  clients.forEach(client => client.socket.close());
  const radioExitStarted = performance.now();
  await webdriver(`/session/${sessionId}`, undefined, "DELETE");
  sessionId = "";
  await until("desktop exit cancels radio backoff and stops its Bun sidecar", async () => {
    try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
  });
  assert.ok(performance.now() - radioExitStarted < 3_000, "Radio backoff does not delay desktop shutdown");
  await radioAcceptance.assertShutdown();
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: {
    browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" },
  } } })).sessionId;
  await until("desktop reconnects after shutdown during radio backoff", async () => await execute("return document.querySelector('[role=status]')?.textContent") === "Connected", 30_000);
  clients.forEach(client => client.connect());
  await radioAcceptance.assertAfterRestart();

  await Bun.write(`${artifactDir}/results.json`, JSON.stringify({ passed: checks, runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, rendering: "libmpv gpu-dumb-mode=yes" }, limitations: "Xvfb software rendering, the explicit basic GPU option, and a clocked PulseAudio null sink. The advanced renderer, hardware decoding, HDMI audio, HDR and real Wi-Fi were not qualified." }, null, 2));
} catch (error) {
  await screenshot("native-failure").catch(() => {});
  const diagnostics = await execute(`
    const active = document.activeElement, style = getComputedStyle(active);
    return { focus: { label: active?.getAttribute('aria-label'), html: active?.outerHTML,
      hiddenParent: active?.closest('[hidden], [inert], [aria-hidden=true]')?.outerHTML.slice(0, 500),
      documentFocus: document.hasFocus(), keyboard: document.documentElement.hasAttribute('data-keyboard'),
      selectedSource: document.querySelector('.source-nav [aria-selected=true]')?.textContent,
      visible: active?.matches(':focus-visible'), outline: style.outline, shadow: style.boxShadow },
      alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent),
      library: document.querySelector('.library-panel')?.textContent,
      queue: [...document.querySelectorAll('.queue-play')].map(button => button.getAttribute('aria-label')) };
  `).catch(() => null);
  await Bun.write(`${artifactDir}/diagnostics.json`, JSON.stringify(diagnostics, null, 2));
  await Bun.write(`${artifactDir}/failure.txt`, String(error));
  throw error;
} finally {
  await secondHttpRemote?.close();
  await httpRemote?.close();
  clients.forEach(client => client.socket.close());
  if (sessionId) await webdriver(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill();
  await media.stop(true);
  await radioFixture.close();
}
