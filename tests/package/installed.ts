// Consume a disposable, real systemd appliance. The caller owns installation,
// display/audio, two independent WebKitWebDrivers, and container cleanup.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { openStore } from "../../src/server/store";
import { createLibrary } from "../../src/server/library";
import { remoteSocketUrl } from "../linux/build";

const [mode, directory, container] = process.argv.slice(2);
assert.ok(directory, "Usage: installed.ts --prepare FIXTURES | --verify FIXTURES CONTAINER");
const fixtures = resolve(directory);
if (mode === "--prepare") {
  await mkdir(fixtures, { recursive: true });
  assert.equal(await Bun.file(`${fixtures}/couch.sqlite`).exists(), false, "Use a fresh disposable fixture directory");
  const store = openStore(`${fixtures}/couch.sqlite`);
  const profile = store.createProfile("Installed qualification viewer");
  store.selectProfile(profile.id);
  const tokens = [store.pair("Qualification administrator"), store.pair("Qualification second remote")];
  store.createControllerClaim("installed-qualification", false);
  store.consumeControllerClaim(store.controllerForToken(tokens[0]!)!.id, "installed-qualification");
  store.close();
  await createLibrary({ databasePath: `${fixtures}/couch.sqlite` }).close();
  await Bun.write(`${fixtures}/installed-seed.json`, JSON.stringify({ profileId: profile.id, tokens }));
  await Bun.write(`${fixtures}/keep.txt`, "Data written before installation\n");
  process.exit(0);
}
assert.equal(mode, "--verify");
assert.ok(container, "Supply the disposable systemd container name");
const seed = await Bun.file(`${fixtures}/installed-seed.json`).json();
const origin = "http://127.0.0.1:44100";
const checks: string[] = [];
const browsers: { port: number; id: string }[] = [];
let socket: WebSocket | undefined;
let state: any;
function run(args: string[]) {
  const child = Bun.spawnSync(args, { stderr: "inherit" });
  assert.equal(child.exitCode, 0, args.join(" "));
  return child.stdout.toString().trim();
}
const inside = (...args: string[]) => run(["docker", "exec", container, ...args]);
const uid = inside("id", "-u", "couch-tv");
const service = (...args: string[]) => inside("runuser", "-u", "couch-tv", "--", "env", `XDG_RUNTIME_DIR=/run/user/${uid}`, `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`, "systemctl", "--user", ...args);
async function until(description: string, predicate: () => Promise<unknown>, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, `${description} timed out`);
    await Bun.sleep(200);
  }
  checks.push(description);
  console.log(`PASS ${description}`);
}
async function driver(port: number, path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, JSON.stringify(result));
  return result.value;
}
async function api(path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${seed.tokens[0]}`, Origin: origin, "Content-Type": "application/json" }, signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const execute = (browser: { port: number; id: string }, script: string, args: unknown[] = []) => driver(browser.port, `/session/${browser.id}/execute/sync`, { script, args });
async function connected() {
  for (const browser of browsers) {
    if (!await execute(browser, "return !!document.querySelector('.remote-controller') && document.querySelector('.header-status [role=status]')?.textContent === 'Connected'")) return false;
  }
  return true;
}
function supervised() {
  assert.equal(service("is-active", "couch-tv.service"), "active");
  const cgroup = service("show", "couch-tv.service", "-p", "ControlGroup", "--value");
  assert.ok(cgroup.endsWith("/couch-tv.service"));
  for (const name of ["couch", "couch-server"]) {
    const pids = inside("pgrep", "-u", "couch-tv", "-x", name).split("\n");
    assert.equal(pids.length, 1, `One ${name} process`);
    assert.ok(inside("cat", `/proc/${pids[0]}/cgroup`).includes(cgroup), `${name} belongs to systemd service`);
  }
  assert.ok(inside("env", "DISPLAY=:99", "xdotool", "search", "--onlyvisible", "--class", "^Couch$").length, "Actual native Couch window is visible");
  return service("show", "couch-tv.service", "-p", "MainPID", "--value");
}
async function retained(description: string) {
  socket?.close();
  state = undefined;
  await until("Installed HTTP coordinator is ready", async () => api("/api/build").then(() => true).catch(() => false));
  const BunSocket = WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket };
  socket = new BunSocket(await remoteSocketUrl(origin, seed.tokens[1]), { headers: { Origin: origin } });
  socket.onmessage = event => { const value = JSON.parse(event.data); if (value.type === "state") state = value.state; };
  await until(description, async () => state && await connected());
  assert.equal(state.activeProfile.id, seed.profileId);
  assert.equal(state.currentEntryId, null, "Restart must not autoplay");
  for (const browser of browsers) assert.equal(await execute(browser, "return localStorage.getItem('couch.remote-token')"), seed.tokens[browsers.indexOf(browser)]);
  supervised();
}
const media = Bun.serve({ hostname: "127.0.0.1", port: 44212, fetch: () => new Response(Bun.file(new URL("../fixtures/cue/album.flac", import.meta.url))) });
try {
  await until("Installed HTTP coordinator starts", async () => api("/api/build").then(() => true).catch(() => false));
  const build = await api("/api/build");
  const installed = JSON.parse(inside("cat", "/var/lib/couch/application/build.json"));
  assert.equal(build.version, installed.version);
  assert.equal(build.revision, installed.revision);
  assert.equal(inside("sha256sum", "/var/lib/couch/application/Couch.AppImage").split(" ")[0], installed.archiveSha256);
  const firstPid = supervised();
  for (const [index, port] of [44445, 44447].entries()) {
    const browser = { port, id: (await driver(port, "/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", "webkitgtk:browserOptions": { args: ["--automation"] } } } })).sessionId };
    browsers.push(browser);
    await driver(port, `/session/${browser.id}/url`, { url: origin });
    await execute(browser, "localStorage.setItem('couch.remote-token', arguments[0]); return true", [seed.tokens[index]]);
    await driver(port, `/session/${browser.id}/url`, { url: origin });
  }
  await retained("Two retained browser identities connect to the installed native service");
  socket!.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action: { type: "enqueue", entry: { id: "installed-tone", title: "Installed qualification tone", source: "http://127.0.0.1:44212/album.flac" }, playNow: true } }));
  await until("Installed native player plays before restart", async () => state.player.status === "playing" && state.player.position > 1);
  inside("couch-session", "restart");
  await retained("Systemd restart reconnects both browsers without autoplay");
  assert.notEqual(supervised(), firstPid);
  assert.ok(state.queue.some((entry: any) => entry.id === "installed-tone"), "Restart preserves the queued item");
  assert.deepEqual(await api("/api/build"), build);
  const dataDir = inside("sh", "-c", ". /etc/couch/appliance.env; printf '%s' \"$COUCH_DATA_DIR\"");
  assert.ok(dataDir.startsWith("/"));
  // A disposable operator backup: recovery must retain writes made after it.
  inside("couch-session", "stop");
  inside("sh", "-c", "mkdir -p /var/lib/couch/application/backups/qualification; cp /var/lib/couch/application/Couch.AppImage /var/lib/couch/application/build.json /var/lib/couch/application/backups/qualification/; cd /var/lib/couch/application/backups/qualification; sha256sum Couch.AppImage > SHA256SUMS");
  inside("sh", "-c", 'printf "Newer user write after backup\\n" >> "$1/keep.txt"', "sh", dataDir);
  inside("sh", "-c", 'mkdir -p /var/lib/couch/application/backups/qualification/data; cp -a "$1/." /var/lib/couch/application/backups/qualification/data/', "sh", dataDir);
  service("start", "couch-tv.service");
  await until("Coordinator accepts writes after the backup", async () => api("/api/build").then(() => true).catch(() => false));
  const newer = (await api("/api/profiles", { name: "Created after recovery backup" })).profile;
  inside("couch-session", "stop");
  const retainedData = inside("cat", `${dataDir}/keep.txt`);
  inside("sh", "-c", "printf '#!/bin/sh\\nexit 1\\n' > /var/lib/couch/application/Couch.AppImage");
  inside("couch-recover", "/var/lib/couch/application/backups/qualification");
  await retained("Operator recovery restarts the exact AppImage and reconnects both retained browsers");
  assert.equal(inside("cat", `${dataDir}/keep.txt`), retainedData);
  assert.ok((await api("/api/profiles")).profiles.some((profile: any) => profile.id === newer.id), "Recovery preserves newer database writes");
  assert.deepEqual(await api("/api/build"), build);
  assert.equal(inside("sha256sum", "/var/lib/couch/application/Couch.AppImage").split(" ")[0], installed.archiveSha256);
  await Bun.write(`${fixtures}/installed-result.json`, JSON.stringify({ build, archiveSha256: installed.archiveSha256, checks, display: "Xvfb software rendering; no physical acceptance", scope: "Actual installed AppImage, systemd restart and operator recovery. Signed update and repair require their separate journey." }, null, 2));
} catch (error) {
  await Bun.write(`${fixtures}/installed-failure.json`, JSON.stringify({ checks, error: String(error) }, null, 2));
  throw error;
} finally {
  media.stop(true);
  socket?.close();
  for (const browser of browsers) await driver(browser.port, `/session/${browser.id}`, undefined, "DELETE").catch(() => {});
}
