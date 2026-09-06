import { strict as assert } from "node:assert";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";
import { verifyCue, assertCueAfterRestart } from "./cue";
import { UiDriver, keys, startHttpRemote } from "./ui";
import { assertTvFullscreen } from "./tv-remote";

const origin = "http://127.0.0.1:4100";
const driverOrigin = "http://127.0.0.1:4444";
const artifactDir = "/artifacts";
const checks: { description: string; time: string; players: unknown[] }[] = [];
const clients: Remote[] = [];
const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
const driver = Bun.spawn(["tauri-driver"], { stdout: Bun.file(`${artifactDir}/driver.log`), stderr: Bun.file(`${artifactDir}/native.log`) });
let sessionId = "";
let httpRemote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
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
  await assertTvFullscreen(ui, until, "cue qualification");
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


try {
  await until("official Tauri WebDriver ready", async () => { try { return (await fetch(`${driverOrigin}/status`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; } });
  await launch();
  await until("fresh TV displays its administrator setup dialog", () => ui.execute("return /^[0-9]{10}$/.test(document.querySelector('[data-administrator-code]')?.textContent || '')"));
  await ui.key(keys.escape);
  await ui.click(".pair-shortcut");
  const code = await ui.execute("return document.querySelector('.pairing-display strong')?.textContent") as string;
  assert.match(code, /^\d{6}$/);
  await ui.key(keys.escape);
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${origin}/api/pair`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    clients.push(new Remote((await response.json() as { token: string }).token));
  }
  await until("two independently paired controllers receive the stopped session", () => all(state => state.player.status === "idle"));
  httpRemote = await startHttpRemote(origin, code, artifactDir, until);
  const context = { origin, ui, until, clients, api, httpRemote, artifactDir, screenshot };
  const saved = await verifyCue(context);
  const queueIds = clients[0]!.state!.queue.map(entry => entry.id);
  clients.forEach(client => client.socket.close());
  const exitStarted = performance.now();
  await webdriver(`/session/${sessionId}`, undefined, "DELETE");
  sessionId = "";
  await until("desktop exit stops the actual Bun sidecar", async () => { try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; } }, 3_000);
  assert.ok(performance.now() - exitStarted < 3_000);
  await launch();
  clients.forEach(client => client.connect());
  await until("both persisted pairings reconnect with the same queue and no autoplay", () => all(state => state.player.status === "idle" && state.player.playbackId === null && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queueIds)));
  await until("real phone browser reconnects after desktop restart", () => httpRemote!.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  // Dismiss the still-unclaimed installation's setup dialog after real restart.
  if (await ui.execute("return !!document.querySelector('[data-administrator-code]')")) await ui.key(keys.escape);
  await assertCueAfterRestart(context, saved);
  console.log("PASS focused cue native playback and restart qualification");
} catch (error) {
  await screenshot("cue-failure").catch(() => {});
  await Bun.write(`${artifactDir}/cue-failure.json`, JSON.stringify({ error: String(error), players: clients.map(client => client.state?.player), checks }, null, 2));
  throw error;
} finally {
  await Bun.write(`${artifactDir}/cue-checks.json`, JSON.stringify(checks, null, 2));
  clients.forEach(client => client.socket.close());
  await httpRemote?.close();
  if (sessionId) await webdriver(`/session/${sessionId}`, undefined, "DELETE").catch(() => {});
  driver.kill();
  await driver.exited;
}
