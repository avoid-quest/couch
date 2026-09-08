import { strict as assert } from "node:assert";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import { remoteSocketUrl } from "./build";
import { verifySearch } from "./search";
import { verifyAcceptedUx } from "./accepted-ux";
import { seedConfiguredFixture } from "./configured-fixture";
import { addTVFolder } from "./folder-settings";
import { mkdir } from "node:fs/promises";
import { UiDriver, keys, startHttpRemote } from "./ui";
import { assertTvFullscreen } from "./tv-remote";

const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const artifactDir = "/artifacts/search";
await mkdir(artifactDir, { recursive: true });
const checks: { description: string; time: string; players: unknown[] }[] = [];
const clients: Remote[] = [];
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
seedConfiguredFixture();
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifactDir}/driver.log`), stderr: Bun.file(`${artifactDir}/native.log`) });
let sessionId = "";
let httpRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
let otherRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
const all = (predicate: (state: SessionState) => boolean) => clients.length === 2 && clients.every(client => client.state && predicate(client.state));

async function until(description: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `${description}: ${JSON.stringify(clients.map(client => client.state?.player))}`);
    await Bun.sleep(50);
  }
  checks.push({ description, time: new Date().toISOString(), players: clients.map(client => structuredClone(client.state?.player)) });
  console.log(`PASS ${description}`);
}

async function webdriver(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`${driverOrigin}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { value: any };
  assert.ok(response.ok && !result.value?.error, `WebDriver ${path}: ${JSON.stringify(result.value)}`);
  return result.value;
}
const ui = new UiDriver(webdriver, () => sessionId);
async function launch() {
  sessionId = (await webdriver("/session", { capabilities: { alwaysMatch: { browserName: "wry", timeouts: { implicit: 5_000 }, "tauri:options": { application: "/work/bin/couch" } } } })).sessionId;
  await until("native UI connects to its Bun sidecar", async () => await ui.execute("return document.querySelector('[role=status]')?.textContent") === "Connected", 30_000);
  await assertTvFullscreen(ui, until, "search qualification");
}
async function api(path: string, body?: unknown, index = 0) {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, Authorization: `Bearer ${clients[index]!.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json() as Promise<any>;
}
async function screenshot(name: string) {
  await ui.execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong, [data-administrator-code], [data-pairing-code], #administrator-code').forEach(element => element.style.visibility = 'hidden')");
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", `${artifactDir}/${name}.png`], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0);
}

class Remote {
  state: SessionState | null = null;
  socket!: WebSocket;
  pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(readonly token: string, readonly socketUrl: string) { this.connect(); }

  connect() {
    this.state = null;
    this.socket = new BunWebSocket(this.socketUrl, { headers: { origin } });
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


try {
  await until("official Tauri WebDriver ready", async () => { try { return (await fetch(`${driverOrigin}/status`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } });
  await launch();
  await until("TV starts on visible Browse and resume with Home selected", () => ui.execute(`
    const home = document.querySelector('[aria-label="Browse and resume"]');
    return !!home && !home.closest('[hidden]') && home.getClientRects().length > 0 && getComputedStyle(home).visibility === 'visible'
      && document.querySelector('.source-nav [data-source="Home"]')?.getAttribute('aria-selected') === 'true';
  `));
  await ui.click(".pair-shortcut");
  const code = await ui.execute("return document.querySelector('.pairing-display strong')?.textContent") as string;
  assert.match(code, /^\d{6}$/);
  await ui.key(keys.escape);
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${origin}/api/pair`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const token = (await response.json() as { token: string }).token;
    clients.push(new Remote(token, await remoteSocketUrl(origin, token)));
  }
  await until("two independently paired controllers receive the stopped session", () => all(state => state.player.status === "idle"));
  httpRemote = await startHttpRemote(origin, code, artifactDir, until, 4446, 1.5);
  await until("paired phone starts on the visible current session", () => httpRemote!.ui.execute(`
    const queue = document.querySelector('.remote-session .queue-panel');
    return !!queue && !queue.closest('[hidden]') && queue.getClientRects().length > 0 && getComputedStyle(queue).visibility === 'visible'
      && [...document.querySelectorAll('.mode-switch button')].some(button => button.textContent.trim() === 'On TV' && button.getAttribute('aria-pressed') === 'true');
  `));
  await httpRemote.minimize();
  otherRemote = await startHttpRemote(origin, code, artifactDir, until, 4447);
  await otherRemote.minimize();
  const context = { origin, ui, until, clients, api, httpRemote, artifactDir, screenshot };
  await mkdir("/mnt/search-fixtures", { recursive: true });
  const media = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=24:d=40", "-f", "lavfi", "-i", "sine=frequency=440:duration=40", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "40", "/mnt/search-fixtures/Search local video.mp4"], { stdout: "ignore", stderr: Bun.file(`${artifactDir}/media.log`) });
  assert.equal(await media.exited, 0, "Generate an actual 40-second local video for Search");
  const sourceId = await addTVFolder(ui, until, "search-fixtures");
  await until("Search fixture scans actual local video", async () => (await api("/api/library/sources")).sources.some((source: any) => source.id === sourceId && source.status === "ready" && source.itemCount === 1));
  assert.ok(process.env.COUCH_TEST_JELLYFIN, "Provide the disposable actual Jellyfin fixture configuration");
  const config = await Bun.file(process.env.COUCH_TEST_JELLYFIN!).json();
  await ui.section("Jellyfin");
  await ui.click('[data-action="jellyfin-settings"]');
  await until("Search fixture opens Jellyfin source configuration", () => ui.execute("return !!document.querySelector('#jellyfin-url')"));
  await ui.type("#jellyfin-url", config.containerUrl);
  await ui.type("#jellyfin-user", config.username);
  await ui.type("#jellyfin-password", config.password);
  await ui.click(".jellyfin-connect button.primary-button");
  await until("Search fixture connects the actual Jellyfin account", async () => (await api("/api/jellyfin")).connected === true, 30_000);
  await ui.key(keys.escape);
  await until("Jellyfin source configuration closes", () => ui.execute("return !document.querySelector('[role=dialog]')"));
  await verifyAcceptedUx(context);
  await verifySearch(context);
  if (process.env.COUCH_SEARCH_OUTAGE === "1") {
    await httpRemote.restore();
    await httpRemote.ui.section("Search");
    await httpRemote.ui.type("#media-search", "Search local video");
    await Bun.write(artifactDir + "/backend-pause-request", "Pause only this run's disposable Jellyfin backend.");
    await until("actual Jellyfin backend is paused by its fixture owner", () => Bun.file(artifactDir + "/backend-paused.json").exists(), 30_000);
    await httpRemote.ui.button("Search", '[aria-label="Search media"] form');
    await until("local Search results remain usable while actual Jellyfin search loads", () => httpRemote!.ui.execute("return document.querySelector('[aria-label=\"Jellyfin search results\"]')?.getAttribute('aria-busy') === 'true' && !!document.querySelector('[aria-label=\"Library search results\"] button[aria-label^=\"Play \"], [aria-label=\"Library search results\"] button[aria-label^=\"Resume \"]')?.matches(':enabled')"));
    await until("actual Jellyfin timeout exposes a bounded retry while local results remain", () => httpRemote!.ui.execute("return [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Retry Jellyfin' && !button.disabled) && !!document.querySelector('[aria-label=\"Library search results\"] button[aria-label^=\"Add \"]')?.matches(':enabled')"), 35_000);
    await httpRemote.screenshot("search-jellyfin-outage");
    await Bun.write(artifactDir + "/backend-resume-request", "Resume this run's disposable Jellyfin backend.");
    await until("actual Jellyfin backend resumes", () => Bun.file(artifactDir + "/backend-resumed.json").exists(), 30_000);
    await httpRemote.ui.button("Retry Jellyfin");
    await until("actual Jellyfin Retry returns without losing the local query", () => httpRemote!.ui.execute("return document.querySelector('[aria-label=\"Jellyfin search results\"]')?.getAttribute('aria-busy') === 'false' && ![...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Retry Jellyfin') && document.querySelector('#media-search').value === 'Search local video'"), 30_000);
    await httpRemote.screenshot("search-jellyfin-recovered");
    await httpRemote.minimize();
  }
  const queueIds = clients[0]!.state!.queue.map(entry => entry.id);
  clients.forEach(client => client.socket.close());
  await webdriver(`/session/${sessionId}`, undefined, "DELETE"); sessionId = "";
  await until("Search desktop exit stops its actual sidecar", async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 3_000);
  await launch(); clients.forEach(client => client.connect());
  await until("Search pairings reconnect with unchanged queue and no autoplay", () => all(state => state.player.status === "idle" && state.player.playbackId === null && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queueIds)));
  for (const [index, remote] of [httpRemote, otherRemote].entries()) {
    await until(`Search HTTP browser ${index + 1} reconnects stopped`, () => remote!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected' && document.querySelector('.playback-status')?.textContent === 'Ready'"));
  }
  console.log("PASS focused Search native playback and restart qualification");
} catch (error) {
  await screenshot("search-failure").catch(() => {});
  await Bun.write(`${artifactDir}/search-failure.json`, JSON.stringify({ error: String(error), players: clients.map(client => client.state?.player), checks }, null, 2));
  throw error;
} finally {
  await Bun.write(`${artifactDir}/search-checks.json`, JSON.stringify(checks, null, 2));
  clients.forEach(client => client.socket.close());
  await otherRemote?.close();
  await httpRemote?.close();
  if (sessionId) await webdriver(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill();
  await driver.exited;
}
