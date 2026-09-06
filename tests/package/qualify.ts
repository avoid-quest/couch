import { remoteSocketUrl } from "../linux/build";
import { strict as assert } from "node:assert";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { openStore } from "../../src/server/store";
import { createLibrary } from "../../src/server/library";
import inputs from "../../packaging/inputs.json";

const root = resolve(".artifacts/package-qualification", `${Date.now()}-${process.pid}`);
const fixtures = resolve(".artifacts/package-fixtures");
const container = `couch-package-${process.pid}`;
const origin = "http://127.0.0.1:44100";
const expected = await Bun.file("src-tauri/build-info.json").json();
const checks: string[] = [];
assert.equal(process.platform, "linux", "Qualification uses Linux Docker host networking for the loopback-only official driver");
assert.equal(process.arch, "x64");
await mkdir(root, { recursive: true });
await rm(fixtures, { recursive: true, force: true });
await mkdir(fixtures, { recursive: true });
function run(command: string[]) {
  const child = Bun.spawnSync(command, { stderr: "inherit" });
  assert.equal(child.exitCode, 0, command.join(" "));
  return child.stdout.toString().trim();
}
function record(description: string) { checks.push(description); console.log(`PASS ${description}`); }
async function until(description: string, predicate: () => Promise<unknown>, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `${description} timed out`);
    await Bun.sleep(100);
  }
  record(description);
}
async function driver(port: number, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, JSON.stringify(result));
  return result.value;
}
const artifact = process.argv[2];
assert.ok(artifact, "Supply the exact Debian artifact");
await cp(artifact, `${fixtures}/couch.deb`);
// An older Debian version of this binary exercises APT upgrade ownership without a second build.
run(["dpkg-deb", "--raw-extract", artifact, `${fixtures}/before`]);
const control = Bun.file(`${fixtures}/before/DEBIAN/control`);
await Bun.write(control, (await control.text()).replace(/^Version:.*$/m, "Version: 0.0.0~qualification"));
run(["dpkg-deb", "--build", "--root-owner-group", `${fixtures}/before`, `${fixtures}/couch-before.deb`]);
await rm(`${fixtures}/before`, { recursive: true });
await cp("tests/package/runtime.sh", `${fixtures}/runtime.sh`);
await cp("tests/package/display.sh", `${fixtures}/display.sh`);
await cp(run(["which", "tauri-driver"]), `${fixtures}/tauri-driver`);
await Bun.write(`${fixtures}/keep.txt`, "Existing user data outside package ownership\n");
const databasePath = `${fixtures}/couch.sqlite`;
const store = openStore(databasePath);
const profile = store.createProfile("Existing viewer");
store.selectProfile(profile.id);
const previousToken = store.pair("Existing remote");
store.createControllerClaim("fixture-administrator", false);
store.consumeControllerClaim(store.controllerForToken(previousToken)!.id, "fixture-administrator");
store.close();
await createLibrary({ databasePath }).close();
const db = new Database(databasePath);
db.query("INSERT INTO library_sources (id, name, path) VALUES (?, ?, ?)").run("existing-source", "Existing media", "/home/qualifier/Videos");
db.close();
await mkdir(`${fixtures}/media`, { recursive: true });
run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "title=Package video", `${fixtures}/media/sample.mp4`]);
const media = Bun.serve({ hostname: "127.0.0.1", port: 44212, fetch: request => new URL(request.url).pathname === "/sample.mp4" ? new Response(Bun.file(`${fixtures}/media/sample.mp4`)) : new Response('<!doctype html><title>Package web fixture</title><video src="/sample.mp4"></video>', { headers: { "Content-Type": "text/html" } }) });
run(["docker", "run", "-d", "--init", "--name", container, "--platform", "linux/amd64", "--shm-size=1g", "--network", "host", "--mount", `type=bind,source=${fixtures},target=/qualification,readonly`, "--mount", `type=bind,source=${root},target=/evidence`, inputs.runtimeImage, "bash", "/qualification/runtime.sh"]);
let native = "";
let browser = "";
let socket: WebSocket | undefined;
let state: any;
const commands = new Map<string, (value: any) => void>();
const command = (action: unknown) => new Promise<void>((accept, reject) => {
  const requestId = crypto.randomUUID();
  const timeout = setTimeout(() => reject(new Error("Playback command timed out")), 20_000);
  commands.set(requestId, result => { clearTimeout(timeout); result.ok ? accept() : reject(new Error(result.error)); });
  socket!.send(JSON.stringify({ type: "command", requestId, action }));
});
try {
  await until("Clean APT install, upgrade and reinstall complete", async () => {
    const failure = Bun.file(`${root}/runtime-failed`);
    if (await failure.exists()) throw new Error(await failure.text());
    return Bun.file(`${root}/runtime-ready`).exists();
  }, 240_000);
  await until("Official native driver starts", async () => fetch("http://127.0.0.1:44444/status").then(r => r.ok).catch(() => false));
  const start = async () => {
    native = (await driver(44444, "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: "/usr/bin/couch" } } } })).sessionId;
    await until("Installed fullscreen TV UI opens", async () => driver(44444, `/session/${native}/execute/sync`, { script: "return !!document.querySelector('.tv-shell')", args: [] }));
    return driver(44444, `/session/${native}/execute/async`, { script: "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke('connection_info').then(done);", args: [] });
  };
  const connection = await start();
  const api = async (path: string, token = previousToken, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
    return response.json();
  };
  assert.deepEqual(await api("/api/build"), expected);
  assert.ok((await api("/api/profiles")).profiles.some((p: any) => p.id === profile.id));
  assert.equal((await api("/api/profiles")).activeProfile.id, profile.id);
  record("Prior remote authorization and watching profile survive adoption");
  const verified = await api("/api/library/sources/existing-source/verify", previousToken, { confirmed: true });
  assert.equal(verified.sources.find((source: any) => source.id === "existing-source")?.verified, true);
  record("Existing administrator verifies the original legacy TV folder");
  await api("/api/library/sources/existing-source/scan", connection.token, {});
  await until("Packaged ffprobe populates the existing video library", async () => {
    const items = (await api("/api/library/items")).items;
    return items.some((item: any) => item.title === "Package video" && item.duration > 10);
  });
  const connect = async () => {
    state = undefined;
    const BunWebSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
    socket = new BunWebSocket(await remoteSocketUrl(origin, previousToken), { headers: { Origin: origin } });
    socket.onmessage = event => { const message = JSON.parse(event.data); if (message.type === "state") state = message.state; else if (message.type === "result") commands.get(message.requestId)?.(message); };
    await until("Existing remote connects to the one native coordinator", async () => state);
  };
  await connect();
  await command({ type: "enqueueLibrary", itemId: (await api("/api/library/items")).items[0].id, entryId: crypto.randomUUID(), playNow: true });
  await until("Installed libmpv plays local video and audio", async () => state.player.status === "playing" && state.player.position > 1 && state.player.tracks?.some((t: any) => t.kind === "video") && state.player.tracks?.some((t: any) => t.kind === "audio"));
  await driver(44444, `/session/${native}/execute/sync`, { script: "Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Show playback')?.click(); return true", args: [] });
  run(["docker", "exec", "-u", "qualifier", "-e", "DISPLAY=:99", container, "ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1280x720", "-i", ":99", "-frames:v", "1", "/evidence/native-playing.png"]);
  await command({ type: "stop" });
  await command({ type: "enqueueWeb", url: "http://127.0.0.1:44212/fixture.html", entryId: crypto.randomUUID(), playNow: true });
  await until("Bundled yt-dlp extracts a webpage and native playback advances", async () => state.player.status === "playing" && state.player.position > 1);
  const toolDir = run(["docker", "exec", container, "sh", "-c", "dirname $(dpkg-query -L couch | grep '/tools/deno$')"]);
  assert.equal(run(["docker", "exec", "-u", "qualifier", container, `${toolDir}/deno`, "eval", "console.log(6 * 7)"]), "42");
  record("Bundled Deno executes without a system JavaScript runtime");
  await command({ type: "stop" });
  browser = (await driver(44445, "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { args: ["--automation"] } } } })).sessionId;
  await driver(44445, `/session/${browser}/url`, { url: origin });
  const execute = (script: string, args: unknown[] = []) => driver(44445, `/session/${browser}/execute/sync`, { script, args });
  await until("Real HTTP remote serves its pairing UI from compiled assets", async () => execute("return !!document.querySelector('#pairing-code') && !window.__TAURI_INTERNALS__"));
  const input = await driver(44445, `/session/${browser}/element`, { using: "css selector", value: "#pairing-code" });
  await driver(44445, `/session/${browser}/element/${input["element-6066-11e4-a52e-4f735466cecf"]}/value`, { text: connection.pairingCode });
  await until("HTTP pairing form enables Connect", async () => execute("return document.querySelector('#pairing-code')?.value.length === 6 && !document.querySelector('.pair-form button')?.disabled"));
  await execute("document.querySelector('#pairing-code').closest('form').requestSubmit()");
  await until("Browser pairs through the production form and renders remote controls", async () => execute("return !!document.querySelector('.remote-controller') && document.querySelector('.header-status [role=status]')?.textContent === 'Connected' && !document.querySelector('.video-stage')"));
  await Bun.write(`${root}/browser-remote.png`, Buffer.from(await driver(44445, `/session/${browser}/screenshot`), "base64"));
  socket!.close();
  await driver(44444, `/session/${native}`, undefined, "DELETE");
  native = "";
  await start();
  await connect();
  assert.equal(state.activeProfile.id, profile.id);
  assert.equal(state.currentEntryId, null);
  assert.equal((await api("/api/library/items")).items.length, 1);
  assert.equal(run(["docker", "exec", container, "cat", "/home/qualifier/legacy-data/keep.txt"]), "Existing user data outside package ownership");
  await Bun.write(`${root}/coordinator-processes.txt`, run(["docker", "exec", container, "ps", "-C", "couch-server", "-o", "pid,ppid,stat,comm"]));
  assert.equal(run(["docker", "exec", container, "sh", "-c", "pgrep -x couch-server | wc -l"]), "1");
  record("Restart preserves profiles, pairings, source, media and custom data without autoplay");
  await Bun.write(`${root}/result.json`, JSON.stringify({ build: expected, packageSha256: new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(artifact).arrayBuffer())).digest("hex"), checks, display: "Xvfb software rendering with PulseAudio null output", upgradeFixture: "Same binary repacked with older Debian version; no prior production release exists" }, null, 2));
} catch (error) {
  const diagnostics = browser ? await driver(44445, `/session/${browser}/execute/sync`, { script: "return { status: document.querySelector('.header-status')?.textContent, alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), codeLength: document.querySelector('#pairing-code')?.value.length, connectDisabled: document.querySelector('.pair-form button')?.disabled }", args: [] }).catch(() => null) : null;
  await Bun.write(`${root}/failure.json`, JSON.stringify({ build: expected, checks, error: String(error), diagnostics }, null, 2));
  if (browser) {
    const masked = await driver(44445, `/session/${browser}/execute/sync`, { script: "const input = document.querySelector('#pairing-code'); if (input) input.type = 'password'; return !input || input.type === 'password'", args: [] }).catch(() => false);
    const screenshot = masked ? await driver(44445, `/session/${browser}/screenshot`).catch(() => null) : null;
    if (screenshot) await Bun.write(`${root}/browser-failure.png`, Buffer.from(screenshot, "base64"));
  }
  throw error;
} finally {
  socket?.close();
  if (browser) await driver(44445, `/session/${browser}`, undefined, "DELETE").catch(() => {});
  if (native) await driver(44444, `/session/${native}`, undefined, "DELETE").catch(() => {});
  await Bun.write(`${root}/container.log`, run(["docker", "logs", container]));
  run(["docker", "rm", "-f", container]);
  await media.stop(true);
}
