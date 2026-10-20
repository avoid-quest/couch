import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runner = resolve("scripts/live-audio-network.sh");
const fixture = resolve("tests/audio-lab/network-fixture.py");
const run = (...args: string[]) => spawnSync("bash", [runner, ...args], { encoding: "utf8", timeout: 40_000 });
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const available = run("check");
const networkTest = available.status === 0 ? test : test.skip;
if (available.status !== 0) console.warn(`Network integration prerequisite unavailable (not coverage): ${available.stderr}`);

test("profiles preserve one-way parameters, independent seeds and a shared cap", () => {
  const mild = JSON.parse(run("plan", "--profile", "N1", "--clients", "2", "--seed", "70", "--up-kbps", "4000").stdout);
  expect(mild.sharedDownKbps).toBe(20000);
  expect(mild.sharedUpKbps).toBe(4000);
  expect(mild.clients.map((client: any) => client.delayMsEachDirection)).toEqual([5, 5]);
  expect(mild.clients.map((client: any) => client.lossPercentEachDirection)).toEqual([0.1, 0.1]);
  expect(new Set(mild.clients.flatMap((client: any) => [client.downSeed, client.upSeed])).size).toBe(4);
  const bad = JSON.parse(run("plan", "--profile", "N2", "--bad-client", "2").stdout);
  expect(bad.clients.map((client: any) => client.capKbpsEachDirection)).toEqual([null, 128]);
  expect(bad.clients.map((client: any) => client.delayMsEachDirection)).toEqual([2, 60]);
  const control = JSON.parse(run("plan", "--profile", "control").stdout);
  expect(control.sharedDownKbps).toBeNull();
  expect(control.sharedUpKbps).toBeNull();
});

test("invalid, unbounded and unsupported requests fail before launching", () => {
  for (const args of [
    ["--clients", "0"], ["--clients", "101"], ["--duration", "0"], ["--duration", "7201"],
    ["--queue-packets", "0"], ["--seed", "0"], ["--profile", "N3"], ["--bad-client", "3"],
    ["--cpu-list", "999999"], ["--up-kbps", "0"], ["--max-processes", "0"],
  ]) expect(run("plan", ...args).status).toBe(2);
  expect(run("run").status).toBe(2);
  expect(run("plan", "--", "true").status).toBe(2);
  const outside = spawnSync("python3", [resolve("tests/audio-lab/network.py"), "exec", "server", "--", "true"], {
    encoding: "utf8", env: { ...process.env, COUCH_NETWORK_MANIFEST: "" },
  });
  expect(outside.status).toBe(1);
  expect(outside.stderr).toContain("must run inside");
});

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "couch-network-test-"));
  return { root, evidence: join(root, "evidence"), [Symbol.dispose]() { rmSync(root, { recursive: true, force: true }); } };
}

function assertClean(evidence: string) {
  const ownership = json(join(evidence, "ownership.json"));
  expect(existsSync(ownership.scratch)).toBe(false);
  expect(existsSync(`/proc/${ownership.launcherHostPid}`)).toBe(false);
  // No process, including a setsid daemon, can keep a fixture namespace alive.
  const manifestPath = join(evidence, "manifest.json");
  if (existsSync(manifestPath)) {
    const pidns = json(manifestPath).pidNamespace;
    for (const pid of readdirSync("/proc").filter(name => /^\d+$/.test(name))) {
      try { expect(readlinkSync(`/proc/${pid}/ns/pid`)).not.toBe(pidns); }
      catch (error: any) { if (!["ENOENT", "EACCES"].includes(error.code)) throw error; }
    }
  }
}

networkTest("TCP and UDP cross both directions; ordinary host interfaces and qdiscs stay unchanged", () => {
  using files = scratch();
  const hostLinks = () => JSON.parse(spawnSync("ip", ["-j", "link"], { encoding: "utf8" }).stdout)
    .map(({ ifindex, ifname, address }: any) => ({ ifindex, ifname, address }));
  const hostQdiscs = () => {
    const result = spawnSync("tc", ["-j", "qdisc"], {
      encoding: "utf8", env: { ...process.env, PATH: `${process.env.PATH}:/usr/sbin:/sbin` },
    });
    expect(result.status).toBe(0);
    return result.stdout;
  };
  const links = hostLinks(), qdiscs = hostQdiscs();
  const result = run("verify", "--profile", "N1", "--duration", "30", "--evidence", files.evidence);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const report = json(join(files.evidence, "network.json"));
  expect(report.status).toBe("network-verified");
  expect(report.verification).toHaveLength(4);
  for (const sample of report.verification) {
    expect(sample.echoes).toBeGreaterThan(0);
    expect(Object.values(sample.qdiscPacketDeltas).every(value => Number(value) > 0)).toBe(true);
  }
  for (const node of Object.values(json(join(files.evidence, "before.json"))) as any[]) {
    expect(node.routes.some((route: any) => route.dst === "default")).toBe(false);
    expect(node.links.flatMap((link: any) => link.addr_info).some((address: any) => address.family === "inet6")).toBe(false);
  }
  expect(hostLinks()).toEqual(links);
  expect(hostQdiscs()).toBe(qdiscs);
  assertClean(files.evidence);
  expect(run("verify", "--evidence", files.evidence).status).toBe(1);
}, 40_000);

networkTest("the public exec contract isolates applications and rejects an unexercised client path", () => {
  using files = scratch();
  const result = run("run", "--duration", "30", "--evidence", files.evidence, "--", "python3", fixture);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const report = json(join(files.evidence, "network.json"));
  expect(report.applicationTraffic).toHaveLength(2);
  const first = json(join(files.evidence, "client-1.json"));
  const second = json(join(files.evidence, "client-2.json"));
  expect(first.netns).not.toBe(second.netns);
  expect(first.ipc).toEqual(second.ipc);
  expect(first.ipc).toEqual(report.ipc);
  expect(first.ipc.origin).toBe("network");
  expect(first.ipc.namespaces.pid).toBe(json(join(files.evidence, "manifest.json")).pidNamespace);
  expect(first.data).not.toBe(second.data);
  expect(existsSync(first.data)).toBe(false);
  expect(existsSync(second.data)).toBe(false);
  expect(Number(first.port)).toBeGreaterThan(0);
  expect(readFileSync(join(files.evidence, "processes.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
  assertClean(files.evidence);
  using bypass = scratch();
  const unused = run("run", "--duration", "30", "--evidence", bypass.evidence, "--", "true");
  expect(unused.status).toBe(1);
  expect(unused.stderr).toContain("no bidirectional application traffic proved");
  assertClean(bypass.evidence);
}, 40_000);

networkTest("failure and timeout kill daemonized descendants without killing an unrelated process", async () => {
  const unrelated = spawn("sleep", ["60"]);
  try {
    for (const mode of ["fail", "linger"]) {
      using files = scratch();
      const result = run("run", "--clients", "1", "--duration", "5", "--evidence", files.evidence,
        "--", "python3", fixture, mode);
      expect(result.status).toBe(mode === "fail" ? 1 : 124);
      const heartbeat = readFileSync(join(files.evidence, "heartbeat"), "utf8");
      await Bun.sleep(150);
      expect(readFileSync(join(files.evidence, "heartbeat"), "utf8")).toBe(heartbeat);
      expect(unrelated.exitCode).toBeNull();
      assertClean(files.evidence);
    }
  } finally { unrelated.kill(); }
}, 25_000);

networkTest("a process-limit breach reports worker saturation and cleans up", () => {
  using files = scratch();
  const result = run("run", "--clients", "1", "--max-processes", "16", "--duration", "20",
    "--evidence", files.evidence, "--", "python3", fixture, "process-limit");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("worker resource limit exceeded");
  expect(result.stderr).toContain("inconclusive");
  expect(json(join(files.evidence, "network.json")).status).toBe("inconclusive");
  assertClean(files.evidence);
}, 25_000);

networkTest("network PID 1 reaps adopted helpers without consuming the process budget or losing command status", () => {
  for (const mode of ["reap", "reap-fail"]) {
    using files = scratch();
    const result = run("run", "--clients", "1", "--max-processes", "16", "--duration", "20",
      "--evidence", files.evidence, "--", "python3", fixture, mode);
    expect(result.status).toBe(mode === "reap" ? 0 : 1);
    const report = json(join(files.evidence, "network.json"));
    expect(report.commandExitCode).toBe(mode === "reap" ? 0 : 17);
    expect(report.resourcesObserved.peakProcesses).toBeLessThanOrEqual(16);
    expect(json(join(files.evidence, "reaped.json"))).toHaveLength(24);
    assertClean(files.evidence);
  }
}, 30_000);

networkTest("control accounts for each client uplink independently", () => {
  using full = scratch();
  const passed = run("run", "--profile", "control", "--duration", "20", "--evidence", full.evidence,
    "--", "python3", fixture);
  expect(passed.stderr).toBe("");
  expect(passed.status).toBe(0);
  assertClean(full.evidence);
  using oneWay = scratch();
  const rejected = run("run", "--profile", "control", "--duration", "20", "--evidence", oneWay.evidence,
    "--", "python3", fixture, "downstream-only");
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain("no bidirectional application traffic proved for client-2");
  const clients = json(join(oneWay.evidence, "network.json")).applicationTraffic;
  expect(Object.values(clients[0].qdiscPacketDeltas).every(value => Number(value) > 0)).toBe(true);
  expect(clients[1].qdiscPacketDeltas["access/down2/10:"]).toBeGreaterThan(0);
  expect(clients[1].qdiscPacketDeltas["router/source0/egress/client-2"]).toBe(0);
  assertClean(oneWay.evidence);
}, 30_000);

for (const phase of ["function", "helper"]) test(`caller death during prerequisite ${phase} stops owned processes`, async () => {
  using files = scratch();
  const ready = join(files.root, "preflight-pid");
  const caller = spawn("python3", ["-c", "import subprocess,sys,time; subprocess.Popen(sys.argv[1:]); time.sleep(30)",
    "python3", fixture, "preflight", ready, phase], { stdio: "ignore" });
  let pids: number[] = [];
  const running = (pid: number) => {
    try { return !/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, "utf8")); }
    catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
  };
  try {
    const until = Date.now() + 3000;
    while (!existsSync(ready) && Date.now() < until) await Bun.sleep(10);
    expect(existsSync(ready)).toBe(true);
    pids = Object.values(json(ready));
    const exited = new Promise<void>(resolve => caller.once("exit", () => resolve()));
    caller.kill("SIGKILL");
    await exited;
    const deadline = Date.now() + 1000;
    while (pids.some(running) && Date.now() < deadline) await Bun.sleep(10);
    expect(pids.some(running)).toBe(false);
  } finally {
    for (const pid of pids) if (running(pid)) {
      try { process.kill(pid, "SIGKILL"); }
      catch (error: any) { if (error.code !== "ESRCH") throw error; }
    }
    if (caller.exitCode === null && caller.signalCode === null) caller.kill("SIGKILL");
  }
}, 5000);
