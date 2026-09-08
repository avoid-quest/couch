import { remoteSocketUrl } from "../linux/build";
import { strict as assert } from "node:assert";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { openStore } from "../../src/server/store";
import { createLibrary } from "../../src/server/library";
import inputs from "../../packaging/inputs.json";

const appimage = process.argv[2]?.endsWith(".AppImage") ?? false;
const root = resolve(appimage ? ".artifacts/appimage-qualification" : ".artifacts/package-qualification", `${Date.now()}-${process.pid}`);
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
assert.ok(artifact, "Supply the exact Debian or AppImage artifact");
if (appimage) await cp(artifact, `${fixtures}/couch.AppImage`);
else {
await cp(artifact, `${fixtures}/couch.deb`);
// An older Debian version of this binary exercises APT upgrade ownership without a second build.
run(["dpkg-deb", "--raw-extract", artifact, `${fixtures}/before`]);
const control = Bun.file(`${fixtures}/before/DEBIAN/control`);
await Bun.write(control, (await control.text()).replace(/^Version:.*$/m, "Version: 0.0.0~qualification"));
run(["dpkg-deb", "--build", "--root-owner-group", `${fixtures}/before`, `${fixtures}/couch-before.deb`]);
await rm(`${fixtures}/before`, { recursive: true });
}
await cp(appimage ? "tests/package/appimage-runtime.sh" : "tests/package/runtime.sh", `${fixtures}/runtime.sh`);
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
// This package fixture represents an already configured installation.
for (const step of ["general", "display", "sound", "sources"]) store.advanceSetup(step);
store.close();
await createLibrary({ databasePath }).close();
const db = new Database(databasePath);
db.query("INSERT INTO library_sources (id, name, path) VALUES (?, ?, ?)").run("existing-source", "Existing media", "/home/qualifier/Videos");
db.close();
await mkdir(`${fixtures}/media`, { recursive: true });
await Bun.write(`${fixtures}/media/sample.srt`, "1\n00:00:00,000 --> 00:00:12,000\nCouch AppImage subtitles\n");
run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-i", `${fixtures}/media/sample.srt`, "-t", "12", "-c:s", "mov_text", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "title=Package video", `${fixtures}/media/sample.mp4`]);
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
  await until(appimage ? "Clean AppImage runtime prepared" : "Clean APT install, upgrade and reinstall complete", async () => {
    const failure = Bun.file(`${root}/runtime-failed`);
    if (await failure.exists()) throw new Error(await failure.text());
    return Bun.file(`${root}/runtime-ready`).exists();
  }, 240_000);
  await until("Official native driver starts", async () => fetch("http://127.0.0.1:44444/status").then(r => r.ok).catch(() => false));
  const start = async () => {
    native = (await driver(44444, "/session", { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: appimage ? "/opt/couch.AppImage" : "/usr/bin/couch" } } } })).sessionId;
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
    await until("Native player is ready before playback commands", async () => state.player.status === "idle");
  };
  await connect();
  await command({ type: "enqueueLibrary", itemId: (await api("/api/library/items")).items[0].id, entryId: crypto.randomUUID(), playNow: true });
  await until("Installed libmpv plays local video and audio", async () => state.player.status === "playing" && state.player.position > 1 && state.player.tracks?.some((t: any) => t.kind === "video") && state.player.tracks?.some((t: any) => t.kind === "audio"));
  await driver(44444, `/session/${native}/execute/sync`, { script: "Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Show playback')?.click(); return true", args: [] });
  run(["docker", "exec", "-u", "qualifier", "-e", "DISPLAY=:99", container, "ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1280x720", "-i", ":99", "-frames:v", "1", "/evidence/native-playing.png"]);
  await command({ type: "pause", playbackId: state.player.playbackId, paused: true });
  await until("Native video pauses for subtitle comparison", async () => state.player.status === "paused");
  await driver(44444, `/session/${native}/execute/sync`, { script: "Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label') === 'Hide playback controls')?.click(); return true", args: [] });
  await until("Playback overlay is hidden for subtitle capture", async () => driver(44444, `/session/${native}/execute/sync`, { script: "return !!document.querySelector('.tv-browser[hidden]') && !!document.querySelector('.tv-playback-controls[hidden]')", args: [] }));
  const subtitle = state.player.tracks.find((track: any) => track.kind === "subtitle");
  assert.ok(subtitle, "Packaged libmpv discovers the embedded subtitle");
  const frame = (name: string) => {
    run(["docker", "exec", "-u", "qualifier", "-e", "DISPLAY=:99", container, "ffmpeg", "-v", "error", "-y", "-f", "x11grab", "-video_size", "1280x720", "-i", ":99", "-frames:v", "1", `/evidence/${name}.png`]);
    const decoded = Bun.spawnSync(["ffmpeg", "-v", "error", "-i", `${root}/${name}.png`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 4_000_000 });
    assert.equal(decoded.exitCode, 0);
    return decoded.stdout;
  };
  await command({ type: "track", playbackId: state.player.playbackId, kind: "subtitle", index: -1 });
  await until("Subtitles turn off", async () => !state.player.tracks.some((track: any) => track.kind === "subtitle" && track.selected));
  // Track acknowledgement can precede the next native frame. Wait for settled pixels.
  await Bun.sleep(350);
  let without = frame("subtitles-off");
  await until("Subtitle-off frame settles", async () => {
    const next = frame("subtitles-off");
    const stable = next.equals(without);
    without = next;
    return stable;
  });
  const stage = await driver(44444, `/session/${native}/execute/sync`, { script: "const r = document.querySelector('.video-stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }", args: [] });
  const scale = Math.min(stage.width / 640, stage.height / 360);
  const width = Math.floor(640 * scale), height = Math.floor(360 * scale);
  const left = Math.round(stage.x + (stage.width - width) / 2), top = Math.round(stage.y + (stage.height - height) / 2);
  assert.ok(left >= 0 && top >= 0 && left + width <= 1280 && top + height <= 720, "Subtitle sample lies in the fullscreen native video");
  await command({ type: "track", playbackId: state.player.playbackId, kind: "subtitle", index: subtitle.index });
  await until("Subtitles turn on", async () => state.player.tracks.some((track: any) => track.kind === "subtitle" && track.selected));
  await until("Native subtitle glyphs render over paused video", async () => {
    const withSubtitles = frame("subtitles-on");
    let brightChanges = 0, upperChanges = 0;
    for (let y = Math.ceil(height * 0.1); y < height * 0.97; y++) for (let x = Math.ceil(width * 0.05); x < width * 0.95; x++) {
      const offset = ((top + y) * 1280 + left + x) * 3;
      const changed = [0, 1, 2].some(channel => Math.abs(withSubtitles[offset + channel]! - without[offset + channel]!) > 35);
      if (changed && y < height * 0.5) upperChanges++;
      if (changed && y > height * 0.55 && Math.max(withSubtitles[offset]!, withSubtitles[offset + 1]!, withSubtitles[offset + 2]!) > 180) brightChanges++;
    }
    return brightChanges >= 80 && upperChanges < width * height * 0.001;
  });
  await command({ type: "stop" });
  await command({ type: "enqueueWeb", url: "http://127.0.0.1:44212/fixture.html", entryId: crypto.randomUUID(), playNow: true });
  await until("Bundled yt-dlp extracts a webpage and native playback advances", async () => state.player.status === "playing" && state.player.position > 1);
  const toolDir = appimage ? "/opt/squashfs-root/usr/lib/Couch/tools" : run(["docker", "exec", container, "sh", "-c", "dirname $(dpkg-query -L couch | grep '/tools/deno$')"]);
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
  // WebDriver deletes only the AppImage launcher; close the actual window to drain the sidecar.
  run(["docker", "exec", "-e", "DISPLAY=:99", container, "sh", "-c", "xdotool search --onlyvisible --class '^Couch$' windowactivate --sync && xdotool key alt+F4"]);
  await until("Native app and coordinator exit before restart", async () => run(["docker", "exec", container, "sh", "-c", "pgrep -x 'couch|couch-server' | wc -l"]) === "0");
  await driver(44444, `/session/${native}`, undefined, "DELETE");
  native = "";
  await start();
  await connect();
  await until("Paired browser reconnects after native restart", async () => execute("return !!document.querySelector('.remote-controller') && document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  assert.equal(state.activeProfile.id, profile.id);
  assert.equal(state.currentEntryId, null);
  assert.equal((await api("/api/library/items")).items.length, 1);
  assert.equal(run(["docker", "exec", container, "cat", "/home/qualifier/legacy-data/keep.txt"]), "Existing user data outside package ownership");
  await Bun.write(`${root}/coordinator-processes.txt`, run(["docker", "exec", container, "ps", "-C", "couch-server", "-o", "pid,ppid,stat,comm"]));
  assert.equal(run(["docker", "exec", container, "sh", "-c", "pgrep -x couch-server | wc -l"]), "1");
  record("Restart preserves profiles, pairings, source, media and custom data without autoplay");
  await Bun.write(`${root}/result.json`, JSON.stringify({ build: expected, packageSha256: new Bun.CryptoHasher("sha256").update(new Uint8Array(await Bun.file(artifact).arrayBuffer())).digest("hex"), checks, display: "Xvfb software rendering with PulseAudio null output", format: appimage ? "AppImage" : "deb", upgradeFixture: appimage ? null : "Same binary repacked with older Debian version; no prior production release exists" }, null, 2));
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
