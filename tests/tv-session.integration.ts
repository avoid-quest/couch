import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run the shipped session with only its OS-command boundary replaced. No real
// display, service, user account or cursor configuration is changed.
for (const state of ["unloaded", "failed", "active"]) test(`the ${state} service starts without spurious reset warnings and survives cursor failure`, { timeout: 15_000 }, async () => {
  const exitCode = state === "failed" ? 127 : 23;
  const directory = mkdtempSync(join(tmpdir(), "couch-session-"));
  const events = join(directory, "events");
  writeFileSync(events, "");
  const command = (name: string, body: string) => writeFileSync(join(directory, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  command("id", "echo couch-tv");
  command("systemctl", `
    case "$*" in
      *is-failed*) [ '${state}' = failed ] ;;
      *reset-failed*)
        echo reset >> "$COUCH_TEST_SESSION_EVENTS"
        if [ '${state}' = unloaded ]; then
          echo 'Failed to reset failed state of unit couch-tv.service: Unit couch-tv.service not loaded.' >&2
          exit 1
        fi ;;
      *start*) echo start >> "$COUCH_TEST_SESSION_EVENTS" ;;
      *ActiveState*) echo poll >> "$COUCH_TEST_SESSION_EVENTS"; echo active ;;
    esac
  `);
  for (const name of ["dbus-update-activation-environment", "xset"]) command(name, "exit 0");
  command("xrandr", 'echo "eDP-1 connected primary 1920x1080+0+0"');
  command("timeout", 'shift; exec "$@"');
  command("openbox", "exec /bin/sleep 30");
  command("sleep", "exec /bin/sleep .02");
  command("unclutter-xfixes", `/bin/sleep .03\nexit ${exitCode}`);
  command("logger", 'echo "$*" >> "$COUCH_TEST_SESSION_EVENTS"');
  const child = spawn("bash", [resolve("packaging/tv/usr/lib/couch-appliance/session")], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COUCH_TEST_SESSION_EVENTS: events }, stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", chunk => { stderr += chunk; });
  const stopped = once(child, "exit");
  try {
    const deadline = Date.now() + 12_000;
    while (readFileSync(events, "utf8").split("\n").filter(line => line === "poll").length < 3) {
      assert.ok(Date.now() < deadline, `The session must complete three monitor iterations (exit=${child.exitCode}, stderr=${stderr}, events=${readFileSync(events, "utf8")})`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(child.exitCode, null, "A cursor failure must not end the TV session");
    const lines = readFileSync(events, "utf8").trim().split("\n").filter(line => line !== "poll");
    assert.equal(stderr, "", "Starting an unloaded unit must not emit a reset warning");
    assert.deepEqual(lines.filter(line => line === "reset" || line === "start"), state === "failed" ? ["reset", "start"] : ["start"]);
    const diagnostics = lines.filter(line => line !== "reset" && line !== "start");
    assert.equal(diagnostics.length, 1, "One failure emits one diagnostic, not one per session poll");
    assert.match(diagnostics[0]!, new RegExp(`cursor.*${exitCode}`, "i"));
  } finally {
    child.kill("SIGTERM");
    await stopped;
    rmSync(directory, { recursive: true, force: true });
  }
});
