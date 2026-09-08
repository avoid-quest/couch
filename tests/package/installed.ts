// Consume a disposable, real systemd appliance. The caller owns installation,
// display/audio, two independent WebKitWebDrivers, and container cleanup.
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { openStore } from "../../src/server/store";
import { createLibrary } from "../../src/server/library";
import { remoteSocketUrl } from "../linux/build";
import { UiDriver } from "../linux/ui";

const [mode, directory, container] = process.argv.slice(2);
assert.ok(directory, "Usage: installed.ts --prepare FIXTURES | --verify FIXTURES CONTAINER");
const fixtures = resolve(directory);
if (mode === "--prepare") {
  await mkdir(fixtures, { recursive: true });
  assert.equal(await Bun.file(`${fixtures}/couch.sqlite`).exists(), false, "Use a fresh disposable fixture directory");
  const store = openStore(`${fixtures}/couch.sqlite`);
  const profile = store.createProfile("Installed qualification viewer");
  store.selectProfile(profile.id);
  store.saveProfilePreferences(profile.id, { audioLanguage: "it", subtitleLanguage: "en", subtitles: "off", speed: 1, replayGain: "off" });
  store.saveProgress(profile.id, { mediaId: "qualification:retained", title: "Retained progress", libraryItemId: null, position: 37, duration: 120, watched: false, lastPlayedAt: 1 });
  const tokens = [store.pair("Qualification administrator"), store.pair("Qualification second remote")];
  store.createControllerClaim("installed-qualification", false);
  store.consumeControllerClaim(store.controllerForToken(tokens[0]!)!.id, "installed-qualification");
  // This package fixture represents an already configured installation.
  for (const step of ["general", "display", "sound", "sources"]) store.advanceSetup(step);
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
const faultChecks: string[] = [];
let damagedTools: string | undefined;
// FUSE admits its owner, even when root cannot traverse the bundle. Give only
// this disposable mount command the owner's credentials and mount capability.
const mountAsOwner = (...args: string[]) => inside("setpriv", "--reuid=couch-tv", "--regid=couch-tv", "--clear-groups", "--inh-caps=-all,+sys_admin", "--ambient-caps=-all,+sys_admin", "--no-new-privs", ...args);
function clearDamagedTools() {
  if (damagedTools && inside("findmnt", "--kernel", "--noheadings", "--raw", "--output", "TARGET").split("\n").includes(damagedTools)) mountAsOwner("umount", damagedTools);
  damagedTools = undefined;
}
const bundledTools = () => {
  const pid = inside("pgrep", "-u", "couch-tv", "-x", "couch-server");
  const directory = inside("cat", `/proc/${pid}/environ`).split("\0").find(value => value.startsWith("COUCH_BUNDLED_TOOLS="))?.slice("COUCH_BUNDLED_TOOLS=".length);
  assert.ok(typeof directory === "string" && directory.startsWith("/tmp/.mount_") && directory.endsWith("/tools"), "Fault only the current disposable AppImage's actual bundled tools");
  return directory;
};
const recoveryFaults = process.env.COUCH_QUALIFY_RECOVERY_FAULTS === "1";
const idleScenario = process.env.COUCH_QUALIFY_IDLE_SCENARIO ?? "";
assert.ok(["", "success", "failure"].includes(idleScenario));
const dataDir = inside("sh", "-c", ". /etc/couch/appliance.env; printf '%s' \"$COUCH_DATA_DIR\"");
assert.ok(dataDir.startsWith("/"));
const sql = (statement: string) => inside("sqlite3", `${dataDir}/couch.sqlite`, statement);
function preservation(devices: "devices" | "qualification_current_devices" = "devices") {
  // lastSeenAt and scan status change during normal reconnect. Compare the
  // authoritative identities/settings, not those incidental timestamps.
  return sql(`SELECT token_hash,id,name,role FROM ${devices} ORDER BY id; SELECT id,name,path FROM library_sources ORDER BY id; SELECT * FROM watching_preferences ORDER BY profileId; SELECT * FROM viewing_progress ORDER BY profileId,mediaId; SELECT * FROM session; SELECT * FROM watching_profiles ORDER BY id;`);
}
function rejected(...args: string[]) {
  const child = Bun.spawnSync(["docker", "exec", container, ...args]);
  assert.notEqual(child.exitCode, 0, "Injected fault must reject the operation");
  return child.stderr.toString();
}
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
async function settingsUi(browser: { port: number; id: string }, section: string) {
  const ui = new UiDriver((path, body, method) => driver(browser.port, path, body, method), () => browser.id);
  if (!await execute(browser, 'return !!document.querySelector(\'[role="dialog"] [aria-label="Settings sections"]\')')) {
    await ui.browse();
    await ui.button("Settings");
  }
  await ui.settingsSection(section);
  return ui;
}
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
let importGate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let importStarted = false;
const media = Bun.serve({ hostname: "127.0.0.1", port: 44212, async fetch(request) {
  if (new URL(request.url).pathname === "/idle.m3u") {
    importStarted = true;
    await importGate?.promise;
    return new Response("#EXTM3U\n#EXTINF:-1,Idle qualification\nhttp://127.0.0.1:44212/album.flac\n");
  }
  return new Response(Bun.file(new URL("../fixtures/cue/album.flac", import.meta.url)));
} });
try {
  await until("Installed HTTP coordinator starts", async () => api("/api/build").then(() => true).catch(() => false));
  let build = await api("/api/build");
  const initialBuild = build;
  const transactions: unknown[] = [];
  let installed = JSON.parse(inside("cat", "/var/lib/couch/application/build.json"));
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
  if (recoveryFaults) {
    inside("apt-get", "install", "-y", "--no-install-recommends", "sqlite3");
    inside("mkdir", "-p", "/media/couch-retained");
    await api("/api/library/sources", { path: "/media/couch-retained" });
  }
  socket!.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action: { type: "enqueue", entry: { id: "installed-tone", title: "Installed qualification tone", source: "http://127.0.0.1:44212/album.flac" }, playNow: true } }));
  await until("Installed native player plays before restart", async () => state.player.status === "playing" && state.player.position > 1);
  inside("couch-session", "restart");
  await retained("Systemd restart reconnects both browsers without autoplay");
  assert.notEqual(supervised(), firstPid);
  assert.ok(state.queue.some((entry: any) => entry.id === "installed-tone"), "Restart preserves the queued item");
  assert.deepEqual(await api("/api/build"), build);
  // Optional newer-baseline journey. The signed A/B runner may deliberately use
  // an older A without General restart, so this must be explicitly requested.
  if (process.env.COUCH_QUALIFY_GENERAL_RESTART === "1") {
    inside("apt-get", "install", "-y", "--no-install-recommends", "sqlite3");
    inside("mkdir", "-p", "/media/couch-restart");
    inside("ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "120", "/media/couch-restart/Restart.flac");
    const { sources } = await api("/api/library/sources", { path: "/media/couch-restart" });
    const source = sources.find((source: any) => source.path === "/media/couch-restart");
    assert.ok(source, "The generated media folder was registered");
    await api(`/api/library/sources/${source.id}/scan`, {});
    let local: any;
    await until("Installed folder scan indexes resumable local media", async () => {
      local = (await api("/api/library/items?q=Restart")).items[0];
      return local;
    });
    const command = (action: unknown) => socket!.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action }));
    command({ type: "enqueueLibrary", itemId: local.id, entryId: "installed-restart-local", playNow: true });
    await until("Indexed local playback has dirty progress between periodic writes", async () => state.currentEntryId === "installed-restart-local" && state.player.status === "playing" && state.player.position > 3 && state.player.position < 9);
    const dataDir = inside("sh", "-c", ". /etc/couch/appliance.env; printf '%s' \"$COUCH_DATA_DIR\"");
    const sql = (statement: string) => inside("sqlite3", `${dataDir}/couch.sqlite`, statement);
    const stored = () => Number(sql("SELECT printf('%!.26g', position) FROM viewing_progress WHERE profileId='" + seed.profileId + "' AND mediaId='library:" + local.id + "';"));
    const before = stored();
    assert.ok(state.player.position > before + 1, "The observed position is newer than its periodic save");
    const beforePid = supervised();
    sql("CREATE TRIGGER reject_restart_checkpoint BEFORE INSERT ON viewing_progress BEGIN SELECT RAISE(FAIL, 'qualification checkpoint failure'); END;");
    const rejected = await fetch(`${origin}/api/settings/restart`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[0]}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ confirmInterrupt: true }) });
    assert.equal(rejected.status, 409);
    assert.match((await rejected.json()).error, /Could not save viewing progress/);
    assert.equal((await api("/api/controllers/me")).authority, "administrator");
    assert.equal(supervised(), beforePid, "Failed checkpoint does not retire HTTP or the native owner");
    sql("DROP TRIGGER reject_restart_checkpoint;");
    // Exercise the administrator's actual General confirmation, not an SSH restart.
    const admin = browsers[0]!;
    const ui = await settingsUi(admin, "general");
    await ui.button("Restart Couch");
    await until("Administrator opens restart confirmation", async () => execute(admin, "return [...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent.trim() === 'Confirm restart')"));
    let observed = 0, beforeRestart = 0;
    await until("Restart confirmation has unsaved native progress", async () => {
      beforeRestart = stored(); observed = state.player.position;
      return observed > beforeRestart + 1;
    });
    await ui.button("Confirm restart");
    const savedPreferences = state.preferences;
    await until("General restart replaces the native systemd owner", async () => service("show", "couch-tv.service", "-p", "MainPID", "--value") !== beforePid && service("show", "couch-tv.service", "-p", "MainPID", "--value") !== "0");
    await retained("Administrator restart retains both browser identities without autoplay");
    assert.deepEqual(state.preferences, savedPreferences);
    assert.ok(state.queue.some((entry: any) => entry.id === "installed-restart-local"));
    const saved = stored();
    await Bun.write(`${fixtures}/restart-progress.json`, JSON.stringify({ before, beforeRestart, observed, saved }));
    assert.ok(saved >= observed, `Restart saves the latest dirty native position: ${saved} >= ${observed}`);
    await until("General reports confirmed coordinator replacement", async () => execute(admin, "return document.body.textContent.includes('Couch restarted. Playback is stopped.')"));
    // systemd does not expose its current start-limit counter to the app. Prove
    // an exhausted budget fails honestly and operator recovery retains data.
    const dropin = "/etc/systemd/user/couch-tv.service.d/qualification-restart-limit.conf";
    inside("sh", "-c", 'printf "[Unit]\\nStartLimitIntervalSec=600\\nStartLimitBurst=1\\n" > "$1"', "sh", dropin);
    service("daemon-reload");
    service("reset-failed", "couch-tv.service");
    service("restart", "couch-tv.service");
    await retained("One start consumes the disposable supervisor restart budget");
    await settingsUi(admin, "general");
    await ui.button("Restart Couch");
    await until("Administrator requests restart with the exhausted budget", async () => execute(admin, "return [...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent.trim() === 'Confirm restart')"));
    await ui.button("Confirm restart");
    await until("Systemd truthfully reports start-limit-hit", async () => service("show", "couch-tv.service", "-p", "Result", "--value") === "start-limit-hit");
    await until("General reports missing reconnect and SSH recovery", async () => execute(admin, "return document.body.textContent.includes('Couch did not reconnect.')"), 75_000);
    inside("rm", dropin);
    service("daemon-reload");
    service("reset-failed", "couch-tv.service");
    service("start", "couch-tv.service");
    await retained("Operator recovery after exhausted restart budget retains paired browsers");
    assert.ok(stored() >= observed);
    assert.ok(state.queue.some((entry: any) => entry.id === "installed-restart-local"));
  }
  // Optional signed journey. The caller supplies a verified B receipt and enrolls
  // its signed feed; this consumer never publishes or chooses an archive URL.
  const updateReceipt = process.env.COUCH_QUALIFY_UPDATE_RECEIPT;
  if (updateReceipt) {
    const expected = await Bun.file(updateReceipt).json();
    assert.ok(typeof expected.version === "string" && /^[a-f0-9]{40}$/.test(expected.revision));
    assert.ok(/^[a-f0-9]{64}$/.test(expected.archiveSha256));
    assert.notEqual(expected.version, build.version, "A and B must be different qualified builds");
    await until("Updater completes its initial check", async () => !["checking", "downloading"].includes((await api("/api/updates")).status));
    await api("/api/updates/policy", { policy: "manual" });
    await api("/api/updates/channel", { channel: "preview" });
    let update: any;
    await until("Signed B candidate is available", async () => {
      update = await api("/api/updates");
      assert.notEqual(update.status, "failed", update.error);
      return update.currentCheck && ["available", "ready"].includes(update.status);
    });
    assert.equal(update.candidate.version, expected.version);
    assert.equal(update.candidate.revision, expected.revision);
    const candidate = update.candidate;
    if (recoveryFaults) {
      const expectedData = preservation();
      const pid = supervised();
      for (const fault of ["offline", "bad-signature", "interrupted-download"]) {
        await Bun.write(`${fixtures}/feed-fault`, fault);
        try {
          await api(fault === "interrupted-download" ? "/api/updates/stage" : "/api/updates/check", fault === "interrupted-download" ? { candidateId: candidate.id } : { check: true });
          await until(`Installed updater reports ${fault} as failed`, async () => (await api("/api/updates")).status === "failed");
          assert.equal(supervised(), pid, "Failed staging preserves the running native owner");
          assert.equal(preservation(), expectedData);
          assert.deepEqual(await api("/api/build"), build);
          faultChecks.push(`${fault}: failed staging retains credentials, sources, preferences, queue and progress`);
        } finally { await Bun.write(`${fixtures}/feed-fault`, ""); }
        await api("/api/updates/check", { check: true });
        await until("Restored signed feed offers the same candidate", async () => {
          const value = await api("/api/updates");
          return value.status === "available" && value.candidate.id === candidate.id;
        });
      }
    }
    await api("/api/updates/stage", { candidateId: candidate.id });
    await until("Signed B download reports its complete byte count", async () => {
      update = await api("/api/updates");
      assert.notEqual(update.status, "failed", update.error);
      return update.status === "ready";
    }, 30 * 60_000);
    assert.deepEqual(update.progress, { received: candidate.bytes, total: candidate.bytes });
    if (recoveryFaults) {
      inside("apt-get", "install", "-y", "--no-install-recommends", "strace");
      const expectedData = preservation();
      const pid = inside("pgrep", "-u", "couch-tv", "-x", "couch");
      const requestId = crypto.randomUUID().replaceAll("-", "");
      // Delay the real rename's return after the kernel moved the old AppImage,
      // then kill the updater before it can write the replacement. No file or
      // journal is fabricated, and the signed artifacts remain unchanged.
      const trace = Bun.spawn(["docker", "exec", container, "strace", "-f", "-p", pid, "-o", "/qualification/interrupted-install.strace", "-P", "/var/lib/couch/application/Couch.AppImage", "-e", "trace=rename,renameat,renameat2", "-e", "inject=rename,renameat,renameat2:delay_exit=30s"], { stdout: "ignore", stderr: "ignore" });
      try {
        await until("Debugger attaches to the installed native updater", async () => {
          assert.equal(trace.exitCode, null, "strace must remain attached");
          return /TracerPid:\s+[1-9]/.test(inside("cat", `/proc/${pid}/status`));
        });
        await api("/api/updates/install", { install: { candidateId: candidate.id, requestId, confirmInterrupt: false } });
        await until("Real Tauri replacement moves the current AppImage away", async () => inside("sh", "-c", "test -e /var/lib/couch/application/Couch.AppImage && echo present || echo absent") === "absent");
        assert.equal(JSON.parse(inside("cat", `${dataDir}/updates/appimage/requests/${requestId}.json`)).phase, "installing");
        inside("pkill", "-KILL", "-u", "couch-tv", "-x", "couch");
        inside("couch-session", "stop");
      } finally {
        trace.kill();
        await trace.exited;
      }
      assert.equal(preservation(), expectedData);
      inside("couch-recover", `/var/lib/couch/application/backups/${requestId}`);
      await retained("Recovery restores the previous AppImage after actual Tauri replacement interruption");
      assert.equal(preservation(), expectedData);
      assert.deepEqual(await api("/api/build"), build);
      const interrupted = (await api(`/api/updates?requestId=${requestId}`)).installation.requestedTransaction;
      assert.equal(interrupted.phase, "operator-required");
      assert.match(interrupted.error, /interrupted/);
      faultChecks.push("Real interrupted Tauri replacement preserves data and reports operator-required after previous-build recovery");
      await api("/api/updates/check", { check: true });
      await until("Signed candidate is available after interrupted installation", async () => {
        const value = await api("/api/updates");
        return ["available", "ready"].includes(value.status) && value.candidate.id === candidate.id;
      });
      await api("/api/updates/stage", { candidateId: candidate.id });
      await until("Interrupted candidate can be staged again", async () => (await api("/api/updates")).status === "ready");
    }
    let automaticRequest: string | undefined;
    let automaticPid: string | undefined;
    if (idleScenario) {
      inside("apt-get", "install", "-y", "--no-install-recommends", "sqlite3");
      const samples: unknown[] = [];
      const sample = async (event: string, detail: unknown) => {
        samples.push({ at: new Date().toISOString(), event, detail });
        await Bun.write(`${fixtures}/idle-update.json`, JSON.stringify({ scenario: idleScenario, clock: "Real elapsed monotonic time; production five-minute interval is unchanged", samples }, null, 2));
      };
      const currentUpdate = () => api("/api/updates");
      const waiting = async (text: string) => until(`Idle policy reports ${text}`, async () => (await currentUpdate()).waiting?.includes(text), 8_000);
      const command = (action: unknown) => socket!.send(JSON.stringify({ type: "command", requestId: crypto.randomUUID(), action }));
      const originalPid = supervised();
      assert.equal((await currentUpdate()).policy, "manual");
      const denied = await fetch(`${origin}/api/updates/policy`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[1]}`, Origin: origin, "Content-Type": "application/json" }, body: '{"policy":"idle"}' });
      assert.equal(denied.status, 403, "The second controller cannot change installation policy");
      await api("/api/updates/policy", { policy: "idle" });
      command({ type: "play", entryId: "installed-tone", fromStart: true });
      await until("Idle qualification has actual native playback", async () => state.player.status === "playing" && state.player.position > 1);
      await waiting("playback to stop");
      const position = state.player.position;
      await Bun.write(`${fixtures}/feed-fault`, "offline");
      try {
        await api("/api/updates/check", { check: true });
        await until("Offline automatic-policy check reports failure during playback", async () => (await currentUpdate()).status === "failed");
        await until("Offline check leaves native playback advancing", async () => state.player.status === "playing" && state.player.position > position + 1);
        assert.equal(supervised(), originalPid);
        assert.equal((await currentUpdate()).installation.transaction, null);
      } finally { await Bun.write(`${fixtures}/feed-fault`, ""); }
      await api("/api/updates/check", { check: true });
      await until("Restored feed reuses the exact verified candidate", async () => {
        const value = await currentUpdate();
        return value.status === "ready" && value.candidate.id === candidate.id;
      });
      command({ type: "pause", playbackId: state.player.playbackId, paused: true });
      await until("Native paused playback remains active for idle updates", async () => state.player.status === "paused");
      await waiting("Paused playback is still active");
      command({ type: "stop" });
      await until("Native playback stops before idle qualification", async () => state.player.status === "idle");
      inside("mkdir", "-p", "/media/couch-idle-retained");
      await api("/api/library/sources", { path: "/media/couch-idle-retained" });
      importGate = Promise.withResolvers<void>();
      const importing = api("/api/radio/playlists", { name: "Idle background import", url: "http://127.0.0.1:44212/idle.m3u" });
      try {
        await until("Real radio import waits on its upstream response", async () => importStarted, 2_000);
        await waiting("settings, scan or import request");
        assert.equal((await currentUpdate()).installation.transaction, null);
      } finally { importGate.resolve(); }
      await importing;
      await waiting("five continuous idle minutes");
      const admin = browsers[0]!;
      await settingsUi(admin, "updates");
      await until("Administrator opens Updates during the idle wait", async () => execute(admin, 'return document.querySelector(\'[role="tab"][id$="-trigger-updates"]\')?.getAttribute("aria-selected") === "true"'));
      await until("Updates explains the active idle policy", async () => execute(admin, "return document.body.textContent.includes('five continuous idle minutes')"));
      for (const browser of browsers) {
        await until("Idle countdown advances without a controller heartbeat", async () => {
          const value = await currentUpdate();
          const remaining = / (\d+) seconds remaining\./.exec(value.waiting ?? "");
          return remaining && Number(remaining[1]) <= 285;
        }, 25_000);
        const before = (await currentUpdate()).waiting;
        await driver(browser.port, `/session/${browser.id}/actions`, { actions: [{ type: "key", id: "idle-activity", actions: [{ type: "keyDown", value: "\uE008" }, { type: "keyUp", value: "\uE008" }] }] });
        await until("Independent browser input restarts the five-minute countdown", async () => {
          const value = await currentUpdate();
          const remaining = / (\d+) seconds remaining\./.exec(value.waiting ?? "");
          return remaining && Number(remaining[1]) >= 290;
        }, 8_000);
        await sample("remote activity reset", { remote: browsers.indexOf(browser) + 1, before, after: (await currentUpdate()).waiting });
      }
      const dropin = "/etc/systemd/user/couch-tv.service.d/qualification-idle-failure.conf";
      if (idleScenario === "failure") {
        // Fail the next real service startup after Tauri installs B. The current
        // A continues normally until the unchanged idle gate closes admission.
        inside("sh", "-c", 'printf "[Service]\\nExecStartPre=/usr/bin/false\\n" > "$1"', "sh", dropin);
        service("daemon-reload");
      }
      const started = performance.now();
      const activity = await fetch(`${origin}/api/activity`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[1]}`, Origin: origin, "Content-Type": "application/json" }, body: '{"activity":true}' });
      assert.equal(activity.status, 204);
      let requestId: string | undefined;
      let nextSample = 0;
      await until("Actual five-minute idle interval admits the signed update", async () => {
        const elapsed = performance.now() - started;
        const settings = JSON.parse(inside("cat", `${dataDir}/updates/settings.json`));
        if (settings.attempt) {
          assert.ok(elapsed >= 300_000, `No early automatic attempt: ${elapsed}ms`);
          requestId = settings.attempt.requestId;
          assert.equal(settings.attempt.candidateId, candidate.id);
          await sample("automatic admission", { elapsedMs: elapsed, requestId, candidateId: candidate.id });
          return true;
        }
        assert.equal(service("show", "couch-tv.service", "-p", "MainPID", "--value"), originalPid);
        if (elapsed >= nextSample) {
          await sample("waiting", { elapsedMs: elapsed, waiting: (await currentUpdate()).waiting });
          nextSample += 60_000;
        }
        return false;
      }, 330_000);
      assert.ok(requestId);
      if (idleScenario === "failure") {
        const expectedData = preservation();
        await until("Unattended candidate startup exhausts the real systemd restart budget", async () => service("show", "couch-tv.service", "-p", "Result", "--value") === "start-limit-hit");
        const failed = JSON.parse(inside("cat", `${dataDir}/updates/appimage/requests/${requestId}.json`));
        assert.equal(failed.phase, "trial", "The real signed replacement reached startup trial");
        assert.equal(inside("sha256sum", "/var/lib/couch/application/Couch.AppImage").split(" ")[0], expected.archiveSha256);
        inside("rm", dropin);
        service("daemon-reload");
        inside("couch-recover", `/var/lib/couch/application/backups/${requestId}`);
        await retained("Operator recovery from failed unattended startup reconnects both remotes on A");
        assert.equal(preservation(), expectedData);
        assert.deepEqual(await api("/api/build"), build);
        const result = (await api(`/api/updates?requestId=${requestId}`)).installation.requestedTransaction;
        assert.equal(result.phase, "operator-required");
        await until("Remote displays the failed unattended outcome", async () => execute(admin, "return document.body.textContent.includes('Update needs SSH recovery')"));
        const newer = (await api("/api/profiles", { name: "After unattended recovery" })).profile;
        const recoveredPid = supervised();
        await api("/api/updates/check", { check: true });
        await waiting("already had an automatic attempt");
        const recoveredAt = performance.now();
        await until("Recovered failed candidate does not loop after another actual five idle minutes", async () => {
          const value = await currentUpdate();
          assert.equal(value.policy, "idle");
          assert.equal(value.installation.transaction.requestId, requestId);
          assert.equal(value.installation.transaction.phase, "operator-required");
          assert.equal(service("show", "couch-tv.service", "-p", "MainPID", "--value"), recoveredPid);
          return performance.now() - recoveredAt >= 305_000;
        }, 320_000);
        assert.ok((await api("/api/profiles")).profiles.some((profile: any) => profile.id === newer.id));
        await sample("failed candidate remains suppressed after operator recovery", { elapsedMs: performance.now() - recoveredAt, transaction: result });
        await api("/api/updates/policy", { policy: "manual" });
      } else { automaticRequest = requestId; automaticPid = originalPid; }
    }
    for (const repair of [false, true]) {
      if (repair) inside("apt-get", "install", "-y", "--no-install-recommends", "sqlite3");
      const beforePid = !repair && automaticPid ? automaticPid : supervised();
      const requestId = !repair && automaticRequest ? automaticRequest : crypto.randomUUID().replaceAll("-", "");
      const current = repair ? (await api("/api/updates")).installation.current : null;
      const beforeRepairData = repair ? preservation() : null;
      let damagedHealth: any;
      const body = repair
        ? { repair: { expectedCurrentId: current.candidateId, requestId, confirmInterrupt: false, repairRuntime: false } }
        : { install: { candidateId: candidate.id, requestId, confirmInterrupt: false } };
      if (repair) {
        const tools = bundledTools();
        // The signed archive and its read-only FUSE files remain intact. Replace
        // the running bundle's actual tools view, not a health response or override.
        inside("install", "-d", "-o", "couch-tv", "-g", "couch-tv", "-m", "700", "/fixture/damaged-tools");
        inside("runuser", "-u", "couch-tv", "--", "cp", "-R", `${tools}/.`, "/fixture/damaged-tools");
        inside("runuser", "-u", "couch-tv", "--", "rm", "/fixture/damaged-tools/yt-dlp");
        inside("runuser", "-u", "couch-tv", "--", "sh", "-c", "printf '#!/bin/sh\\ntouch /tmp/couch-corrupt-deno-executed\\n' > /fixture/damaged-tools/deno");
        mountAsOwner("mount", "--bind", "/fixture/damaged-tools", tools);
        damagedTools = tools;
        await until("Installed Tools detects missing yt-dlp and corrupt Deno without executing them", async () => {
          damagedHealth = await api("/api/tools");
          return damagedHealth.tools.find((tool: any) => tool.name === "yt-dlp")?.installed.status === "missing"
            && damagedHealth.tools.find((tool: any) => tool.name === "Deno")?.installed.status === "corrupt";
        });
        for (const tool of damagedHealth.tools) assert.ok(tool.expectedVersion);
        assert.equal(damagedHealth.ffprobe.status, "ready");
        inside("test", "!", "-e", "/tmp/couch-corrupt-deno-executed");
        for (const path of ["/api/tools", "/api/updates/repair"]) {
          const denied = await fetch(`${origin}${path}`, { method: path.endsWith("repair") ? "POST" : "GET", headers: { Authorization: `Bearer ${seed.tokens[1]}`, Origin: origin, "Content-Type": "application/json" }, body: path.endsWith("repair") ? JSON.stringify(body) : undefined });
          assert.equal(denied.status, 403, "A retained nonadministrator cannot inspect tools or repair the release");
        }
        await Bun.write(`${fixtures}/helper-repair-before.json`, JSON.stringify({ tools, health: damagedHealth, scope: "Real mounted bundle view with missing yt-dlp and corrupt Deno; signed archive bytes unchanged." }, null, 2));
      }
      if (repair || !automaticRequest) {
        const accepted = await api(repair ? "/api/updates/repair" : "/api/updates/install", body);
        assert.equal(accepted.transaction.requestId, requestId);
      }
      let transaction: any;
      await until(repair ? "Exact-current repair commits" : "Signed A to B installation commits", async () => {
        // Expected coordinator downtime must not hide a reported transaction failure.
        const response = await api(`/api/updates?requestId=${requestId}`).catch(() => null);
        transaction = response?.installation.requestedTransaction;
        if (!transaction) return false;
        assert.ok(!["failed", "operator-required"].includes(transaction.phase), JSON.stringify(transaction));
        return transaction.phase === "succeeded";
      }, 30 * 60_000);
      assert.equal(transaction.version, expected.version);
      assert.equal(transaction.revision, expected.revision);
      assert.equal(transaction.intent, repair ? "repair-current" : "install");
      transactions.push(transaction);
      if (repair) assert.deepEqual(transaction.progress, { received: candidate.bytes, total: candidate.bytes });
      await retained(repair ? "Exact-current repair reconnects both retained browsers without autoplay" : "Signed update reconnects both retained browsers without autoplay");
      assert.notEqual(supervised(), beforePid, "Systemd replaced the native owner");
      build = await api("/api/build");
      installed = JSON.parse(inside("cat", "/var/lib/couch/application/build.json"));
      assert.equal(build.version, expected.version);
      assert.equal(build.revision, expected.revision);
      assert.equal(installed.version, expected.version);
      assert.equal(installed.revision, expected.revision);
      assert.equal(installed.archiveSha256, expected.archiveSha256);
      assert.equal(inside("sha256sum", "/var/lib/couch/application/Couch.AppImage").split(" ")[0], expected.archiveSha256);
      assert.ok(state.queue.some((entry: any) => entry.id === "installed-tone"));
      assert.equal((await api("/api/updates")).policy, automaticRequest ? "idle" : "manual");
      assert.equal((await api("/api/updates")).channel, "preview");
      if (repair) {
        const tools = bundledTools();
        assert.notEqual(tools, damagedTools, "Repair starts the genuine tools in a fresh AppImage mount");
        assert.equal(preservation(), beforeRepairData);
        const health = await api("/api/tools");
        assert.deepEqual(health.tools.map((tool: any) => tool.name), damagedHealth.tools.map((tool: any) => tool.name));
        for (const tool of health.tools) {
          assert.equal(tool.installed.status, "ready");
          assert.equal(tool.installed.version, tool.expectedVersion);
          assert.equal(tool.effective.source, "package");
          assert.equal(tool.effective.status, "ready");
          assert.equal(tool.expectedVersion, damagedHealth.tools.find((prior: any) => prior.name === tool.name).expectedVersion);
        }
        assert.equal(health.ffprobe.status, "ready");
        inside("test", "!", "-e", "/tmp/couch-corrupt-deno-executed");
        await Bun.write(`${fixtures}/helper-repair-after.json`, JSON.stringify({ tools, health, transaction, archiveSha256: installed.archiveSha256, checks: "Fresh hash/version and actual extractor/Deno smoke gate the succeeded transaction; pairings, sources, preferences, queue and progress retained." }, null, 2));
        clearDamagedTools();
        checks.push("Signed exact-current repair replaces the damaged bundled-tool view and verifies helpers without losing user data");
      }
    }
  }
  // Run after the signed transaction so the baseline may predate startup controls.
  if (process.env.COUCH_QUALIFY_GENERAL_STARTUP === "1") {
    const path = "/api/settings/startup";
    const original = await api(path);
    assert.equal(original.enabled, true, "Appliance installs default to passwordless TV startup");
    assert.equal(original.fullscreenAtLaunch, true);
    assert.equal(original.applies, "next-session");
    const beforePid = supervised();
    const admin = browsers[0]!;
    await driver(admin.port, `/session/${admin.id}/url`, { url: origin });
    await retained("The final build's refreshed remote retains its existing pairing");
    const ui = await settingsUi(admin, "general");
    const denied = await fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[1]}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(denied.status, 403, "A paired nonadministrator cannot change TV startup");
    for (const enabled of [false, true]) {
      const label = enabled ? "Enable automatic startup" : "Disable automatic startup";
      await until("General exposes the effective startup control", async () => execute(admin, "return [...document.querySelectorAll('button')].some(button => button.textContent.trim() === arguments[0] && !button.disabled)", [label]));
      await ui.button(label);
      await until("General shows the saved next-session startup mode", async () => execute(admin, "return document.querySelector('[data-startup-mode]')?.textContent.includes(arguments[0])", [enabled ? "Couch starts automatically" : "Login screen; Couch does not start automatically"]));
      assert.equal((await api(path)).enabled, enabled, "Readback comes from the effective OS setting");
      assert.equal(supervised(), beforePid, "Changing next-session startup does not interrupt Couch");
    }
    const grouped = await execute(admin, `return [...document.querySelectorAll('[role="dialog"] button')].some(button => button.textContent.trim() === "All settings")`);
    const links = grouped ? [["Connection", "Connection"], ["Manage remotes", "Paired remotes"], ["Effective overrides", "Advanced"]] : [["Pair again / manage remotes", "Connection"], ["Effective overrides", "Advanced"]];
    for (const [button, tab] of links) {
      await ui.button(button!);
      await until(`General links to ${tab}`, async () => execute(admin, "return [...document.querySelectorAll('[role=tab]')].some(t => t.textContent.trim() === arguments[0] && t.getAttribute('aria-selected') === 'true')", [tab]));
      await ui.settingsSection("general");
      await until("General tab is selected before the next link", async () => execute(admin, `return document.querySelector('[role="tab"][id$="-trigger-general"]')?.getAttribute("aria-selected") === "true"`));
      assert.equal(await execute(admin, "return [...document.querySelectorAll('p')].filter(p => p.textContent === 'Start Couch automatically without a login password').length"), 1, "General retains exactly one startup section after returning from another tab");
    }
    checks.push("Installed administrator toggles effective passwordless TV startup without interrupting the current session");
    const override = "/etc/lightdm/lightdm.conf.d/99-qualification-override.conf";
    inside("sh", "-c", 'printf "[Seat:seat0]\\nautologin-user=couch-tv\\n" > "$1"', "sh", override);
    try {
      const rejected = await fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[0]}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
      assert.equal(rejected.status, 503);
      assert.match((await rejected.json()).error, /overridden.*LightDM/);
      assert.equal((await api(path)).enabled, true, "An overriding OS setting is never reported as disabled");
      assert.equal(supervised(), beforePid);
      checks.push("Conflicting effective LightDM configuration rejects the requested change with operator guidance");
      inside("chmod", "0600", override);
      for (const method of ["GET", "POST"]) {
        const incomplete = await fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${seed.tokens[0]}`, Origin: origin, "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ enabled: false }) : undefined });
        assert.equal(incomplete.status, 503);
        assert.match((await incomplete.json()).error, /complete LightDM configuration/);
      }
      checks.push("An unreadable root override rejects partial LightDM readback and saved-success claims");
    } finally {
      inside("rm", override);
      await api(path, { enabled: true });
    }
    await Bun.write(`${fixtures}/startup-result.json`, JSON.stringify({ initial: original, final: await api(path), scope: "Installed OS readback, authorization and noninterrupting toggle; physical reboot acceptance is separate." }, null, 2));
  }
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
  if (recoveryFaults) {
    const backup = "/var/lib/couch/application/backups/qualification";
    const application = "/var/lib/couch/application";
    const expectedData = preservation();
    const recovered = async (description: string) => {
      inside("couch-recover", backup);
      await retained(description);
      assert.equal(preservation(), expectedData, `${description}: credentials, sources, preferences, progress, queue and newer profile survive`);
      assert.deepEqual(await api("/api/build"), build);
      assert.equal(inside("sha256sum", `${application}/Couch.AppImage`).split(" ")[0], installed.archiveSha256);
      faultChecks.push(description);
    };
    // Stop the real recovery shell at its actual commands, without changing the
    // installed helper or replacing filesystem/systemd operations with doubles.
    for (const boundary of ["runuser -u couch-tv -- mv -f", 'sync -f "$application"']) {
      inside("couch-session", "stop");
      inside("sh", "-c", "printf '#!/bin/sh\\nexit 1\\n' > /var/lib/couch/application/Couch.AppImage");
      const failedHash = inside("sha256sum", `${application}/Couch.AppImage`).split(" ")[0];
      const error = rejected("bash", "-c", 'boundary=$1; backup=$2; set -T; trap \'if [[ $BASH_COMMAND == "$boundary"* ]]; then echo "qualification recovery interruption" >&2; kill -KILL $$; fi\' DEBUG; source /usr/sbin/couch-recover "$backup"', "sh", boundary, backup);
      // Variables are supplied as arguments so shell syntax in a boundary is
      // literal and cannot become a command in the test driver.
      assert.match(error, /qualification recovery interruption/);
      assert.equal(preservation(), expectedData);
      assert.equal(inside("sha256sum", `${application}/Couch.AppImage`).split(" ")[0], boundary.startsWith("runuser") ? failedHash : installed.archiveSha256);
      await recovered(`Recovery resumes after interruption at ${boundary}`);
    }
    inside("couch-session", "stop");
    inside("mount", "-t", "tmpfs", "-o", "size=1m", "tmpfs", "/var/lib/couch-installer");
    try {
      assert.match(rejected("couch-recover", backup), /No space left on device/);
      assert.equal(preservation(), expectedData);
      assert.equal(inside("sha256sum", `${application}/Couch.AppImage`).split(" ")[0], installed.archiveSha256);
    } finally { inside("umount", "/var/lib/couch-installer"); }
    await recovered("Recovery after actual backup storage exhaustion preserves current data");
    inside("sh", "-c", 'cp "$1/build.json" /tmp/recovery-compatible-build.json; jq ".dataFormat += 1" "$1/build.json" > /tmp/recovery-incompatible-build.json; cp /tmp/recovery-incompatible-build.json "$1/build.json"', "sh", backup);
    try {
      const pid = supervised();
      assert.match(rejected("couch-recover", backup), /Incompatible data format/);
      assert.equal(supervised(), pid, "Incompatible recovery does not stop the current application");
      assert.equal(preservation(), expectedData);
      faultChecks.push("Incompatible recorded data format rejects old-app recovery and preserves current data");
    } finally { inside("cp", "/tmp/recovery-compatible-build.json", `${backup}/build.json`); }
    for (const process of ["couch-server", "couch"]) {
      inside("pkill", "-STOP", "-u", "couch-tv", "-x", process);
      const started = Date.now();
      await recovered(`Operator recovery terminates hung ${process} and preserves current data`);
      assert.ok(Date.now() - started < 60_000, "Systemd bounds stopping the hung process");
    }
    const pid = supervised();
    await Bun.write(`${fixtures}/runtime-faults.log`, inside("bash", "/repo/scripts/test-appliance-systemd.sh", "--runtime-faults"));
    assert.equal(supervised(), pid, "Fixed runtime repair faults leave the application running");
    assert.equal(preservation(), expectedData);
    faultChecks.push("Real APT lock and interrupted dpkg failures preserve data; operator continuation repairs the same ffmpeg version");
    // Exercise the existing legacy-device migration, while retaining all current
    // device metadata in this same database for an explicit operator schema fix.
    inside("couch-session", "stop");
    sql("BEGIN; ALTER TABLE devices RENAME TO qualification_current_devices; CREATE TABLE devices(token_hash TEXT PRIMARY KEY); INSERT INTO devices SELECT token_hash FROM qualification_current_devices; CREATE TABLE devices_named(unexpected INTEGER); COMMIT;");
    inside("couch-session", "restart");
    await until("Failed existing SQLite migration exhausts the bounded startup budget", async () => service("show", "couch-tv.service", "-p", "Result", "--value") === "start-limit-hit");
    const migrationLog = inside("journalctl", "-b", `_UID=${uid}`, "SYSLOG_IDENTIFIER=couch-tv", "--no-pager");
    assert.match(migrationLog, /table devices_named already exists/);
    await Bun.write(`${fixtures}/failed-migration.log`, migrationLog);
    assert.equal(await api("/api/build").then(() => true).catch(() => false), false);
    assert.equal(preservation("qualification_current_devices"), expectedData);
    assert.equal(sql("SELECT token_hash FROM devices ORDER BY token_hash;"), sql("SELECT token_hash FROM qualification_current_devices ORDER BY token_hash;"));
    sql("BEGIN; DROP TABLE devices; DROP TABLE devices_named; ALTER TABLE qualification_current_devices RENAME TO devices; COMMIT;");
    inside("couch-session", "restart");
    await retained("Operator schema repair reopens the current database after a failed existing migration");
    assert.equal(preservation(), expectedData);
    faultChecks.push("Actual existing SQLite migration failure preserves credentials and newer state; operator schema repair reconnects both browsers without restoring a backup");
    await Bun.write(`${fixtures}/recovery-faults.json`, JSON.stringify({ checks: faultChecks, scope: "Installed interrupted Tauri replacement, recovery process interruption, backup ENOSPC, compatibility refusal, stopped-process recovery, current APT failures and existing SQLite migration failure. Machine power-loss is not implied." }, null, 2));
  }
  await Bun.write(`${fixtures}/installed-result.json`, JSON.stringify({ initialBuild, build, transactions, archiveSha256: installed.archiveSha256, checks, display: "Xvfb software rendering; no physical acceptance", scope: updateReceipt ? "Actual installed signed A to B update, exact-current repair, systemd restart and operator recovery." : "Actual installed AppImage, systemd restart and operator recovery. Signed update and repair require their separate journey." }, null, 2));
} catch (error) {
  await Bun.write(`${fixtures}/tool-health-failure.json`, JSON.stringify(await api("/api/tools").catch(error => ({ error: String(error) })), null, 2));
  await Bun.write(`${fixtures}/installed-failure.json`, JSON.stringify({ checks, faultChecks, error: String(error) }, null, 2));
  throw error;
} finally {
  importGate?.resolve();
  try { clearDamagedTools(); }
  finally {
    media.stop(true);
    socket?.close();
    for (const browser of browsers) await driver(browser.port, `/session/${browser.id}`, undefined, "DELETE").catch(() => {});
  }
}
