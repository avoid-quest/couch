import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run the shipped diagnosis with its OS commands replaced and fixed system paths
// read from a fixture tree. Every secret seeded here must stay out of the report.
const diagnose = resolve("packaging/tv/diagnose.js");
const options = { skip: process.platform !== "linux", timeout: 20_000 };
const secrets = ["SECRET", "AA_BB_CC_DD_EE_FF", "secret-host", "/opt/couch-helpers", "Living Room", "Kitchen"];
const now = Date.now();

type Scenario = { renderer?: object | null; mainPid?: number; hang?: boolean; log?: boolean; helpers?: boolean };

async function report(scenario: Scenario = {}, json = true) {
  const directory = mkdtempSync(join(tmpdir(), "couch-diagnose-"));
  const root = join(directory, "root"), data = join(directory, "data"), bin = join(directory, "bin");
  const file = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
  try {
    file(join(root, "etc/os-release"), 'ID=debian\nVERSION_ID="13"\nPRETTY_NAME="Debian GNU/Linux 13 (trixie)"\n');
    file(join(root, "var/lib/couch-update/status"), `at=2026-10-19T04:12:00Z\nmode=auto\nversion=0.3.2\noutcome=rolled-back\nerror=Couch 0.3.2 is unhealthy: https://updates.example/x?token=SECRET-UPDATE /var/lib/SECRET-PATH\nfailed=0.3.2\nrollback=\nsetup=\n`);
    file(join(root, "sys/class/drm/card0/device/vendor"), "0x8086\n");
    file(join(root, "sys/class/drm/card0/device/device"), "0x9bc4\n");
    mkdirSync(join(root, "sys/bus/pci/drivers/i915"), { recursive: true });
    symlinkSync(join(root, "sys/bus/pci/drivers/i915"), join(root, "sys/class/drm/card0/device/driver"));
    file(join(root, "sys/class/drm/card0-HDMI-A-1/status"), "connected\n");
    file(join(root, "sys/class/drm/card0-HDMI-A-1/enabled"), "enabled\n");
    file(join(root, "sys/class/drm/card0-HDMI-A-1/modes"), "3840x2160\n1920x1080\n");
    file(join(data, "couch.sqlite"), "SECRET-DATABASE");
    file(join(data, "tls/key.pem"), "SECRET-PRIVATE-KEY");
    file(join(data, "operating-mode.json"), JSON.stringify({ mode: "remote", address: "https://secret-host.lan:4100", pins: { "secret-host.lan": "SECRET-PIN" }, tvPresentation: true }));
    if (scenario.renderer !== null) file(join(data, "renderer-status.json"), JSON.stringify({ run: "run-1", version: "0.3.1", pid: 4242, navigation: 1, startedAt: new Date(now - 60_000).toISOString(), state: "ready", page: "local", at: new Date(now).toISOString(), extra: "SECRET-EXTRA", ...scenario.renderer }));
    if (scenario.helpers !== false) {
      file(join(data, "helpers/status.json"), JSON.stringify({ schema: 1,
        selected: { "yt-dlp": { origin: "managed", version: "2026.10.01", path: "/opt/couch-helpers/yt-dlp", sha256: "a".repeat(64), verifiedAt: "2026-10-19T03:00:00Z", latest: "2026.10.10", held: true, token: "SECRET-HELPER" },
          ffmpeg: { origin: "system", version: "ffmpeg version 7.1.1-1+b1 Copyright https://ffmpeg.example/?sig=SECRET-SIG", path: "/usr/bin/ffmpeg", sha256: null, verifiedAt: "2026-10-19T03:00:00Z", latest: null, held: false } },
        managed: { "yt-dlp": { "2026.10.01": { sha256: "a".repeat(64), installedAt: "2026-10-01T00:00:00Z", worked: { youtube: "2026-10-18T20:00:00Z" } }, "2026.10.10": { sha256: null, installedAt: null, worked: {} } } } }));
      file(join(data, "helpers/hold.json"), JSON.stringify({ schema: 1, helper: "yt-dlp", version: "2026.10.01", since: new Date(now - 3_600_000).toISOString(), until: new Date(now + 86_400_000).toISOString() }));
    }
    mkdirSync(join(data, "logs"));
    if (scenario.hang) execFileSync("mkfifo", [join(data, "logs/couch.log")]);
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
    command("dpkg-query", "echo -n 0.3.1");
    command("systemctl", `case "$*" in
      "--user show couch-tv.service"*) printf 'ActiveState=active\\nSubState=running\\nMainPID=${scenario.mainPid ?? 4242}\\nNRestarts=1\\nResult=success\\nExecMainStartTimestamp=Sun 2026-10-19 20:00:00 UTC\\n' ;;
      "--user show-environment") printf 'DISPLAY=:0\\nXAUTHORITY=/var/lib/couch/.Xauthority\\nCOUCH_HOST_TOKEN=SECRET-SESSION-ENV\\n' ;;
      "is-enabled couch-update.timer") echo masked; exit 1 ;;
    esac`);
    command("xrandr", '[[ $DISPLAY = :0 && -z $COUCH_HOST_TOKEN ]] || exit 1\nprintf "HDMI-A-1 connected primary 1920x1080+0+0 (normal) 1600mm x 900mm\\n   3840x2160     60.00 +\\n   1920x1080     60.00*   50.00\\neDP-1 disconnected (normal)\\n"');
    // A hung sound server, as an unresponsive PipeWire can be.
    command("pactl", scenario.hang ? `echo $$ >> ${JSON.stringify(join(directory, "pids"))}; exec sleep 30` : 'case "$1" in get-default-sink) echo bluez_output.AA_BB_CC_DD_EE_FF.1 ;; list) printf "1\\tbluez_output.AA_BB_CC_DD_EE_FF.1\\tPipeWire\\ts16le 2ch 48000Hz\\tRUNNING\\n2\\talsa_output.pci-0000_00_1f.3.hdmi-stereo\\tPipeWire\\ts32le 2ch 48000Hz\\tSUSPENDED\\n" ;; esac');
    const started = Date.now();
    const child = spawn(process.execPath, [diagnose, ...json ? ["--json"] : [], data, "complete"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COUCH_DIAGNOSE_ROOT: root, COUCH_HOST_TOKEN: "SECRET-ENV-TOKEN", COUCH_ADMIN_RECOVERY_CODE: "SECRET-RECOVERY" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, stderr);
    for (const secret of secrets) assert.ok(!stdout.includes(secret), `The report must not contain ${secret}:\n${stdout}`);
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const running = existsSync(join(directory, "pids")) ? readFileSync(join(directory, "pids"), "utf8").trim().split("\n").map(Number).filter(alive) : [];
    for (const pid of running) process.kill(pid, "SIGKILL");
    return { stdout, elapsed: Date.now() - started, running, ...json ? { report: JSON.parse(stdout) } : {} };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("a report names the installed tuple and observations, and leaves every secret out", options, async () => {
  const { report: result } = await report();
  const observed = (name: string) => { assert.equal(result.observations[name].status, "observed", `${name}: ${JSON.stringify(result.observations[name])}`); return result.observations[name].value; };
  assert.equal(result.schema, "couch-evidence/1");
  assert.equal(result.kind, "diagnose");
  assert.equal(result.setup, "complete");
  assert.equal(result.runtime.node, process.versions.node);
  assert.deepEqual(observed("package"), { version: "0.3.1" });
  assert.deepEqual(observed("environment").os, { id: "debian", version: "13", name: "Debian GNU/Linux 13 (trixie)" });
  assert.deepEqual(observed("environment").gpus, [{ vendor: "8086", device: "9bc4", driver: "i915" }]);
  assert.deepEqual(observed("service"), { active: "active", sub: "running", pid: 4242, restarts: 1, result: "success", since: "Sun 2026-10-19 20:00:00 UTC" });
  assert.equal(observed("health").ok, false, "No real Couch runs as PID 4242 here");
  assert.deepEqual(observed("mode"), { mode: "remote", tvPresentation: true });
  assert.deepEqual(observed("window"), { state: "ready", page: "local", navigation: 1, reason: null, run: "run-1", version: "0.3.1", startedAt: new Date(now - 60_000).toISOString(), at: new Date(now).toISOString(), current: true });
  const helpers = observed("helpers");
  assert.deepEqual(helpers.selected["yt-dlp"], { origin: "managed", version: "2026.10.01", sha256: "a".repeat(64), verifiedAt: "2026-10-19T03:00:00Z", latest: "2026.10.10", held: true });
  assert.equal(helpers.selected.ffmpeg.origin, "system");
  assert.deepEqual(helpers.managed["yt-dlp"][0], { version: "2026.10.01", installedAt: "2026-10-01T00:00:00Z", worked: { youtube: "2026-10-18T20:00:00Z" } });
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
