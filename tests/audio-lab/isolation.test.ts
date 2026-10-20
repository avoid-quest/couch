import { expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wrapper = resolve("scripts/live-audio-lab.sh");
const fixture = resolve("tests/audio-lab/isolation-fixture.py");
const run = (...command: string[]) => spawnSync("bash", [wrapper, "--", ...command], { encoding: "utf8", timeout: 10_000 });
const available = run("true");
const isolatedTest = available.status === 0 ? test : test.skip;
if (available.status !== 0) console.warn(`IPC isolation prerequisite unavailable (not coverage): ${available.stderr}`);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const identity = (path: string) => { const stat = statSync(path); return { device: stat.dev, inode: stat.ino }; };

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "couch-ipc-test-"));
  return { root, [Symbol.dispose]() { rmSync(root, { recursive: true, force: true }); } };
}

async function ready(path: string, process: ChildProcess) {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (process.exitCode !== null || process.signalCode !== null || Date.now() > deadline) {
      throw new Error("isolation fixture did not become ready");
    }
    await Bun.sleep(20);
  }
}

function exited(process: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("isolation launcher did not exit")), 6000);
    process.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function assertClean(root: string) {
  // A killed unshare can be reaped just before the kernel finishes killing PID 1.
  await Bun.sleep(100);
  const heartbeat = readFileSync(join(root, "heartbeat"), "utf8");
  await Bun.sleep(100);
  expect(readFileSync(join(root, "heartbeat"), "utf8")).toBe(heartbeat);
  const pidns = json(join(root, "isolation.json")).namespaces.pid;
  for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
    try { expect(readlinkSync(`/proc/${pid}/ns/pid`)).not.toBe(pidns); }
    catch (error: any) { if (!["ENOENT", "EACCES"].includes(error.code)) throw error; }
  }
}

test("invalid invocation and unisolated network manifests fail closed", () => {
  expect(spawnSync("bash", [wrapper], { encoding: "utf8" }).status).toBe(2);
  for (const env of [{ COUCH_NETWORK_MANIFEST: "/not-a-real-manifest" }, { COUCH_LAB_IPC: "{}" }]) {
    const result = spawnSync("bash", [wrapper, "--", "true"], { encoding: "utf8", env: { ...process.env, ...env } });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must establish|invalid COUCH_LAB_IPC/);
  }
});

isolatedTest("standalone networking allows loopback TCP and has no external interface or route", () => {
  using files = scratch();
  const hostNetns = readlinkSync("/proc/self/ns/net");
  const hostLinks = () => spawnSync("ip", ["-j", "link"], { encoding: "utf8" }).stdout;
  const hostRoutes = () => spawnSync("ip", ["-j", "route", "show", "table", "all"], { encoding: "utf8" }).stdout;
  const links = hostLinks(), routes = hostRoutes();
  const result = run("python3", fixture, "network", files.root, hostNetns);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readlinkSync("/proc/self/ns/net")).toBe(hostNetns);
  expect(hostLinks()).toBe(links);
  expect(hostRoutes()).toBe(routes);
});

isolatedTest("each run gets an empty private registry shared by children without nested PID namespaces", () => {
  const hostShm = identity("/dev/shm");
  const hostRegistry = existsSync("/dev/shm/jack-shm-registry") ? identity("/dev/shm/jack-shm-registry") : null;
  for (let index = 0; index < 4; index++) {
    using files = scratch();
    const result = run("python3", fixture, "probe", files.root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const metadata = json(join(files.root, "isolation.json"));
    expect(metadata.schema).toBe("couch-lab-ipc/1");
    expect(metadata.origin).toBe("standalone");
    expect(metadata.shm.device).not.toBe(hostShm.device);
    expect(metadata.host.shm).toEqual({ path: "/dev/shm", ...hostShm });
    for (const key of ["user", "mount", "ipc", "pid"]) {
      expect(metadata.namespaces[key]).not.toBe(metadata.host.namespaces[key]);
    }
    expect(json(join(files.root, "child.json"))).toEqual(metadata);
    const stale = spawnSync("bash", [wrapper, "--", "true"], {
      encoding: "utf8", env: { ...process.env, COUCH_LAB_IPC: JSON.stringify(metadata) },
    });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("stale or invalid COUCH_LAB_IPC");
    const outside = spawnSync("python3", [resolve("tests/audio-lab/isolation.py"), "_inside", "true"], {
      encoding: "utf8", env: { ...process.env, COUCH_LAB_IPC_HOST: JSON.stringify(metadata.host) },
    });
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("refusing shared-memory setup outside");
    expect(identity("/dev/shm")).toEqual(hostShm);
    expect(existsSync("/dev/shm/jack-shm-registry") ? identity("/dev/shm/jack-shm-registry") : null).toEqual(hostRegistry);
  }
});

isolatedTest("success and failure kill detached children that ignore TERM, preserving command exit status", async () => {
  for (const mode of ["exit", "fail"]) {
    using files = scratch();
    const result = run("python3", fixture, mode, files.root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(mode === "fail" ? 17 : 0);
    await assertClean(files.root);
  }
});

isolatedTest("standalone PID 1 reaps adopted helpers while preserving command status", () => {
  for (const code of [0, 17]) {
    using files = scratch();
    const result = run("python3", fixture, "orphans", files.root, String(code));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(code);
    expect(json(join(files.root, "reaped.json"))).toHaveLength(24);
  }
}, 15_000);

isolatedTest("TERM, INT and KILL tear down the entire private PID namespace", async () => {
  const unrelated = spawn("sleep", ["60"]);
  try {
    for (const signal of ["SIGTERM", "SIGINT", "SIGKILL"] as const) {
      using files = scratch();
      const child = spawn("bash", [wrapper, "--", "python3", fixture, "linger", files.root], { stdio: "ignore" });
      try {
        await ready(join(files.root, "heartbeat"), child);
        const done = exited(child);
        child.kill(signal);
        await done;
        expect(child.exitCode ?? child.signalCode).toBe(signal === "SIGKILL" ? "SIGKILL" : signal === "SIGTERM" ? 143 : 130);
        await assertClean(files.root);
        expect(unrelated.exitCode).toBeNull();
      } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    }
  } finally { unrelated.kill(); }
}, 25_000);

isolatedTest("death of the calling process kills its wrapper and stubborn descendants", async () => {
  using files = scratch();
  const caller = spawn("python3", ["-c", "import subprocess,sys,time; subprocess.Popen(sys.argv[1:]); time.sleep(60)",
    "bash", wrapper, "--", "python3", fixture, "linger", files.root], { stdio: "ignore" });
  try {
    await ready(join(files.root, "heartbeat"), caller);
    const done = exited(caller);
    caller.kill("SIGKILL");
    await done;
    await assertClean(files.root);
  } finally { if (caller.exitCode === null && caller.signalCode === null) caller.kill("SIGKILL"); }
}, 10_000);
