import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import type { ConnectionInfo, PlaybackCommand, PlayerState, ServerMessage, SessionState, SidecarMessage } from "../../src/shared/protocol";
import { frontendPaths } from "../../src/shared/page-paths";
import { seedConfiguredFixture } from "./configured-fixture";
import { remoteSocketUrl } from "./build";
import { assertResponsive, startHttpRemote, type Wait } from "./ui";

// The existing WebKit/X11 HTTP-remote driver, with the production sidecar and
// a pipe-level native peer. Run in the Linux test container (including its null
// PulseAudio sink). This checks delivery and commands, not libmpv or hardware.
const root = resolve(import.meta.dir, "../..");
const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
assert.ok(process.platform === "linux" && architecture, "Use the existing Linux amd64/arm64 test environment");
const binary = resolve(process.env.COUCH_SIDECAR ?? join(root, `src-tauri/binaries/couch-server-${architecture}-unknown-linux-gnu`));
const dist = resolve(process.env.COUCH_FRONTEND_DIST ?? join(root, "dist"));
const artifacts = resolve(process.env.COUCH_ARTIFACTS ?? join(root, ".artifacts/built-remote"));
await mkdir(artifacts, { recursive: true });
await rm(join(artifacts, "result.json"), { force: true });
const directory = await mkdtemp(join(tmpdir(), "couch-built-remote-"));
seedConfiguredFixture(directory);
// Replace only the external extractor; the compiled coordinator, provider adapter,
// browser result and native command pipe remain real.
const extractor = join(directory, "provider-extractor");
const providerUrl = "https://www.youtube.com/watch?v=abcdefghijk";
const providerTransport = "https://media.example/private-provider.mp4";
await Bun.write(extractor, `#!/usr/bin/env bun
const item = { id: "abcdefghijk", title: "Provider result fixture", webpage_url: ${JSON.stringify(providerUrl)}, url: ${JSON.stringify(providerTransport)}, vcodec: "h264", acodec: "aac", duration: 60 };
console.log(JSON.stringify(process.argv.some(value => value.includes("/results?")) ? { entries: [item] } : item));
`);
await chmod(extractor, 0o700);
const hostToken = crypto.randomUUID() + crypto.randomUUID();
const checks: string[] = [];
const commands: PlaybackCommand[] = [];
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 80, seekable: false, error: null };
let observed = idle;
let info: ConnectionInfo | undefined;
let latest: SessionState | undefined;
let pipeError: unknown;
let remote: Awaited<ReturnType<typeof startHttpRemote>> | undefined;
let socket: WebSocket | undefined;
const child = Bun.spawn([binary], {
  cwd: directory, stdin: "pipe", stdout: "pipe", stderr: Bun.file(join(artifacts, "sidecar.log")),
  env: { ...process.env, COUCH_YT_DLP: extractor, COUCH_NATIVE: "1", COUCH_HOST_TOKEN: hostToken, COUCH_DATA_DIR: directory, COUCH_PORT: "0", COUCH_APPIMAGE: "0", COUCH_PACKAGE_UPDATE: "0", COUCH_MAINTENANCE_ONLY: "0" },
});
const send = (message: unknown) => { child.stdin.write(JSON.stringify(message) + "\n"); child.stdin.flush(); };
const reader = (async () => {
  let pending = "";
  for await (const text of child.stdout.pipeThrough(new TextDecoderStream())) {
    pending += text;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line) as SidecarMessage;
      if (message.type === "ready") { info = message; send({ type: "player", state: idle }); }
      else if (message.type === "diagnostics") send({ type: "diagnostics", requestId: message.requestId, report: { facts: [] } });
      else if (message.type === "observe") send({ type: "player", state: observed });
      else if (message.type === "playback") {
        const command = message.command;
        commands.push(command);
        if (command.type === "load") observed = { ...idle, playbackId: command.playbackId, status: "playing", seekable: true, duration: 60 };
        else if (command.type === "stop") observed = { ...idle };
        else if (command.type === "pause") observed = { ...observed, status: command.paused ? "paused" : "playing" };
        else if (command.type === "volume") observed = { ...observed, volume: command.volume };
        else continue;
        send({ type: "player", state: observed });
      }
    }
  }
})().catch(error => { pipeError = error; });
const until: Wait = async (description, predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (pipeError) throw pipeError;
    assert.ok(child.exitCode === null, `Sidecar exited while ${description}`);
    assert.ok(Date.now() < deadline, description);
    await Bun.sleep(50);
  }
  checks.push(description);
};
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
let receipt: string | undefined;
try {
  await until("built sidecar announces readiness", () => !!info);
  const { origin, pairingCode } = info!;
  const api = (path: string, body?: unknown) => fetch(origin + path, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000),
    headers: { Origin: origin, Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const build = await (await api("/api/build")).json();
  const revision = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]);
  assert.equal(revision.exitCode, 0);
  assert.equal(build.revision, revision.stdout.toString().trim(), "Exercise the current source revision, not an older binary");
  assert.equal(build.dirty, false, "Build the committed revision before recording acceptance");
  const index = await Bun.file(join(dist, "index.html")).bytes();
  for (const path of new Set(frontendPaths)) {
    const response = await fetch(origin + path + "?journey=built", { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, path);
    assert.equal(digest(new Uint8Array(await response.arrayBuffer())), digest(index), `${path} serves Tauri's exact index bytes`);
  }
  const assets: Array<{ path: string; sha256: string }> = [];
  for await (const file of new Bun.Glob("**/*").scan({ cwd: dist, absolute: true, onlyFiles: true })) {
    const path = "/" + relative(dist, file).split(sep).join("/");
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, path);
    const hash = digest(await Bun.file(file).bytes());
    assert.equal(digest(new Uint8Array(await response.arrayBuffer())), hash, `${path} retains the Vite output bytes`);
    assets.push({ path, sha256: hash });
  }
  assert.ok(assets.some(asset => asset.path === "/sw.js"));
  assert.ok(assets.some(asset => asset.path === "/manifest.webmanifest"));
  for (const path of ["/api/not-a-page", "/settings/not-a-page"]) assert.notEqual((await api(path)).status, 200, `${path} does not become the application shell`);
  assert.equal((await api("/api/settings/sharing", { enabled: true })).status, 200);
  const NativeWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  socket = new NativeWebSocket(await remoteSocketUrl(origin, hostToken), { headers: { Origin: origin } });
  socket.onmessage = event => { const message = JSON.parse(String(event.data)) as ServerMessage; if (message.type === "state") latest = message.state; };
  await until("coordinator publishes an idle session with an available test audio output", () => latest?.player.status === "idle" && !latest.systemAudio?.error);
  // Only seed an unplayed queue occurrence. Play and Stop below must originate
  // from the browser, not this authenticated observation socket.
  const entry = { id: "built-remote-fixture", title: "Built remote fixture", source: "https://media.example/built-remote.mp3" };
  socket.send(JSON.stringify({ type: "command", requestId: "seed", action: { type: "enqueue", entry } }));
  await until("fixture is queued without playback", () => latest?.queue.some(item => item.id === entry.id) === true && latest.currentEntryId === null);
  remote = await startHttpRemote(origin + "/saved", pairingCode, artifacts, until);
  const { ui } = remote;
  assert.equal(await ui.execute("return location.origin"), origin);
  assert.equal(await ui.execute("return !!window.__TAURI_INTERNALS__"), false);
  await ui.section("Now");
  await ui.button(`Play ${entry.title}`);
  await until("browser Play reaches the coordinator and its native pipe", () => latest?.currentEntryId === entry.id && latest.player.status === "playing" && commands.some(command => command.type === "load" && command.source === entry.source));
  assert.ok(latest?.playedBy?.deviceId && latest.playedBy.deviceId !== "host", "Playback is attributed to the paired browser");
  await ui.section("Now");
  for (const size of [1, 1.3]) {
    await ui.execute("document.documentElement.style.setProperty('--interface-scale', arguments[0])", [String(size)]);
    await until(`player fits the viewport without page scrolling at ${size}× interface size`, async () => await ui.execute(`
      const player = document.querySelector('[data-page="Now"]');
      if (!player) return false;
      const rect = player.getBoundingClientRect();
      return Math.abs(rect.top) <= 1 && Math.abs(rect.bottom - innerHeight) <= 1
        && document.documentElement.scrollHeight <= innerHeight + 1
        && document.documentElement.scrollWidth <= innerWidth + 1;
    `));
  }
  await ui.execute("document.documentElement.style.removeProperty('--interface-scale')");
  await ui.button("Stop");
  await until("browser Stop reaches the coordinator and its native pipe", () => latest?.currentEntryId === null && commands.at(-1)?.type === "stop");
  await ui.section("Find");
  await ui.type("#media-search", "provider fixture");
  await until("provider fixture appears in Find", async () => await ui.execute('return !!document.querySelector(\'[aria-label="Play Provider result fixture"]\')'));
  await assertResponsive(ui, "Phone Find");
  await ui.button("Play Provider result fixture");
  await until("provider result Play creates one occurrence and reaches the native pipe", () => {
    const occurrences = latest?.queue.filter(item => item.source === `web:${providerUrl}`) ?? [];
    return occurrences.length === 1 && latest?.currentEntryId === occurrences[0]?.id && latest?.player.status === "playing"
      && commands.some(command => command.type === "load" && command.source === providerTransport);
  });
  assert.ok(latest?.playedBy?.deviceId && latest.playedBy.deviceId !== "host");
  assert.ok(!JSON.stringify(latest).includes(providerTransport), "Resolved transport remains private to the native pipe");
  await ui.section("Now");
  await ui.button("Stop");
  await until("provider playback stops through the browser", () => latest?.currentEntryId === null && commands.at(-1)?.type === "stop");
  await ui.section("Saved");
  await remote.refresh();
  await until("refresh retains the deep-link route and pairing", async () => await ui.execute("return location.pathname") === "/saved" && await ui.execute("return !!localStorage.getItem('couch.remote-token') && document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected' && !!document.querySelector('[data-app-nav]')"));
  await ui.section("Now");
  assert.equal(await ui.execute("return isSecureContext"), true, "Loopback supplies a supported secure context; ordinary HTTP LAN addresses do not");
  const registrations = () => ui.request(`/session/${ui.session()}/execute/async`, {
    script: "const done = arguments[arguments.length - 1]; navigator.serviceWorker.getRegistrations().then(values => done(values.map(value => ({ scope: value.scope, script: value.active?.scriptURL }))), error => done({ error: String(error) }));", args: [],
  });
  await until("root worker activates after a deep-link load", async () => {
    const values = await registrations();
    return Array.isArray(values) && values.some(value => value.scope === origin + "/" && value.script === origin + "/sw.js");
  });
  await remote.screenshot("built-remote");
  receipt = JSON.stringify({ revision: build.revision, build, simulatedNative: true, hardwareVerified: false, checks, assets }, null, 2);
} finally {
  let cleanupError: unknown;
  if (!receipt) await remote?.screenshot("journey-failure").catch(() => {});
  try { await remote?.close(); } catch (error) { cleanupError = error; }
  try { socket?.close(); } catch (error) { cleanupError ??= error; }
  try { send({ type: "shutdown" }); } catch { /* The process may already have failed. */ }
  const killed = setTimeout(() => child.kill(), 5_000);
  const code = await child.exited;
  clearTimeout(killed);
  await reader;
  await rm(directory, { recursive: true, force: true });
  if (receipt) { assert.equal(code, 0, "Sidecar shuts down cleanly"); if (cleanupError) throw cleanupError; if (pipeError) throw pipeError; }
}
// Only retain success evidence after browser and sidecar cleanup also succeeded.
await Bun.write(join(artifacts, "result.json"), receipt!);
console.log(`PASS built-sidecar remote: ${checks.length} checks; simulated native playback, no hardware qualification.`);
