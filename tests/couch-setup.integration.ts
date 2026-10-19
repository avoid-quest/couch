import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run the shipped setup against a fixture root (COUCH_SETUP_ROOT) with its OS
// commands replaced. --tv runs as root inside an unprivileged user namespace, so
// apply and --inspect see the same fixtures. Nothing outside the fixture changes.
const setup = resolve("packaging/couch-setup");
const namespace = spawnSync("unshare", ["-r", "true"]).status === 0;
const options = { skip: process.platform !== "linux" ? "Linux only" : false, timeout: 20_000 };
const rootOptions = { ...options, skip: options.skip || (!namespace && "Needs unprivileged user namespaces (unshare -r).") };
const mutating = /^(apt-get|adduser|chgrp|install|touch|ln|chmod|mv|mkdir|rm|cp|sync|flock) |^systemctl .*\b(enable|disable|start|stop|restart|reset-failed|daemon-reload|set-default|mask)\b|^couch /m;
// Setup refuses group-writable state directories, as it should.
process.umask(0o022);
const packages = readFileSync("packaging/tv/packages", "utf8").trim().split("\n");

type Scenario = {
  installed?: string[]; account?: string | null; locked?: boolean; timer?: string; active?: boolean;
  displayManager?: string; state?: "complete" | "pending"; files?: Record<string, string>; links?: Record<string, string>; os?: string;
};

function fixture(scenario: Scenario = {}) {
  const directory = mkdtempSync(join(tmpdir(), "couch-setup-"));
  const root = join(directory, "root"), bin = join(directory, "bin"), events = join(directory, "events");
  const file = (path: string, text: string, mode = 0o644) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text, { mode }); };
  file("etc/os-release", scenario.os ?? 'ID=debian\nVERSION_ID="13"\n');
  mkdirSync(join(root, "run/systemd/system"), { recursive: true });
  mkdirSync(join(root, "var/lib"), { recursive: true });
  file("usr/bin/couch", '#!/bin/bash\necho "couch $*" >> "$EVENTS"\ncase "$*" in --version) echo v24.0.0 ;; *check-health.js*) echo \'{"mode":"local"}\' ;; esac\n', 0o755);
  cpSync("packaging/tv", join(root, "usr/share/couch/tv"), { recursive: true });
  if (scenario.state) file(`var/lib/couch-installer/native-tv/${scenario.state}`, "");
  if (scenario.displayManager) file("etc/X11/default-display-manager", `${scenario.displayManager}\n`);
  for (const [path, text] of Object.entries(scenario.files ?? {})) file(path, text);
  for (const [path, target] of Object.entries(scenario.links ?? {})) { mkdirSync(join(root, path, ".."), { recursive: true }); symlinkSync(target, join(root, path)); }
  mkdirSync(bin);
  const command = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "$EVENTS"\n${body}\n`, { mode: 0o755 });
  // Real file operations, recorded so inspection can prove it made none.
  for (const name of ["install", "touch", "ln", "chmod", "mv", "mkdir", "rm", "cp", "sync", "flock"]) command(name, `exec ${execFileSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim()} "$@"`);
  command("dpkg", "echo amd64");
  command("dpkg-query", 'grep -qxF "${@: -1}" "$FIXTURE/installed" && echo installed');
  command("getent", '[[ -f $FIXTURE/account ]] && cat "$FIXTURE/account"');
  command("id", 'case "$1" in -u) echo 1001 ;; -Gn) echo couch-tv ;; esac');
  command("passwd", `echo "couch-tv ${scenario.locked === false ? "P" : "L"} 2026-01-01"`);
  command("apt-get", '[[ " $* " != *" install "* ]] || printf "%s\\n" "$@" | grep -v "^-" | grep -vx install >> "$FIXTURE/installed"');
  command("adduser", 'echo "couch-tv:x:999:999::/var/lib/couch:/bin/sh" > "$FIXTURE/account"');
  command("chgrp", "exit 0");
  command("pgrep", "exit 1");
  command("runuser", 'shift 3; exec "$@"');
  command("systemctl", `case "$*" in
    "is-enabled couch-update.timer") echo "${scenario.timer ?? "disabled"}"; [[ "${scenario.timer}" = enabled ]] ;;
    "is-enabled lightdm.service") echo disabled; exit 1 ;;
    get-default) echo multi-user.target ;;
    "--user is-active --quiet couch-tv.service") [[ "${scenario.active ? 1 : 0}" = 1 ]] ;;
    "--user show couch-tv.service --property=MainPID --value") echo 4242 ;;
  esac`);
  writeFileSync(join(directory, "installed"), ["couch", ...scenario.installed ?? []].join("\n") + "\n");
  if (scenario.account !== null) writeFileSync(join(directory, "account"), `couch-tv:x:999:999::${scenario.account ?? "/var/lib/couch"}:/bin/sh\n`);
  // A live user bus, as a running TV session has.
  if (scenario.active) {
    mkdirSync(join(root, "run/user/1001"), { recursive: true });
    execFileSync("python3", ["-I", "-c", "import socket; socket.socket(socket.AF_UNIX).bind('bus')"], { cwd: join(root, "run/user/1001") });
  }
  writeFileSync(events, "");
  const run = (argument: string, asRoot: boolean) => {
    writeFileSync(events, "");
    const result = spawnSync(asRoot ? "unshare" : "bash", [...asRoot ? ["-r", "bash"] : [], setup, argument], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COUCH_SETUP_ROOT: root, EVENTS: events, FIXTURE: directory, LC_ALL: "C" },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, events: readFileSync(events, "utf8") };
  };
  return { root, directory, run, [Symbol.dispose]: () => { chmodTree(directory); rmSync(directory, { recursive: true, force: true }); } };
}

function chmodTree(path: string) {
  try { if (!lstatSync(path).isSymbolicLink()) chmodSync(path, 0o755); } catch {}
  try { for (const entry of readdirSync(path)) if (lstatSync(join(path, entry)).isDirectory()) chmodTree(join(path, entry)); } catch {}
}

// Every path's type, mode, content and link target, to prove a run wrote nothing.
function snapshot(root: string, path = ""): string[] {
  const full = join(root, path), info = lstatSync(full);
  const entry = `${path || "."} ${info.mode.toString(8)}`;
  if (info.isSymbolicLink()) return [`${entry} -> ${readlinkSync(full)}`];
  if (info.isSocket()) return [`${entry} socket`];
  if (!info.isDirectory()) return [`${entry} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`];
  let entries: string[];
  try { entries = readdirSync(full).sort(); } catch { return [`${entry} unreadable`]; }
  return [entry, ...entries.flatMap(name => snapshot(root, join(path, name)))];
}

function inspect(environment: ReturnType<typeof fixture>, asRoot = true) {
  const before = snapshot(environment.root);
  const result = environment.run("--inspect", asRoot);
  assert.deepEqual(snapshot(environment.root), before, "Inspection must not change any file");
  assert.doesNotMatch(result.events, mutating, "Inspection must not run a mutating command");
  const section = (title: string) => (result.stdout.split(`${title}:\n`)[1] ?? "").split(/\n(?! )/)[0]!.split("\n").map(line => line.trim()).filter(Boolean);
  return { ...result, would: section("Setup would"), keep: section("Setup would keep"), unavailable: section("Unavailable"), refuse: section("Setup would refuse") };
}

test("a fresh machine's inspection predicts exactly what --tv then does", rootOptions, () => {
  using environment = fixture({ installed: packages.slice(0, 3), account: null });
  const plan = inspect(environment);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /Earlier setup: none\nRuntime account couch-tv: absent\nData directory: \/var\/lib\/couch\/\.local\/share\/quest\.avoid\.couch \(packaged default\)/);
  assert.ok(plan.would.includes("Create the locked couch-tv system account"));
  assert.ok(plan.would.includes("Enable LightDM and boot to graphical.target"));
  assert.ok(plan.would.includes("Enable and start couch-update.timer"));
  assert.ok(plan.would.some(line => line.startsWith("Refresh APT") && line.includes(`missing: ${packages.slice(3).join(" ")}`)));
  assert.deepEqual(plan.refuse, []);
  const predicted = plan.would.filter(line => /^(Copy|Link) /.test(line)).map(line => line.slice(5)).sort();
  assert.ok(predicted.includes("/etc/lightdm/lightdm.conf.d/50-couch.conf") && predicted.includes("/etc/systemd/user/couch-tv.service"));

  const before = new Set(snapshot(environment.root).map(line => line.split(" ")[0]));
  const applied = environment.run("--tv", true);
  assert.equal(applied.status, 0, applied.stderr);
  for (const expected of ["apt-get update", "adduser --system", "systemctl enable lightdm.service", "systemctl set-default graphical.target", "systemctl enable --now couch-update.timer"]) assert.match(applied.events, new RegExp(`^${expected}`, "m"));
  const created = snapshot(environment.root).filter(line => / -> |^\S+ 100/.test(line)).map(line => line.split(" ")[0]!)
    .filter(path => !before.has(path) && (path.startsWith("etc/") || path.startsWith("usr/"))).map(path => `/${path}`).sort();
  assert.deepEqual(created, predicted, "Setup must add exactly the files inspection listed");
  assert.ok(existsSync(join(environment.root, "var/lib/couch-installer/native-tv/complete")));
});

test("a completed setup's inspection keeps administrator files, data and masks as --tv does", rootOptions, () => {
  const customised = "# Administrator's own sign-in policy\n";
  using environment = fixture({
    installed: packages, state: "complete", timer: "masked", displayManager: "/usr/sbin/lightdm",
    files: { "etc/couch/appliance.env": "COUCH_DATA_DIR=\"/srv/couch data\"\n", "etc/lightdm/lightdm.conf.d/50-couch.conf": customised, "srv/couch data/couch.sqlite": "" },
    links: { "etc/systemd/logind.conf.d/50-couch.conf": "/dev/null", "etc/systemd/user/couch-tv.service": "/usr/share/couch/tv/usr/lib/systemd/user/couch-tv.service" },
  });
  const plan = inspect(environment);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /Earlier setup: complete\nRuntime account couch-tv: dedicated\nData directory: \/srv\/couch data \(from \/etc\/couch\/appliance.env\)/);
  for (const kept of ["Existing data in /srv/couch data", "/etc/couch/appliance.env", "/etc/lightdm/lightdm.conf.d/50-couch.conf", "/etc/systemd/logind.conf.d/50-couch.conf", "/etc/systemd/user/couch-tv.service", "Masked couch-update.timer", "Sign-in, boot target and power policy"]) assert.ok(plan.keep.includes(kept), kept);
  assert.ok(!plan.would.some(line => /^(Create the locked|Enable )|^(Copy|Link) \/etc\//.test(line)), plan.would.join("\n"));

  const applied = environment.run("--tv", true);
  assert.equal(applied.status, 0, applied.stderr);
  assert.doesNotMatch(applied.events, /^(adduser|systemctl enable|systemctl set-default)/m);
  assert.equal(readFileSync(join(environment.root, "etc/lightdm/lightdm.conf.d/50-couch.conf"), "utf8"), customised);
  assert.equal(readlinkSync(join(environment.root, "etc/systemd/logind.conf.d/50-couch.conf")), "/dev/null");
  assert.match(readFileSync(join(environment.root, "etc/couch/appliance.env"), "utf8"), /srv\/couch data/);
});

test("a running session's inspection predicts the stop, restart and health check", rootOptions, () => {
  using environment = fixture({ installed: packages, state: "complete", active: true, displayManager: "/usr/sbin/lightdm" });
  const plan = inspect(environment);
  assert.ok(plan.would.includes("Stop the running Couch TV app, then start it again and check its health"), plan.stdout);
  const applied = environment.run("--tv", true);
  assert.equal(applied.status, 0, applied.stderr);
  const order = ["systemctl --user stop couch-tv.service", "systemctl --user start couch-tv.service", "couch /"].map(event => applied.events.indexOf(event));
  assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1]!)), applied.events);
  assert.equal(readFileSync(join(environment.root, "var/lib/couch-installer/native-tv/health.json"), "utf8").trim(), '{"mode":"local"}');
});

// Each conflict alone: inspection reports the refusal --tv stops with, and both leave packages, accounts and services alone.
const conflicts: [string, Scenario][] = [
  ["Supported target: Debian 13 amd64.", { os: 'ID=ubuntu\nVERSION_ID="24.04"\n' }],
  ["Refusing symbolic link: /var/lib/couch-installer", { links: { "var/lib/couch-installer": "/tmp" } }],
  ["The existing couch-tv account is not the locked dedicated runtime account.", { account: "/home/couch-tv" }],
  ["The existing couch-tv account is not the locked dedicated runtime account.", { locked: false }],
  ["Inspect the existing service override before migration: /etc/systemd/system/couch-tv.service", { files: { "etc/systemd/system/couch-tv.service": "[Service]\n" } }],
  ["Inspect the existing service override before migration: /var/lib/couch/.config/systemd/user/couch-tv.service.d", { files: { "var/lib/couch/.config/systemd/user/couch-tv.service.d/local.conf": "" } }],
  ["Inspect the existing TV user unit before migration.", { files: { "etc/systemd/user/couch-tv.service": "[Service]\n" } }],
  ["Another display manager is configured. Keep the desktop or select LightDM deliberately.", { displayManager: "/usr/sbin/gdm3" }],
  ["LightDM already has a desktop policy. Use ordinary installation.", { displayManager: "/usr/sbin/lightdm" }],
];
for (const [refusal, scenario] of conflicts) test(`inspection and --tv agree on refusing: ${refusal}`, rootOptions, () => {
  using environment = fixture({ installed: packages, ...scenario });
  const plan = inspect(environment);
  assert.equal(plan.status, 1);
  assert.deepEqual(plan.refuse, [refusal]);
  const applied = environment.run("--tv", true);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, new RegExp(`^couch-setup: ${refusal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"));
  assert.doesNotMatch(applied.events, /^(apt-get|adduser|chgrp|couch) |^systemctl /m, "A refused setup changes no package, account or service");
});

test("inspection refuses as --tv does while another installation holds the lock, without taking it", rootOptions, async () => {
  using environment = fixture({ installed: packages, state: "complete", displayManager: "/usr/sbin/lightdm" });
  const lock = join(environment.root, "var/lib/couch-install-locks/tv.lock"), held = join(environment.directory, "held");
  mkdirSync(join(lock, ".."), { recursive: true });
  writeFileSync(lock, "");
  // An installation or recovery in progress, as a real flock holder.
  const holder = spawn("flock", ["-x", lock, "-c", `touch ${JSON.stringify(held)}; exec sleep 30`], { stdio: "ignore", detached: true });
  try {
    while (!existsSync(held)) await new Promise(resolve => setTimeout(resolve, 20));
    const plan = inspect(environment);
    assert.equal(plan.status, 1, plan.stdout);
    assert.deepEqual(plan.refuse, ["Another Couch installation or recovery is running."]);
    const applied = environment.run("--tv", true);
    assert.equal(applied.status, 1);
    assert.match(applied.stderr, /^couch-setup: Another Couch installation or recovery is running\.$/m);
  } finally {
    // The lock goes with its last holder: flock and the command it started.
    const exited = once(holder, "exit");
    process.kill(-holder.pid!, "SIGKILL");
    await exited;
    while (readFileSync("/proc/locks", "utf8").includes(`:${lstatSync(lock).ino} `)) await new Promise(resolve => setTimeout(resolve, 20));
  }
  const plan = inspect(environment);
  assert.equal(plan.status, 0, plan.stdout);
  assert.deepEqual(plan.refuse, []);
  assert.ok(!plan.unavailable.some(line => line.includes("installation or recovery")), plan.stdout);
});

test("several conflicts are all listed, where --tv would stop at the first", rootOptions, () => {
  using environment = fixture({ installed: packages, account: "/home/couch-tv", displayManager: "/usr/sbin/gdm3", files: { "etc/systemd/system/couch-tv.service": "" } });
  const plan = inspect(environment);
  assert.equal(plan.status, 1);
  assert.equal(plan.refuse.length, 3, plan.stdout);
  assert.match(environment.run("--tv", true).stderr, /couch-setup: The existing couch-tv account/);
});

test("without root, inspection reports what only root can read as unavailable", options, () => {
  using environment = fixture({ installed: packages, files: { "var/lib/couch/.keep": "" } });
  chmodSync(join(environment.root, "var/lib/couch"), 0);
  try {
    const plan = inspect(environment, false);
    assert.equal(plan.status, 0, plan.stdout + plan.stderr);
    assert.match(plan.stdout, /Runtime account couch-tv: unknown/);
    for (const line of ["Run with sudo to read what only root can.", "Whether the couch-tv account is locked", "Whether /var/lib/couch/.config/systemd/user/couch-tv.service exists", "Whether the Couch TV app is running"]) assert.ok(plan.unavailable.includes(line), `${line}\n${plan.stdout}`);
  } finally { chmodSync(join(environment.root, "var/lib/couch"), 0o755); }
});

test("--tv and --refresh still require root, and --refresh leaves an incomplete setup alone", rootOptions, () => {
  using environment = fixture({ installed: packages });
  for (const argument of ["--tv", "--refresh"]) assert.match(environment.run(argument, false).stderr, /couch-setup: sudo couch-setup --tv/);
  const refresh = environment.run("--refresh", true);
  assert.equal(refresh.status, 0);
  assert.match(refresh.stdout, /nothing to refresh/);
  assert.doesNotMatch(refresh.events, mutating);
});

test("--refresh adds only missing packages and non-policy files to a completed setup", rootOptions, () => {
  using environment = fixture({ installed: packages.slice(1), state: "complete", account: "/var/lib/couch" });
  const refreshed = environment.run("--refresh", true);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.match(refreshed.events, new RegExp(`^apt-get install --yes --no-install-recommends ${packages[0]}$`, "m"));
  assert.ok(!existsSync(join(environment.root, "etc/lightdm")), "Refresh never adds sign-in policy");
  assert.ok(lstatSync(join(environment.root, "usr/sbin/couch-session")).isSymbolicLink());
  assert.doesNotMatch(refreshed.events, /^(adduser|systemctl set-default|systemctl enable lightdm)/m);
});
