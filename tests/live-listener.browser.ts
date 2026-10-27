// After bun run build, bundle for Node as docs/ci.md describes. Uses an external Playwright
// installation (COUCH_PLAYWRIGHT) and headless Chrome (COUCH_CHROME), never an X display.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { Identity } from "@sonn-audio/node-sendspin";
import WebSocket from "ws";
import { buildInfo } from "../src/shared/build";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { prepareNativeCapture } from "../app/native-capture";
import type { Action, ServerMessage } from "../src/shared/protocol";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => unknown, label: string, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { assert(Date.now() < deadline, label); await sleep(50); }
}
const hostToken = "h".repeat(64), sourceId = "fixture-concert", uploadToken = "1".repeat(64);
if (process.argv.includes("--core")) {
  Object.assign(buildInfo, JSON.parse(readFileSync("build/build-info.json", "utf8")));
  const databasePath = join(process.env.COUCH_DATA_DIR!, "couch.sqlite");
  const store = openStore(databasePath, true);
  const key = Identity.fromPrivateB64u(process.env.COUCH_TEST_KEY!);
  const token = store.device(key.peerId) ? process.env.COUCH_TEST_TOKEN! : store.pair(key.peerId, "Studio listener");
  const installationId = store.installationId(); store.close();
  const hub = await createHub({ databasePath, hostToken, port: Number(process.env.COUCH_PORT), managedLan: true,
    allowLanHttp: true, remoteControlEnabled: true, advertisedUrls: [] });
  let urls: string[] = [];
  await until(async () => { urls = (await (await fetch(`${hub.origin}/api/connection`)).json()).urls; return urls.some(url => url.startsWith("https:")); }, "LAN listener starts");
  process.send!({ token, installationId, urls, origin: hub.origin });
  process.on("SIGTERM", () => void hub.close().then(() => process.exit()));
} else {
  const directory = process.env.COUCH_EVIDENCE ?? mkdtempSync(join(tmpdir(), "couch-l3-"));
  mkdirSync(directory, { recursive: true });
  const data = join(directory, "data"); mkdirSync(data, { recursive: true });
  const portServer = createServer(); await new Promise<void>(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>(resolve => portServer.close(() => resolve()));
  const key = Identity.generate();
  let token = "", core: ChildProcess | undefined, capture: Awaited<ReturnType<typeof prepareNativeCapture>> | undefined;
  let browser: any, page: any, host: WebSocket | undefined;
  const pids: number[] = [], errors: string[] = [];
  const coreStart = () => new Promise<any>((resolve, reject) => {
    core = spawn(process.execPath, [process.argv[1]!, "--core"], { env: { ...process.env, COUCH_DATA_DIR: data, COUCH_PORT: String(port), COUCH_TEST_KEY: key.privateB64u, COUCH_TEST_TOKEN: token }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    pids.push(core.pid!);
    core.stdout!.on("data", chunk => process.stdout.write(chunk)); core.stderr!.on("data", chunk => process.stderr.write(chunk));
    core.once("error", reject); core.once("message", value => resolve(value));
    core.once("exit", code => reject(new Error(`Fixture Core exited before ready (${code})`)));
  });
  let hostMessages: ServerMessage[] = [];
  const connectHost = async () => {
    hostMessages = [];
    host = new WebSocket(`ws://127.0.0.1:${port}/api/ws?token=${hostToken}&device=${Identity.generate().peerId}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
    host.on("message", data => hostMessages.push(JSON.parse(String(data)))); host.on("error", () => {});
    await until(() => hostMessages.some(message => message.type === "state"), "host connected");
  };
  let sequence = 0;
  const command = async (action: Action) => {
    const requestId = String(++sequence); host!.send(JSON.stringify({ type: "command", requestId, action }));
    await until(() => hostMessages.some(message => message.type === "result" && message.requestId === requestId), action.type);
    const result = hostMessages.find(message => message.type === "result" && message.requestId === requestId) as Extract<ServerMessage, { type: "result" }>;
    assert(result.ok, result.error);
  };
  const publish = async () => {
    const saved = await fetch(`http://127.0.0.1:${port}/api/settings/live-audio`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ settings: { lead: "fixed", leadMs: 200, maxLeadMs: 200 } }) });
    assert.equal(saved.status, 200);
    await command({ type: "publishLive", sourceId, uploadToken, kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" });
    await until(() => hostMessages.some(message => message.type === "livePeers" && message.upload), "upload demand");
    const demand = hostMessages.findLast(message => message.type === "livePeers" && message.upload) as Extract<ServerMessage, { type: "livePeers" }>;
    const child = spawn(process.execPath, [resolve("tests/fixtures/native-capture-helper.mjs"), "stream"], { stdio: ["pipe", "pipe", "pipe"] });
    pids.push(child.pid!);
    capture = await prepareNativeCapture(child, { sampleRate: 48000, requestedCallbackFrames: 128 }, error => errors.push(error.message));
    await capture.upload(`ws://127.0.0.1:${port}/api/live/upload?${new URLSearchParams({ token: hostToken, key: uploadToken, sourceId, uploadId: demand.uploadId! })}`);
  };
  try {
    const config = await coreStart(); token = config.token;
    const origin = config.urls.find((url: string) => url.startsWith("https:")); assert(origin, "fixture needs a LAN HTTPS address");
    await connectHost(); await publish();
    const playwright = await import(process.env.COUCH_PLAYWRIGHT ?? "playwright");
    browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.COUCH_CHROME,
      args: ["--alsa-output-device=null", "--no-sandbox", "--ignore-certificate-errors", "--mute-audio", "--audio-buffer-size=128", "--autoplay-policy=document-user-activation-required"] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    await context.addInitScript(({ token, installationId, key }: any) => {
      localStorage.setItem("couch.remote-token", token); localStorage.setItem("couch.remote-installation-id", installationId);
      localStorage.setItem("sendspin-identity-sk", key); localStorage.setItem("couch.device-name", "Studio listener");
      localStorage.setItem("couch.device-sharing", JSON.stringify({ audio: true, video: false }));
      const probe = (window as any).__live = { reports: [], states: [], instructions: [], workers: [], behind: false, started: performance.timeOrigin, gains: [] };
      const createGain = AudioContext.prototype.createGain;
      AudioContext.prototype.createGain = function () { const gain = createGain.call(this); probe.gains.push(gain); return gain; };
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (String(url).includes("listener-worker")) {
            probe.workers.push(this);
            this.addEventListener("message", ({ data }) => { if (data.type === "stats") probe.reports.push({ at: Date.now(), ...data.stats }); else if (data.type === "state") probe.states.push(data.value); });
          }
        }
        override postMessage(message: any, transfer?: any) {
          if (message.type === "stats" && probe.behind) message = { ...message, stats: { ...message.stats, needMs: 300, debtMs: 100 } };
          super.postMessage(message, transfer);
        }
      };
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", ({ data }) => { if (typeof data === "string") { const value = JSON.parse(data); if (value.type === "live" || value.type === "sendspin" || value.type === "player" || value.type === "liveSignal") probe.instructions.push(value); } });
        }
      };
    }, { token, installationId: config.installationId, key: key.privateB64u });
    page = await context.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(`${origin}/now`);
    await until(() => hostMessages.findLast(message => message.type === "state")?.type === "state" && hostMessages.some(message => message.type === "state" && message.state.devices?.some(device => device.id === key.peerId && device.online)), "browser paired");
    await command({ type: "playLive", sourceId, deviceId: key.peerId });
    await page.getByRole("button", { name: "Open player", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    const shots = process.env.COUCH_SCREENSHOTS;
    const screenshot = async (name: string) => {
      if (!shots) return;
      mkdirSync(shots, { recursive: true });
      for (const [size, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]] as const) {
        await page.setViewportSize(viewport);
        for (const theme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme: theme });
          await page.evaluate((theme: string) => { document.documentElement.classList.toggle("dark", theme === "dark"); document.documentElement.style.colorScheme = theme; }, theme);
          if (name === "https-required") {
            const status = await page.getByText(/^Live needs the HTTPS address:/).first().boundingBox();
            assert(status && status.x >= 0 && status.x + status.width <= viewport.width, "HTTPS address fits the viewport");
          }
          await page.screenshot({ path: join(shots, `${name}-${size}-${theme}.png`) });
        }
      }
    };
    await page.waitForFunction(() => (window as any).__live.states.length > 0);
    // The existing Start button unlocks the actual AudioContext.
    const start = page.getByRole("button", { name: /^(Start|Tap to hear)$/ });
    await start.waitFor({ state: "visible" }); await screenshot("start-tap"); await start.click();
    await page.getByText("Preparing audio…", { exact: true }).first().waitFor(); await screenshot("preparing");
    await page.waitForFunction(() => (window as any).__live.reports.some((report: any) => report.played > 0));
    await page.getByText("Listening", { exact: true }).first().waitFor({ timeout: 35000 }); await screenshot("playing");
    await command({ type: "volume", deviceId: key.peerId, volume: 23 });
    await page.waitForFunction(() => (window as any).__live.gains.at(-1)?.gain.value === Math.fround(0.23));
    await command({ type: "mute", deviceId: key.peerId, muted: true });
    await page.waitForFunction(() => (window as any).__live.gains.at(-1)?.gain.value === 0);
    await command({ type: "mute", deviceId: key.peerId, muted: false });
    await command({ type: "volume", deviceId: key.peerId, volume: 100 });
    await page.waitForFunction(() => (window as any).__live.gains.at(-1)?.gain.value === 1);
    assert(await page.evaluate(() => !(window as any).__live.instructions.some((message: any) => message.type === "liveSignal" || message.type === "player" && message.command.type === "load" && message.command.livePeerId)), "Live volume never creates a WebRTC receiver");
    // Measure full, real one-second reports after startup. No synthetic scheduling or stats during this window.
    const begin = Date.now(), duration = Number(process.env.COUCH_LIVE_SECONDS ?? 125) * 1000;
    for (let remaining = duration; remaining > 0; remaining -= 10000) {
      await sleep(Math.min(10000, remaining));
      console.log(`Live browser measurement: ${Math.min(duration, Date.now() - begin)} / ${duration} ms`);
    }
    const reports = await page.evaluate((begin: number) => (window as any).__live.reports.filter((report: any) => report.at >= begin), begin);
    assert(reports.length >= duration / 1000 - 5, "regular stats for the entire run");
    assert(reports.every((report: any) => report.played > 0), "every interval renders audio");
    const sum = (field: string) => reports.reduce((total: number, report: any) => total + report[field], 0);
    const stats = { seconds: (reports.at(-1).at - reports[0].at) / 1000, reports: reports.length, missing: sum("missing"), played: sum("played"), concealed: sum("concealed"), concealEvents: sum("concealEvents"), resyncs: sum("resyncs"), last: reports.at(-1) };
    writeFileSync(join(directory, "stats.json"), JSON.stringify({ stats, reports }, null, 2));
    assert.equal(stats.missing, 0, "HTTPS worklet has zero missing samples");
    assert(await page.evaluate(() => !(window as any).__live.instructions.some((message: any) => message.type === "sendspin" && message.listen)), "Live never starts Sendspin");
    await page.evaluate(() => { (window as any).__live.behind = true; });
    await page.getByText(/Behind by \d+ ms/).first().waitFor({ timeout: 20000 }); await screenshot("behind");
    await page.evaluate(() => { (window as any).__live.behind = false; });
    const started = await page.evaluate(() => performance.timeOrigin);
    // Kill only our fixture Core. A new capture publication is required after Core loses its in-memory shares.
    await capture!.stop(); capture = undefined;
    const oldCore = core!; oldCore.kill("SIGKILL"); await new Promise(resolve => oldCore.once("exit", resolve));
    host!.terminate();
    await page.locator('[role="status"]').filter({ hasText: /^Reconnecting…$/ }).first().waitFor(); await screenshot("reconnecting");
    await coreStart(); await connectHost(); await publish();
    await until(() => hostMessages.some(message => message.type === "state" && message.state.devices?.some(device => device.id === key.peerId && device.online)), "browser reconnects", 20000);
    await command({ type: "playLive", sourceId, deviceId: key.peerId });
    const rejoinedAt = Date.now();
    await page.waitForFunction((at: number) => (window as any).__live.reports.some((report: any) => report.at > at && report.played > 0), rejoinedAt, { timeout: 20000 });
    assert.equal(await page.evaluate(() => performance.timeOrigin), started, "Core restart resumes without reloading");
    const state = hostMessages.findLast(message => message.type === "state") as Extract<ServerMessage, { type: "state" }>;
    const playbackId = state.state.playbacks!.find(playback => playback.outputs.some(output => output.deviceId === key.peerId))!.id;
    // Commands address the Session's player playbackId, not the mix ID.
    const liveState = await page.evaluate(() => {
      const root: any = document.getElementById("root"), container = root[Object.keys(root).find(key => key.startsWith("__reactContainer"))!];
      const nodes = [container.stateNode.current];
      while (nodes.length) { const node = nodes.pop(), value = node?.memoizedProps?.value; if (value?.state?.player && value?.queryClient) return value.state; if (node?.child) nodes.push(node.child); if (node?.sibling) nodes.push(node.sibling); }
    });
    assert(liveState?.player.playbackId, playbackId);
    await command({ type: "removeLiveListener", playbackId: liveState.player.playbackId, deviceId: key.peerId });
    await page.getByText("Removed by the host", { exact: true }).first().waitFor(); await screenshot("removed");
    // The same paired test identity joins from a genuine insecure LAN origin; localhost is secure even over HTTP.
    await page.goto(`${origin.replace("https:", "http:")}/now`);
    await until(() => hostMessages.filter(message => message.type === "state" && message.state.devices?.some(device => device.id === key.peerId && device.online)).length > 0, "HTTP connects");
    await sleep(1000); await command({ type: "playLive", sourceId, deviceId: key.peerId });
    await page.getByText(`Live needs the HTTPS address: ${origin}`, { exact: true }).first().waitFor(); await screenshot("https-required");
    assert.equal(await page.evaluate(() => (window as any).__live.workers.length), 0, "HTTP creates no Live worker");
    assert.equal(await page.evaluate(() => isSecureContext), false);
    assert.deepEqual(errors, []);
    writeFileSync(join(directory, "result.json"), JSON.stringify({ passed: true, stats, restartedWithoutReload: true, httpNeedsHttps: true, pids }, null, 2));
    console.log(JSON.stringify({ passed: true, directory, stats }));
  } catch (error) {
    writeFileSync(join(directory, "failure.txt"), String((error as Error).stack));
    if (page) { writeFileSync(join(directory, "page.txt"), await page.locator("body").innerText()); await page.screenshot({ path: join(directory, "failure.png") }); }
    if (page) writeFileSync(join(directory, "probe.json"), JSON.stringify(await page.evaluate(() => ({ ...((window as any).__live ?? {}), workers: undefined, gains: undefined })), null, 2));
    console.error(errors); throw error;
  } finally {
    await browser?.close(); host?.terminate(); await capture?.stop();
    if (core && core.exitCode === null && core.signalCode === null) { core.kill("SIGTERM"); await new Promise(resolve => core!.once("exit", resolve)); }
    writeFileSync(join(directory, "pids.json"), JSON.stringify(pids));
  }
}
