import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkHelper, startHelpers } from "../src/server/helpers";
import { updateStatus } from "../src/server/helper-status";

// Run the shipped diagnosis with its OS commands replaced and fixed system paths
// read from a fixture tree. Every secret seeded here must stay out of the report.
const diagnose = resolve("packaging/tv/diagnose.js");
const options = { skip: process.platform !== "linux", timeout: 20_000 };
const secrets = ["SECRET", "AA_BB_CC_DD_EE_FF", "secret-host", "/opt/couch-helpers", "Living Room", "Kitchen", "683927", "329786", "123456", "471205"];
const now = Date.now();

// Each failure here carries a credential the report must drop: JSON, quoted with spaces,
// prefixed (access_token), in a parse error's quoted input, behind a control sequence.
const leaks = {
  update: `Couch 0.3.2 is unhealthy: {"token":"SECRET-JSON"} password="two SECRET words" access_token=SECRET-ACCESS {"pin":"683927","pairing_pin":"329786"} pin="123456"`,
  stderr: `dpkg-query: {"password": "SECRET with spaces"} pin: 471205 client_secret='SECRET quoted' \x1b[31m/home/SECRET-USER/x`,
};
const path = process.env.PATH;
// Reports the diagnosis' peak memory on stderr as it exits.
const peak = `--import=data:text/javascript,${encodeURIComponent('import { writeSync } from "node:fs"; process.on("exit", () => writeSync(2, `\nmaxRSS=${process.resourceUsage().maxRSS}\n`));')}`;

type Scenario = {
  renderer?: object | null; mainPid?: number; hang?: boolean; log?: boolean; leaks?: boolean; bus?: boolean; huge?: boolean;
  // Files in <data>/logs in place of the usual couch.log; a reader that waits a second before reading.
  logs?: Record<string, string>; slowReader?: boolean;
  // false: none recorded; a function records them in <data>/helpers.
  helpers?: boolean | ((directory: string) => Promise<void>);
};

async function report(scenario: Scenario = {}, json = true) {
  const directory = mkdtempSync(join(tmpdir(), "couch-diagnose-"));
  const root = join(directory, "root"), data = join(directory, "data"), bin = join(directory, "bin");
  const file = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
  // The TV service's process: a real one, so its kernel identity is real.
  const service = spawn("sleep", ["60"], { stdio: "ignore" });
  const stat = readFileSync(`/proc/${service.pid}/stat`, "utf8");
  const owner = { pid: service.pid!, bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), processStart: Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]) };
  try {
    file(join(root, "etc/os-release"), 'ID=debian\nVERSION_ID="13"\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n');
    file(join(root, "var/lib/couch-update/status"), `at=2026-10-19T04:12:00Z\nmode=auto\nversion=0.3.2\noutcome=rolled-back\nerror=${scenario.leaks ? leaks.update : "Couch 0.3.2 is unhealthy: https://updates.example/x?token=SECRET-UPDATE /var/lib/SECRET-PATH"}\nfailed=0.3.2\nrollback=\nsetup=\n`);
    file(join(root, "sys/class/drm/card0/device/vendor"), "0x8086\n");
    file(join(root, "sys/class/drm/card0/device/device"), "0x9bc4\n");
    mkdirSync(join(root, "sys/bus/pci/drivers/i915"), { recursive: true });
    symlinkSync(join(root, "sys/bus/pci/drivers/i915"), join(root, "sys/class/drm/card0/device/driver"));
    file(join(root, "sys/class/drm/card0-HDMI-A-1/status"), "connected\n");
    file(join(root, "sys/class/drm/card0-HDMI-A-1/enabled"), "enabled\n");
    file(join(root, "sys/class/drm/card0-HDMI-A-1/modes"), "3840x2160\n1920x1080\n");
    file(join(data, "couch.sqlite"), "SECRET-DATABASE");
    file(join(data, "tls/key.pem"), "SECRET-PRIVATE-KEY");
    // A damaged record: JSON.parse would quote the pin in its error.
    file(join(data, "operating-mode.json"), scenario.leaks ? '{"mode": "remote", "pins": {"h": SECRET-PIN}}' : JSON.stringify({ mode: "remote", address: "https://secret-host.lan:4100", pins: { "secret-host.lan": "SECRET-PIN" }, tvPresentation: true }));
    if (scenario.renderer !== null) file(join(data, "renderer-status.json"), JSON.stringify({ run: "run-1", version: "0.3.1", ...owner, navigation: 1, startedAt: new Date(now - 60_000).toISOString(), state: "ready", page: "local", at: new Date(now).toISOString(), extra: "SECRET-EXTRA", ...scenario.renderer }));
    if (typeof scenario.helpers === "function") await scenario.helpers(join(data, "helpers"));
    else if (scenario.helpers !== false) {
      file(join(data, "helpers/status.json"), JSON.stringify({ schema: 1,
        selected: { "yt-dlp": { origin: "managed", version: "2026.10.01", path: "/opt/couch-helpers/yt-dlp", sha256: "a".repeat(64), verifiedAt: "2026-10-19T03:00:00Z", latest: "2026.10.10", held: true, token: "SECRET-HELPER" },
          ffmpeg: { origin: "system", version: "ffmpeg version 7.1.1-1+b1 Copyright https://ffmpeg.example/?sig=SECRET-SIG", path: "/usr/bin/ffmpeg", sha256: null, verifiedAt: "2026-10-19T03:00:00Z", latest: null, held: false } },
        managed: { "yt-dlp": { "2026.10.01": { sha256: "a".repeat(64), installedAt: "2026-10-01T00:00:00Z", worked: { youtube: "2026-10-18T20:00:00Z" } }, "2026.10.10": { sha256: null, installedAt: null, worked: {} } } } }));
      file(join(data, "helpers/hold.json"), JSON.stringify({ schema: 1, helper: "yt-dlp", version: "2026.10.01", since: new Date(now - 3_600_000).toISOString(), until: new Date(now + 86_400_000).toISOString() }));
    }
    mkdirSync(join(data, "logs"));
    if (scenario.hang) execFileSync("mkfifo", [join(data, "logs/couch.log")]);
    else if (scenario.logs) for (const [name, text] of Object.entries(scenario.logs)) file(join(data, "logs", name), text);
    else if (scenario.log !== false) file(join(data, "logs/couch.log"), [
      "2026-10-19T20:00:00.000Z main info: Couch 0.3.1 run run-1 pid 4242 log 2",
      "2026-10-19T20:00:01.000Z device online Living Room",
      "COUCH_HOST_TOKEN=SECRET-RAW Authorization: Bearer SECRET-BEARER",
      "2026-10-19T20:01:00.000Z playback abcd1234 Synced on Living Room (buffered), Kitchen",
      "2026-10-19T20:02:00.000Z player error abcd1234 on Living Room host=media.example: 403 at https://media.example/a.m3u8?sig=SECRET-SIGNED",
      "2026-10-19T20:03:00.000Z main error: Couldn't reach Couch host=other-couch.lan: token=SECRET-MAIN /home/SECRET-USER/x",
    ].join("\n") + "\n");
    mkdirSync(bin);
    const command = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    command("dpkg-query", scenario.leaks ? `printf '%b\\n' ${JSON.stringify(leaks.stderr)} >&2; exit 1` : "echo -n 0.3.1");
    command("systemctl", `case "$*" in
      "--user show couch-tv.service"*) ${scenario.bus === false ? "echo 'Failed to connect to bus: No such file or directory' >&2; exit 1 ;;" : ""} printf 'ActiveState=active\\nSubState=running\\nMainPID=${scenario.mainPid ?? owner.pid}\\nNRestarts=1\\nResult=success\\nExecMainStartTimestamp=Sun 2026-10-19 20:00:00 UTC\\n' ;;
      "--user show-environment") printf 'DISPLAY=:0\\nXAUTHORITY=/var/lib/couch/.Xauthority\\nCOUCH_HOST_TOKEN=SECRET-SESSION-ENV\\n' ;;
      "is-enabled couch-update.timer") echo masked; exit 1 ;;
    esac`);
    command("xrandr", '[[ $DISPLAY = :0 && -z $COUCH_HOST_TOKEN ]] || exit 1\nprintf "HDMI-A-1 connected primary 1920x1080+0+0 (normal) 1600mm x 900mm\\n   3840x2160     60.00 +\\n   1920x1080     60.00*   50.00\\neDP-1 disconnected (normal)\\n"');
    // A hung sound server, as an unresponsive PipeWire can be.
    command("pactl", scenario.hang ? `echo $$ >> ${JSON.stringify(join(directory, "pids"))}; exec sleep 30` : 'case "$1" in get-default-sink) echo bluez_output.AA_BB_CC_DD_EE_FF.1 ;; list) printf "1\\tbluez_output.AA_BB_CC_DD_EE_FF.1\\tPipeWire\\ts16le 2ch 48000Hz\\tRUNNING\\n2\\talsa_output.pci-0000_00_1f.3.hdmi-stereo\\tPipeWire\\ts32le 2ch 48000Hz\\tSUSPENDED\\n" ;; esac');
    // Records far larger than the report reads, sparse so they cost no disk.
    if (scenario.huge) for (const record of [join(data, "renderer-status.json"), join(data, "operating-mode.json"), join(root, "var/lib/couch-update/status")]) truncateSync(record, 256 * 2 ** 20);
    const started = Date.now();
    const argv = [process.execPath, peak, diagnose, ...json ? ["--json"] : [], data, "complete"];
    // A slow reader on a shell pipe, as `diagnose --json | gzip > report` is: Node's own spawn
    // gives the child a socket with a far larger buffer than a pipe's 64 KiB.
    const child = spawn(scenario.slowReader ? "bash" : argv[0]!, scenario.slowReader ? ["-c", 'set -o pipefail; "$@" | { sleep 1; cat; }', "bash", ...argv] : argv.slice(1), {
      env: { ...process.env, PATH: `${bin}:${path}`, COUCH_DIAGNOSE_ROOT: root, COUCH_HOST_TOKEN: "SECRET-ENV-TOKEN", COUCH_ADMIN_RECOVERY_CODE: "SECRET-RECOVERY" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
    for (const secret of secrets) assert.ok(!stdout.includes(secret) && !stderr.includes(secret), `The report must not contain ${secret}:\n${stdout}\n${stderr}`);
    const maxRSS = Number(/^maxRSS=(\d+)$/m.exec(stderr)?.[1]) * 1024;
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const running = existsSync(join(directory, "pids")) ? readFileSync(join(directory, "pids"), "utf8").trim().split("\n").map(Number).filter(alive) : [];
    for (const pid of running) process.kill(pid, "SIGKILL");
    return { stdout, elapsed: Date.now() - started, running, maxRSS, owner, ...json ? { report: JSON.parse(stdout) } : {} };
  } finally { service.kill("SIGKILL"); rmSync(directory, { recursive: true, force: true }); }
}

test("a report names the installed tuple and observations, and leaves every secret out", options, async () => {
  const { report: result, owner } = await report();
  const observed = (name: string) => { assert.equal(result.observations[name].status, "observed", `${name}: ${JSON.stringify(result.observations[name])}`); return result.observations[name].value; };
  assert.equal(result.schema, "couch-evidence/1");
  assert.equal(result.kind, "diagnose");
  assert.equal(result.setup, "complete");
  assert.equal(result.runtime.node, process.versions.node);
  assert.deepEqual(observed("package"), { version: "0.3.1" });
  assert.deepEqual(observed("environment").os, { id: "debian", version: "13", name: "Debian GNU/Linux 13 (trixie)" });
  assert.deepEqual(observed("environment").gpus, [{ vendor: "8086", device: "9bc4", driver: "i915" }]);
  assert.deepEqual(observed("service"), { active: "active", sub: "running", pid: owner.pid, restarts: 1, result: "success", since: "Sun 2026-10-19 20:00:00 UTC" });
  assert.equal(observed("health").ok, false, "The service's process here is not Couch");
  assert.match(observed("health").error, /^Error: /, "The check's error, not Node's version line");
  assert.deepEqual(observed("mode"), { mode: "remote", tvPresentation: true });
  assert.deepEqual(observed("window"), { state: "ready", page: "local", navigation: 1, reason: null, run: "run-1", version: "0.3.1", startedAt: new Date(now - 60_000).toISOString(), at: new Date(now).toISOString(), current: true });
  const helpers = observed("helpers");
  assert.deepEqual(helpers.selected["yt-dlp"], { origin: "managed", version: "2026.10.01", sha256: "a".repeat(64), verifiedAt: "2026-10-19T03:00:00.000Z", latest: "2026.10.10", held: true });
  assert.equal(helpers.selected.ffmpeg.origin, "system");
  assert.deepEqual(helpers.managed["yt-dlp"][0], { version: "2026.10.01", installedAt: "2026-10-01T00:00:00.000Z", worked: { youtube: "2026-10-18T20:00:00.000Z" } });
  assert.equal(helpers.hold.active, true);
  const update = observed("update");
  assert.equal(update.outcome, "rolled-back");
  assert.match(update.error, /updates\.example/);
  assert.deepEqual(observed("timer"), { state: "masked" });
  assert.deepEqual(observed("display").connectors, [{ connector: "HDMI-A-1", status: "connected", enabled: "enabled", preferred: "3840x2160" }]);
  assert.deepEqual(observed("display").screens, [{ output: "HDMI-A-1", primary: true, mode: "1920x1080", refresh: 60 }]);
  assert.equal(observed("audio").defaultSink, "bluez_output.[address].1");
  assert.deepEqual(observed("audio").sinks.map((sink: { state: string }) => sink.state), ["RUNNING", "SUSPENDED"]);
  const log = observed("log");
  assert.deepEqual(log.run, { at: "2026-10-19T20:00:00.000Z", version: "0.3.1", run: "run-1", file: 2 });
  assert.deepEqual(log.delivery, { at: "2026-10-19T20:01:00.000Z", route: "Synced", buffered: true, unavailable: false });
  assert.deepEqual(log.playerErrors, { count: 1, hosts: ["media.example"], last: "2026-10-19T20:02:00.000Z" });
  assert.equal(log.errors.length, 1);
  assert.deepEqual(result.summary, { service: "active", core: "failed", window: "ready" });
  assert.deepEqual(result.measured, []);
  assert.ok(result.untested.includes("audible output") && result.untested.includes("physical remote input"));
});

test("the readable report states the same facts without secrets", options, async () => {
  const { stdout } = await report({}, false);
  assert.match(stdout, /^Couch TV diagnosis\. Passive/);
  assert.match(stdout, /Window: ready, this Couch's page, Couch 0\.3\.1/);
  assert.match(stdout, /Helpers: yt-dlp 2026\.10\.01 \(managed, held\).*hold on yt-dlp 2026\.10\.01/);
  assert.match(stdout, /Display: HDMI-A-1 connected; HDMI-A-1 1920x1080 60 Hz primary/);
  assert.match(stdout, /Update timer: masked/);
  assert.match(stdout, /Not tested: .*audible output/);
});

test("one hung observation times out alone without holding up the report", options, async () => {
  const { report: result, elapsed, running } = await report({ hang: true });
  assert.equal(result.observations.audio.status, "timeout");
  // A FIFO in place of the log, which a blocking open would wait on forever.
  assert.equal(result.observations.log.status, "unavailable");
  for (const name of ["package", "service", "window", "helpers", "update", "display", "environment"]) assert.equal(result.observations[name].status, "observed", name);
  assert.ok(elapsed < 10_000, `The report took ${elapsed} ms`);
  assert.deepEqual(running, [], "A timed-out command must not outlive the report");
});

test("a window report from an earlier or stopped process is stale, not this run's", options, async () => {
  for (const mainPid of [5151, 0]) {
    const { report: result } = await report({ mainPid });
    assert.equal(result.observations.window.value.current, false);
    assert.equal(result.summary.window, "stale");
  }
});

test("a report from an earlier process whose PID the service's now reuses is stale, not ready", options, async () => {
  // Main couldn't replace its record (writes fail silently), so an earlier boot's or run's remains.
  for (const renderer of [{ processStart: 1, run: "earlier-run" }, { bootId: "00000000-0000-4000-8000-000000000000" }]) {
    const { report: result } = await report({ renderer });
    assert.equal(result.observations.window.value.current, false, JSON.stringify(renderer));
    assert.equal(result.summary.window, "stale");
  }
});

test("a report without the process identity, as an older Couch writes, is unknown, never ready", options, async () => {
  const { report: result } = await report({ renderer: { bootId: undefined, processStart: undefined } });
  assert.equal(result.observations.window.value.current, null);
  assert.equal(result.summary.window, "unknown");
  const { stdout } = await report({ renderer: { bootId: undefined, processStart: undefined } }, false);
  assert.match(stdout, /^Window: unknown: can't tell whether the running Couch wrote it \(last report: ready at /m);
});

test("another Couch that can't be reached is a remote failure, not a broken local app", options, async () => {
  const { report: result } = await report({ renderer: { state: "failed", page: "remote", reason: "unreachable" } });
  assert.equal(result.summary.window, "remote-failed");
  const { stdout } = await report({ renderer: { state: "failed", page: "remote", reason: "unreachable" } }, false);
  assert.match(stdout, /Window: couldn't load another Couch \(unreachable\); the local app is running/);
});

test("a page that loaded without its app mounting is not reported ready", options, async () => {
  const { report: result } = await report({ renderer: { state: "page-loaded" } });
  assert.equal(result.summary.window, "page-loaded");
  const { stdout } = await report({ renderer: { state: "page-loaded", page: "remote" } }, false);
  assert.match(stdout, /Window: another Couch's page loaded, but its app hasn't reported mounting/);
});

test("missing records are unavailable, never guessed", options, async () => {
  const { report: result } = await report({ renderer: null, helpers: false, log: false });
  for (const name of ["window", "helpers", "log"]) assert.equal(result.observations[name].status, "unavailable", name);
  assert.equal(result.summary.window, "unknown");
});

test("credentials in failures, damaged records and command errors never reach either report", options, async () => {
  const { report: result } = await report({ leaks: true });
  assert.equal(result.observations.package.status, "unavailable");
  assert.match(result.observations.package.reason, /^dpkg-query: \{"\[credentials\]\} \[credentials\] \[credentials\] +\[31m\[path\]$/);
  assert.match(result.observations.update.value.error, /^Couch 0\.3\.2 is unhealthy: /);
  assert.equal((result.observations.update.value.error.match(/\[credentials\]/g) ?? []).length, 6, result.observations.update.value.error);
  assert.deepEqual(result.observations.mode, { ...result.observations.mode, status: "unavailable", reason: "The record is not valid JSON." });
  const { stdout } = await report({ leaks: true }, false);
  assert.match(stdout, /^Package: unavailable \(dpkg-query: \{"\[credentials\]\} \[credentials\]/m);
  assert.match(stdout, /^Updates: last auto run rolled-back 0\.3\.2 at .*: Couch 0\.3\.2 is unhealthy: /m);
});

test("without the service's answer, a saved window report is unknown, not ready", options, async () => {
  const { report: result } = await report({ bus: false });
  assert.equal(result.observations.service.status, "unavailable");
  assert.equal(result.observations.window.value.state, "ready");
  assert.equal(result.observations.window.value.current, null);
  assert.equal(result.summary.window, "unknown");
  assert.equal(result.summary.service, "unknown");
  const { stdout } = await report({ bus: false }, false);
  assert.match(stdout, /^Window: unknown: can't tell whether the running Couch wrote it \(last report: ready at /m);
});

test("records far larger than the report reads are bounded in memory, not only in output", options, async () => {
  const { report: normal, maxRSS: baseline } = await report();
  const { report: result, maxRSS } = await report({ huge: true });
  assert.ok(baseline > 0 && maxRSS > 0, "The diagnosis reports its peak memory");
  // Reading any one 256 MiB record whole would add at least that much.
  assert.ok(maxRSS - baseline < 64 * 2 ** 20, `Peak memory ${maxRSS} bytes against ${baseline} for the ordinary report`);
  for (const name of ["window", "mode"]) assert.deepEqual(result.observations[name], { ...result.observations[name], status: "unavailable", reason: "The record is not valid JSON." });
  assert.equal(result.observations.update.status, "observed");
  assert.equal(normal.observations.window.status, "observed");
});

test("the helpers Core's own selection recorded are reported, without their paths", options, async t => {
  // Core's real helper checks, with stand-in executables on a private PATH and no network.
  const select = async (helpers: string) => {
    const bin = join(helpers, "..", "bin-SECRET");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "yt-dlp"), "#!/bin/sh\necho 2026.10.01\n", { mode: 0o755 });
    writeFileSync(join(bin, "qjs"), "#!/bin/sh\necho 0.17.0\n", { mode: 0o755 });
    writeFileSync(join(bin, "ffmpeg"), "#!/bin/sh\necho 'ffmpeg version 7.0 https://ffmpeg.example/?sig=SECRET-SIG'\n", { mode: 0o755 });
    t.mock.method(globalThis, "fetch", async () => { throw new Error("Network unavailable"); });
    t.mock.method(console, "error", () => {});
    process.env.PATH = bin;
    try {
      startHelpers(helpers);
      await Promise.all((["yt-dlp", "qjs", "ffmpeg"] as const).map(checkHelper));
      // Status writes are serialized; this one lands after the checks'.
      await updateStatus(helpers, () => {});
    } finally { process.env.PATH = path; }
  };
  const { report: result } = await report({ helpers: select });
  const { selected, managed, hold } = result.observations.helpers.value;
  for (const [name, version] of [["yt-dlp", "2026.10.01"], ["qjs", "0.17.0"]] as const)
    assert.deepEqual(selected[name], { origin: "system", version, sha256: null, verifiedAt: selected[name].verifiedAt, latest: null, held: false }, name);
  assert.equal(selected.ffmpeg.version, "ffmpeg version 7.0 ffmpeg.example");
  assert.ok(Date.parse(selected["yt-dlp"].verifiedAt) >= now);
  assert.deepEqual(managed, { "yt-dlp": [], qjs: [], ffmpeg: [] }, "System copies leave no managed ones");
  assert.equal(hold, null);
});

// Main's log as app/log-file.ts writes it: each file begins with its run's header.
const head = (run: string, file: number) => `2026-10-19T20:00:00.000Z main info: Couch 0.3.1 run ${run} pid 4242 log ${file}\n`;
const filler = (bytes: number) => "2026-10-19T20:00:02.000Z core info: filler\n".repeat(Math.ceil(bytes / 42));

test("the run header and this run's rotated log are read however long the log, and another run's isn't", options, async () => {
  const rotated = head("run-1", 1) + "2026-10-19T20:01:00.000Z main error: Early in the earlier file\n" + filler(300 * 1024)
    + "2026-10-19T20:02:00.000Z playback abcd1234 Direct on Living Room\n" + "2026-10-19T20:03:00.000Z main error: Late in the earlier file\n";
  const current = head("run-1", 2) + filler(300 * 1024) + "2026-10-19T20:04:00.000Z main error: In the current file\n";
  const { report: result } = await report({ logs: { "couch.log": current, "couch.log.1": rotated } });
  const log = result.observations.log.value;
  assert.deepEqual(log.run, { at: "2026-10-19T20:00:00.000Z", version: "0.3.1", run: "run-1", file: 2 }, "The header beyond the newest 256 KB");
  assert.equal(log.rotated, true);
  assert.deepEqual(log.delivery, { at: "2026-10-19T20:02:00.000Z", route: "Direct", buffered: false, unavailable: false }, "Only the rotated file's newest 256 KB has a delivery");
  assert.deepEqual(log.errors.map((error: { message: string }) => error.message), ["Late in the earlier file", "In the current file"], "Oldest first, within each file's newest 256 KB");
  // couch.log.1 left by an earlier run (its file isn't this run's previous one), or none at all.
  for (const logs of [{ "couch.log": current, "couch.log.1": rotated.replace("run run-1", "run run-0") }, { "couch.log": current, "couch.log.1": head("run-1", 5) + "2026-10-19T20:03:00.000Z main error: Not this file\n" }, { "couch.log": current }]) {
    const { report: other } = await report({ logs });
    assert.equal(other.observations.log.status, "observed");
    assert.equal(other.observations.log.value.rotated, false);
    assert.equal(other.observations.log.value.delivery, null);
    assert.deepEqual(other.observations.log.value.errors.map((error: { message: string }) => error.message), ["In the current file"]);
  }
});

test("control bytes in a recorded time never reach the readable report", options, async () => {
  const at = "Thu, 01 Jan 2026 00:00:00 GMT (\u001b[2J\u0007)";
  const { report: result } = await report({ renderer: { state: "failed", page: "remote", reason: "unreachable", at, startedAt: "not a time \u001b[2J" } });
  assert.equal(result.observations.window.value.at, "2026-01-01T00:00:00.000Z");
  assert.equal(result.observations.window.value.startedAt, null);
  const { stdout } = await report({ renderer: { pid: 1, at } }, false);
  assert.match(stdout, /^Window: no report from a running Couch \(last: ready at 2026-01-01T00:00:00\.000Z\)$/m);
  assert.doesNotMatch(stdout, /[\u0000-\u0009\u000b-\u001f\u007f]/);
});

test("a report larger than a pipe holds reaches a slow reader whole", options, async () => {
  // The largest helper record the report keeps: 4 helpers, 8 copies each, 16 providers per copy.
  const helpers = async (directory: string) => {
    const copies = Object.fromEntries(Array.from({ length: 8 }, (_, copy) => [`2026.10.0${copy}`, { sha256: null, installedAt: "2026-10-01T00:00:00Z",
      worked: Object.fromEntries(Array.from({ length: 16 }, (_, provider) => [`${provider}`.padStart(80, "p"), "2026-10-18T20:00:00Z"])) }]));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "status.json"), JSON.stringify({ schema: 1, selected: {}, managed: Object.fromEntries(["yt-dlp", "qjs", "ffmpeg", "mpv"].map(name => [name, copies])) }));
  };
  const { stdout, report: result } = await report({ helpers, slowReader: true });
  assert.ok(stdout.length > 64 * 1024, `The report is ${stdout.length} bytes`);
  assert.equal(result.observations.helpers.value.managed.mpv[7].version, "2026.10.07");
});
