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
  store.saveProfilePreferences(profile.id, { audioLanguage: "it", subtitleLanguage: "en", subtitles: "off", speed: 1, replayGain: "off" });
  store.saveProgress(profile.id, { mediaId: "qualification:retained", title: "Retained progress", libraryItemId: null, position: 37, duration: 120, watched: false, lastPlayedAt: 1 });
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
const faultChecks: string[] = [];
const recoveryFaults = process.env.COUCH_QUALIFY_RECOVERY_FAULTS === "1";
const dataDir = inside("sh", "-c", ". /etc/couch/appliance.env; printf '%s' \"$COUCH_DATA_DIR\"");
assert.ok(dataDir.startsWith("/"));
const sql = (statement: string) => inside("sqlite3", `${dataDir}/couch.sqlite`, statement);
function preservation() {
  // lastSeenAt and scan status change during normal reconnect. Compare the
  // authoritative identities/settings, not those incidental timestamps.
  return sql("SELECT token_hash,id,name,role FROM devices ORDER BY id; SELECT id,name,path FROM library_sources ORDER BY id; SELECT * FROM watching_preferences ORDER BY profileId; SELECT * FROM viewing_progress ORDER BY profileId,mediaId; SELECT * FROM session; SELECT * FROM watching_profiles ORDER BY id;");
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
    await execute(admin, "document.querySelector('button[aria-label=Settings]').click(); return true");
    const click = (text: string) => execute(admin, "const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0] && !b.disabled); if (!button) return false; button.click(); return true", [text]);
    await until("Administrator opens restart confirmation", async () => click("Restart Couch"));
    let observed = 0, beforeRestart = 0;
    await until("Restart confirmation has unsaved native progress", async () => {
      beforeRestart = stored(); observed = state.player.position;
      return observed > beforeRestart + 1;
    });
    assert.equal(await click("Confirm restart"), true);
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
    await execute(admin, "const b = document.querySelector('button[aria-label=Settings]'); if (b && !document.querySelector('[role=tablist]')) b.click(); return true");
    await until("Administrator requests restart with the exhausted budget", async () => click("Restart Couch"));
    assert.equal(await click("Confirm restart"), true);
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
    for (const repair of [false, true]) {
      const beforePid = supervised();
      const requestId = crypto.randomUUID().replaceAll("-", "");
      const current = (await api("/api/updates")).installation.current;
      const body = repair
        ? { repair: { expectedCurrentId: current.candidateId, requestId, confirmInterrupt: false, repairRuntime: false } }
        : { install: { candidateId: candidate.id, requestId, confirmInterrupt: false } };
      const accepted = await api(repair ? "/api/updates/repair" : "/api/updates/install", body);
      assert.equal(accepted.transaction.requestId, requestId);
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
      assert.equal((await api("/api/updates")).policy, "manual");
      assert.equal((await api("/api/updates")).channel, "preview");
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
    await execute(admin, "document.querySelector('button[aria-label=Settings]').click(); return true");
    const click = (text: string) => execute(admin, "const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === arguments[0] && !b.disabled); if (!b) return false; b.click(); return true", [text]);
    const denied = await fetch(`${origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${seed.tokens[1]}`, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    assert.equal(denied.status, 403, "A paired nonadministrator cannot change TV startup");
    for (const enabled of [false, true]) {
      await until("General exposes the effective startup control", async () => click(enabled ? "Enable automatic startup" : "Disable automatic startup"));
      await until("General shows the saved next-session startup mode", async () => execute(admin, "return document.querySelector('[data-startup-mode]')?.textContent.includes(arguments[0])", [enabled ? "Couch starts automatically" : "Login screen; Couch does not start automatically"]));
      assert.equal((await api(path)).enabled, enabled, "Readback comes from the effective OS setting");
      assert.equal(supervised(), beforePid, "Changing next-session startup does not interrupt Couch");
    }
    for (const [button, tab] of [["Pair again / manage remotes", "Connection"], ["Effective overrides", "Advanced"]]) {
      assert.equal(await click(button!), true);
      await until(`General links to ${tab}`, async () => execute(admin, "return [...document.querySelectorAll('[role=tab]')].some(t => t.textContent.trim() === arguments[0] && t.getAttribute('aria-selected') === 'true')", [tab]));
      const general = await driver(admin.port, `/session/${admin.id}/element`, { using: "css selector", value: '[role="tab"][id$="-trigger-general"]' });
      await driver(admin.port, `/session/${admin.id}/element/${general["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
      await until("General tab is selected before the next link", async () => execute(admin, 'return document.querySelector(\'[role="tab"][id$="-trigger-general"]\')?.getAttribute("aria-selected") === "true"'));
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
    inside("couch-session", "stop");
    inside("mv", `${application}/Couch.AppImage`, "/tmp/qualification-interrupted.AppImage");
    await recovered("Recovery replaces an absent current archive at the Tauri rename/write boundary");
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
    await Bun.write(`${fixtures}/recovery-faults.json`, JSON.stringify({ checks: faultChecks, scope: "Installed recovery process interruption, backup ENOSPC, recorded compatibility refusal and operator recovery of stopped processes. No machine power-loss or failed schema migration is implied." }, null, 2));
  }
  await Bun.write(`${fixtures}/installed-result.json`, JSON.stringify({ initialBuild, build, transactions, archiveSha256: installed.archiveSha256, checks, display: "Xvfb software rendering; no physical acceptance", scope: updateReceipt ? "Actual installed signed A to B update, exact-current repair, systemd restart and operator recovery." : "Actual installed AppImage, systemd restart and operator recovery. Signed update and repair require their separate journey." }, null, 2));
} catch (error) {
  await Bun.write(`${fixtures}/tool-health-failure.json`, JSON.stringify(await api("/api/tools").catch(error => ({ error: String(error) })), null, 2));
  await Bun.write(`${fixtures}/installed-failure.json`, JSON.stringify({ checks, faultChecks, error: String(error) }, null, 2));
  throw error;
} finally {
  media.stop(true);
  socket?.close();
  for (const browser of browsers) await driver(browser.port, `/session/${browser.id}`, undefined, "DELETE").catch(() => {});
}
