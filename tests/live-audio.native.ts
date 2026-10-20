// Linux lab: bun tests/live-audio.native.ts calibration|direct|sync|ingress [artifact directory]
// Requires JACK2, PulseAudio + JACK modules, libjack headers, cc, and built Couch.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { createServer } from "node:net";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import electron from "electron";
import { Identity } from "@sonn-audio/node-sendspin";
import { createMarkerSignal, createPcmAnalyzer } from "./audio-lab/pcm";
import { writeEvidence, writeLiveAudioEvidence } from "./evidence";
import { assessGraphCalibration } from "./audio-lab/calibration";

const root = resolve(import.meta.dirname, "..");
assert.equal(process.platform, "linux", "The common-graph audio lab currently requires Linux");
// JACK's server registry is shared even when server names differ. Enter a
// disposable IPC/mount/PID namespace before creating any audio resources.
if (!process.env.COUCH_LAB_IPC) {
  assert(!process.env.COUCH_NETWORK_MANIFEST, "Network runner must provide private audio IPC; do not nest its PID namespace");
  const child = spawn("bash", [join(root, "scripts/live-audio-lab.sh"), "--", process.execPath, ...process.argv.slice(1)], { stdio: "inherit" });
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), 300_000);
  const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143))); });
  clearTimeout(timer);
  process.exit(code);
}
const ipc = JSON.parse(process.env.COUCH_LAB_IPC);
assert.equal(ipc.schema, "couch-lab-ipc/1");
const shm = statSync("/dev/shm");
assert.equal(ipc.shm.device, shm.dev); assert.equal(ipc.shm.inode, shm.ino);
assert.notEqual(ipc.shm.device, ipc.host.shm.device, "Lab shared memory must be a private mount");
for (const name of ["user", "mount", "ipc", "pid"]) {
  assert.equal(ipc.namespaces[name], readlinkSync(`/proc/self/ns/${name === "mount" ? "mnt" : name}`));
  assert.notEqual(ipc.namespaces[name], ipc.host.namespaces[name], `Lab ${name} namespace must be private`);
}
const mode = process.argv[2] ?? "calibration";
assert(["calibration", "direct", "sync", "ingress"].includes(mode), "Choose calibration, direct, sync or ingress");
const directory = process.argv[3] ? resolve(process.argv[3]) : mkdtempSync(join(tmpdir(), "couch-live-audio-"));
if (process.argv[3]) mkdirSync(directory, { mode: 0o700 }); // Never reuse data, profiles or PID files.
const receivers = mode === "calibration" ? 3 : Number(process.env.COUCH_LAB_RECEIVERS ?? 2);
const seconds = Number(process.env.COUCH_LAB_SECONDS ?? 15), seed = Number(process.env.COUCH_LAB_SEED ?? 20261020);
assert(Number.isInteger(receivers) && receivers >= 1 && receivers <= 100);
assert(Number.isInteger(seconds) && seconds >= 5 && seconds <= 120, "Bounded lab run: 5–120 seconds");
const rate = 48000, durationFrames = seconds * rate, tailFrames = (mode === "sync" ? 8 : 1) * rate;
const quantum = Number(process.env.COUCH_LAB_QUANTUM ?? 128);
assert([128, 256, 512, 1024].includes(quantum));
const packetMs = Number(process.env.COUCH_LAB_PACKET_MS ?? 10), leadMs = Number(process.env.COUCH_LAB_LEAD_MS ?? 40);
const outputCompensation = process.env.COUCH_LAB_OUTPUT_COMPENSATION !== "0";
const jitterBufferTargetMs = process.env.COUCH_LAB_JITTER_MS === undefined ? null : Number(process.env.COUCH_LAB_JITTER_MS);
if (jitterBufferTargetMs !== null) assert(mode === "direct" && Number.isInteger(jitterBufferTargetMs) && jitterBufferTargetMs >= 0 && jitterBufferTargetMs <= 4000);
if (mode === "ingress") { assert.equal(receivers, 2, "PCM experiment has exactly two receivers"); assert([10, 20].includes(packetMs)); assert(leadMs >= packetMs && leadMs <= 1000); }
const ids = Array.from({ length: receivers }, (_, index) => `receiver-${index}`);
type NetworkManifest = {
  schema: string; port: number; serverUrl: string; exec: string[];
  nodes: Record<string, { pid: number; netns: string; dataDirectory: string }>;
  profile: { profile: string; seed: number; clients: { name: string; address: string }[] };
};
const network: NetworkManifest | null = process.env.COUCH_NETWORK_MANIFEST
  ? JSON.parse(readFileSync(process.env.COUCH_NETWORK_MANIFEST, "utf8")) : null;
assert(mode !== "direct" || network, "Direct WebRTC needs the network wrapper (profile control or N0): offline loopback alone has no usable ICE host interface");
if (network) {
  assert.equal(network.schema, "couch-network-lab/1");
  assert.notEqual(mode, "calibration", "Graph calibration has no network traffic; run it without netem");
  assert.notEqual(mode, "ingress", "The PCM prototype has no TLS listener; first measure it on secure localhost, without a mixed-content bypass");
  assert.equal(network.profile.clients.length, receivers, "Namespace and browser receiver counts must match");
}
const inNode = (node: string, args: string[]) => network ? [...network.exec, node, "--", ...args] : args;
const prefix = process.env.COUCH_LAB_PREFIX;
const bin = (name: string) => prefix ? join(prefix, "bin", name) : name;
const { ELECTRON_RUN_AS_NODE: _electronNode, DBUS_SESSION_BUS_ADDRESS: _dbus, ...inherited } = process.env;
const env = { ...inherited, JACK_DEFAULT_SERVER: `couch-lab-${process.pid}`, PULSE_SERVER: `unix:${directory}/pulse/native`,
  DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${directory}/no-system-bus`,
  PULSE_RUNTIME_PATH: join(directory, "pulse"), PULSE_STATE_PATH: join(directory, "pulse-state"),
  PULSE_COOKIE: join(directory, "pulse-cookie"), PULSE_CLIENTCONFIG: join(directory, "pulse-client.conf"),
  XDG_CONFIG_HOME: join(directory, "config"), XDG_DATA_HOME: join(directory, "xdg-data"),
  XDG_CACHE_HOME: join(directory, "cache"), XDG_RUNTIME_DIR: join(directory, "runtime"),
  ...(prefix ? { JACK_DRIVER_DIR: join(prefix, "lib/x86_64-linux-gnu/jack"), LD_LIBRARY_PATH: [join(prefix, "lib/x86_64-linux-gnu"), join(prefix, "lib/x86_64-linux-gnu/pulseaudio"), join(prefix, "lib/pulse-17.0+dfsg1/modules"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : {}),
};
const processes: ChildProcess[] = [], logs = new Map<ChildProcess, string>();
const processNames = new Map<ChildProcess, string>();
let fatal: Error | null = null, ending = false;
const appendLog = (name: string, value: string) => {
  const path = join(directory, `${name}.log`);
  let previous = "";
  try { previous = readFileSync(path, "utf8"); } catch {}
  writeFileSync(path, (previous + value).slice(-128_000));
};
const launch = (name: string, args: string[], extra: NodeJS.ProcessEnv = {}, node?: string) => {
  const command = node ? inNode(node, args) : args;
  const child = spawn(command[0]!, command.slice(1), { cwd: root, env: { ...env, ...extra }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  processes.push(child); logs.set(child, "");
  processNames.set(child, name);
  if (child.pid) writeFileSync(join(directory, `${name}.pid`), String(child.pid));
  const log = (value: Buffer) => {
    const text = (logs.get(child)! + value.toString()).slice(-128_000); logs.set(child, text);
    writeFileSync(join(directory, `${name}.log`), text);
  };
  child.stderr!.on("data", log);
  child.on("error", error => { log(Buffer.from(String(error))); if (!ending) fatal ??= new Error(`${name}: ${error}`); });
  child.on("exit", (code, signal) => {
    if (!ending && name !== "graph") fatal ??= new Error(`${name} exited unexpectedly (${code ?? signal}); ${logs.get(child)!.slice(-2000)}`);
  });
  child.stdin!.on("error", error => { if (!ending) fatal ??= new Error(`${name} stdin: ${error}`); });
  if (name !== "graph" && !name.startsWith("browser-")) child.stdout!.on("data", log);
  return child;
};
const until = async (test: () => boolean | Promise<boolean>, label: string, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (true) {
    if (fatal) throw fatal;
    if (await test()) return;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(50);
  }
};
const command = (args: string[], timeout = 15_000, input?: string) => {
  const result = spawnSync(args[0]!, args.slice(1), { env, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 1_048_576, input });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr || result.error}`);
  return result.stdout;
};
const readyCommand = (args: string[]) => {
  const result = spawnSync(args[0]!, args.slice(1), { env, encoding: "utf8", timeout: 2000, killSignal: "SIGKILL", maxBuffer: 32_768 });
  if (result.error) throw new Error(`${args[0]} readiness failed: ${result.error}; ${result.stderr}`);
  return result.status === 0;
};
const clockTicks = Number(command(["getconf", "CLK_TCK"], 2000));
const pageSize = Number(command(["getconf", "PAGESIZE"], 2000));
const resources = { sampleCount: 0, cpuCount: availableParallelism(), cpuPercentMax: 0, rssBytesMax: 0,
  perProcessGroup: {} as Record<string, { cpuPercentMax: number; rssBytesMax: number }>,
  convention: "CPU percent of one logical CPU; RSS sums processes and can double-count shared pages; 1-second samples" };
let previousSample = performance.now(), previousOwnCpu = process.cpuUsage();
const previousTicks = new Map<string, number>();
const observedDescendants = new Map<number, string>();
const processSnapshot = () => readdirSync("/proc").filter(pid => /^\d+$/.test(pid)).flatMap(pid => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return [{ pid: Number(pid), parent: Number(fields[1]), group: Number(fields[2]), ticks: Number(fields[11]) + Number(fields[12]), start: fields[19]!, rss: Number(fields[21]) * pageSize }];
  } catch { return []; }
});
const sampleResources = () => {
  const now = performance.now(), elapsed = now - previousSample;
  const all = processSnapshot(), owned = new Set(processes.flatMap(child => child.pid ? [child.pid] : []));
  for (let changed = true; changed;) {
    changed = false;
    for (const item of all) if (owned.has(item.parent) && !owned.has(item.pid)) { owned.add(item.pid); changed = true; }
  }
  const totals = new Map<string, { ticks: number; rss: number }>();
  for (const item of all) {
    const child = processes.find(child => child.pid === item.group);
    if (!child && !owned.has(item.pid) && observedDescendants.get(item.pid) !== item.start) continue;
    observedDescendants.set(item.pid, item.start);
    const name = child ? processNames.get(child)! : "other-owned-descendants";
    const value = totals.get(name) ?? { ticks: 0, rss: 0 };
    const key = `${item.pid}:${item.start}`;
    if (previousTicks.has(key)) value.ticks += Math.max(0, item.ticks - previousTicks.get(key)!);
    previousTicks.set(key, item.ticks);
    value.rss += item.rss; totals.set(name, value);
  }
  const ownCpu = process.cpuUsage(), ownRss = process.memoryUsage().rss;
  let cpu = (ownCpu.user + ownCpu.system - previousOwnCpu.user - previousOwnCpu.system) / (elapsed * 10), rss = ownRss;
  for (const [name, value] of totals) {
    const percent = value.ticks / clockTicks / (elapsed / 1000) * 100;
    const previous = resources.perProcessGroup[name] ?? { cpuPercentMax: 0, rssBytesMax: 0 };
    resources.perProcessGroup[name] = { cpuPercentMax: Math.max(previous.cpuPercentMax, percent), rssBytesMax: Math.max(previous.rssBytesMax, value.rss) };
    cpu += percent; rss += value.rss;
  }
  resources.cpuPercentMax = Math.max(resources.cpuPercentMax, cpu);
  resources.rssBytesMax = Math.max(resources.rssBytesMax, rss);
  resources.sampleCount++; previousSample = now; previousOwnCpu = ownCpu;
};
const resourceTimer = setInterval(sampleResources, 1000);
const signalOwned = (signal: NodeJS.Signals) => {
  for (const child of [...processes].reverse()) if (child.pid) {
    try { process.kill(-child.pid, signal); } catch (error: any) { if (error.code !== "ESRCH") throw error; }
  }
  for (const item of processSnapshot()) if (observedDescendants.get(item.pid) === item.start) {
    try { process.kill(item.pid, signal); } catch (error: any) { if (error.code !== "ESRCH") throw error; }
  }
};
let cleanupWork: Promise<void> | undefined;
const cleanup = () => cleanupWork ??= (async () => {
  ending = true;
  clearInterval(resourceTimer);
  sampleResources();
  signalOwned("SIGTERM");
  await Bun.sleep(500);
  signalOwned("SIGKILL");
  await Promise.race([Promise.all(processes.filter(child => child.exitCode === null && child.signalCode === null).map(child => new Promise(resolve => child.once("close", resolve)))), Bun.sleep(2000)]);
  for (let index = -1; index < receivers; index++) {
    rmSync(join(directory, `profile-${index}`), { recursive: true, force: true });
    rmSync(join(directory, `browser-${index}.json`), { force: true });
  }
})();
process.once("SIGINT", () => { void cleanup().then(() => process.exit(130)); });
process.once("SIGTERM", () => { void cleanup().then(() => process.exit(143)); });
const deadline = setTimeout(() => { void cleanup().then(() => process.exit(2)); }, (seconds + 150) * 1000);
try {
  for (const path of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_RUNTIME_DIR]) mkdirSync(path, { mode: 0o700 });
  writeFileSync(env.PULSE_COOKIE, randomBytes(256), { mode: 0o600 });
  writeFileSync(env.PULSE_CLIENTCONFIG, `autospawn = no\ndefault-server = ${env.PULSE_SERVER}\ncookie-file = ${env.PULSE_COOKIE}\n`, { mode: 0o600 });
  const native = join(directory, "graph");
  command(["cc", "-std=c11", "-D_DEFAULT_SOURCE", "-Wall", "-Wextra", "-Werror", "-O2", ...(prefix ? [`-I${prefix}/include`, `-L${prefix}/lib/x86_64-linux-gnu`] : []), "tests/live-audio-graph.c", "-ljack", "-o", native]);
  writeFileSync(join(directory, "source.f32"), Buffer.from(createMarkerSignal({ sampleRate: rate, seed }).render(0, durationFrames).buffer));
  const jack = launch("jack", [bin("jackd"), "--no-realtime", "--sync", "--name", env.JACK_DEFAULT_SERVER, "-d", "dummy", "-r", String(rate), "-p", String(quantum), "-w", String(Math.round(quantum / rate * 1e6))]);
  jack.stdout!.on("data", () => {});
  await until(() => readyCommand([bin("jack_lsp")]), "private JACK server");
  const graph = launch("graph", [native, join(directory, "source.f32"), mode === "calibration" ? "calibrate" : String(receivers), String(tailFrames)]);
  await until(() => logs.get(graph)!.includes("READY"), "graph recorder");
  const analyzer = createPcmAnalyzer({ sampleRate: rate, seed, receiverIds: ids, durationFrames, maxDelayMs: mode === "sync" ? 8000 : 1000,
    clockUncertaintyMs: 0, warmupFrames: mode === "calibration" ? 0 : 2 * rate,
    // At most 1,200 scheduled markers per bounded run; retain the actual sample
    // observations so later investigations need not reconstruct distributions.
    onMarker: observation => appendFileSync(join(directory, "markers.ndjson"), JSON.stringify(observation) + "\n") });
  let pending: Buffer = Buffer.alloc(0), frame = 0;
  const stride = (receivers + 1) * 4;
  graph.stdout!.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    // Fixed sample chunks keep analysis independent of pipe callback arrival.
    while (pending.length >= stride * 1024) {
      consume(pending.subarray(0, stride * 1024)); pending = pending.subarray(stride * 1024);
    }
  });
  function consume(bytes: Buffer) {
    const frames = bytes.length / stride;
    for (let channel = 0; channel <= receivers; channel++) {
      const samples = new Float32Array(frames);
      for (let at = 0; at < frames; at++) samples[at] = bytes.readFloatLE(at * stride + channel * 4);
      analyzer.push(channel === 0 ? "reference" : ids[channel - 1]!, { startFrame: frame, samples });
    }
    frame += frames;
  }
  let browserState: unknown = null;
  let ingressBefore: unknown = null, ingressAfter: unknown = null;
  const jitterPreferences: unknown[] = [];
  let snapshotIngress: (() => Promise<unknown>) | undefined;
  const browserDiagnostics: unknown[] = [];
  let rtcBefore: any[] = [], rtcAfter: any[] = [];
  const workers: { child: ChildProcess; js: (code: string, gesture?: boolean) => Promise<any>; id: string }[] = [];
  if (mode !== "calibration") {
    const moduleDir = process.env.COUCH_LAB_PULSE_MODULES ?? (prefix ? join(prefix, "lib/pulse-17.0+dfsg1/modules") : undefined);
    const pulseConfig = [
      `load-module module-native-protocol-unix socket=${directory}/pulse/native auth-cookie=${env.PULSE_COOKIE}`,
      "load-module module-jack-source source_name=capture client_name=couch_capture channels=1 connect=no",
      ...ids.map((_, index) => `load-module module-jack-sink sink_name=receiver_${index} client_name=couch_receiver_${index} channels=1 connect=no`),
      "set-default-source capture", "set-default-sink receiver_0",
    ].join("\n");
    writeFileSync(join(directory, "pulse.pa"), pulseConfig);
    mkdirSync(env.PULSE_RUNTIME_PATH, { recursive: true, mode: 0o700 });
    const pulse = launch("pulse", [bin("pulseaudio"), "--daemonize=no", "--exit-idle-time=-1", "--use-pid-file=no", "--high-priority=no", "--realtime=no", "--log-target=stderr", "-n", "-F", join(directory, "pulse.pa"), ...(moduleDir ? [`--dl-search-path=${moduleDir}`] : [])]);
    pulse.stdout!.on("data", () => {});
    await until(() => readyCommand([bin("pactl"), "info"]), "private PulseAudio server");
    const ports = command([bin("jack_lsp")]).trim().split("\n");
    const capture = ports.find(port => port.startsWith("couch_capture:")); assert(capture, ports.join("\n"));
    command([bin("jack_connect"), "couch_lab_source:source", capture]);
    for (let index = 0; index < receivers; index++) {
      const output = ports.find(port => port.startsWith(`couch_receiver_${index}:`)); assert(output);
      command([bin("jack_connect"), output, `couch_lab_record:input_${index + 1}`]);
    }
    let port = network?.port;
    if (!port) {
      const listener = createServer();
      await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
      const address = listener.address(); assert(address && typeof address === "object");
      port = address.port;
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
    const sourceOrigin = `http://127.0.0.1:${port}`;
    // Core's production LAN listener requires TLS. Trust exactly this scratch
    // Core's certificate in the fixture; do not disable certificate checks.
    const receiverOrigin = network ? network.serverUrl.replace(/^http:/, "https:") : sourceOrigin;
    const core = launch("core", ["node", "build/core.mjs"], { COUCH_DATA_DIR: join(directory, "data"), COUCH_PORT: String(port), COUCH_HOST: network ? "0.0.0.0" : "127.0.0.1",
      ...(process.env.COUCH_LAB_FFMPEG ? { PATH: `${dirname(process.env.COUCH_LAB_FFMPEG)}:${process.env.PATH}` } : {}) }, "server");
    core.stdout!.on("data", () => {});
    await until(() => /Pairing code: (\d+)/.test(logs.get(core)!), "scratch Couch Core", 60000);
    const pairingCode = /Pairing code: (\d+)/.exec(logs.get(core)!)![1];
    const certificatePin = network ? { hostname: new URL(receiverOrigin).hostname,
      fingerprint256: new X509Certificate(readFileSync(join(network.nodes.server!.dataDirectory, "tls/cert.pem"))).fingerprint256 } : null;
    const built = await Bun.build({ entrypoints: ["tests/live-audio-worker.ts"], target: "node", external: ["electron"], outdir: directory, naming: "live-audio-worker.mjs" });
    assert(built.success, String(built.logs));
    for (let index = -1; index < receivers; index++) {
      const key = Identity.generate(), name = index === -1 ? "Lab source" : `Lab receiver ${index}`;
      // Control HTTP lives in the server namespace too; stdin keeps admission
      // credentials out of argv and the network runner's command transcript.
      const pairing = { url: `${sourceOrigin}/api/pair`, code: pairingCode, id: key.peerId, name, origin: sourceOrigin };
      const paired = network ? JSON.parse(command(inNode("server", ["node", "--input-type=module", "-e", `
        import { readFileSync } from 'node:fs';
        const request = JSON.parse(readFileSync(0, 'utf8'));
        const response = await fetch(request.url, { method: 'POST', signal: AbortSignal.timeout(5000),
          headers: { 'Content-Type': 'application/json', Origin: request.origin },
          body: JSON.stringify({ code: request.code, id: request.id, name: request.name }) });
        if (!response.ok) throw new Error('Pairing HTTP ' + response.status);
        process.stdout.write(await response.text());
      `]), 7000, JSON.stringify(pairing))) : await (async () => {
        const response = await fetch(pairing.url, { method: "POST", signal: AbortSignal.timeout(5000), headers: { "Content-Type": "application/json", Origin: sourceOrigin }, body: JSON.stringify({ code: pairingCode, id: key.peerId, name }) });
        assert(response.ok, `Pairing HTTP ${response.status}`); return response.json();
      })();
      const origin = index === -1 ? sourceOrigin : receiverOrigin;
      const config = join(directory, `browser-${index}.json`);
      writeFileSync(config, JSON.stringify({ origin, name, key: key.privateB64u, token: paired.token, installationId: paired.installationId,
        certificatePin, profile: join(directory, `profile-${index}`) }), { mode: 0o600 });
      const child = launch(`browser-${index}`, [electron as unknown as string, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), join(directory, "live-audio-worker.mjs"), config],
        { PULSE_SOURCE: "capture", PULSE_SINK: `receiver_${Math.max(0, index)}` }, index === -1 ? "server" : `client-${index + 1}`);
      let ready = false, sequence = 0;
      const requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
      const rejectRequests = (reason: string) => {
        for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
        requests.clear();
      };
      child.once("exit", () => rejectRequests(`${name} exited during browser command`));
      child.once("error", error => rejectRequests(`${name}: ${error}`));
      createInterface({ input: child.stdout! }).on("line", line => {
        if (!line.startsWith("COUCH_LAB ")) { appendLog(`browser-${index}-stdout`, line + "\n"); return; }
        try {
          const message = JSON.parse(line.slice(10));
          if (message.ready) {
            ready = true;
            browserDiagnostics.push({ name, versions: message.versions, context: message.context, certificatePin });
            writeFileSync(join(directory, "browser-diagnostics.json"), JSON.stringify(browserDiagnostics, null, 2));
          }
          const request = requests.get(message.id);
          if (request) { requests.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(new Error(message.error)); else request.resolve(message.value); }
        } catch (error) { fatal ??= new Error(`${name}: invalid worker reply: ${error}`); rejectRequests(String(fatal)); }
      });
      const js = (code: string, gesture = false) => new Promise<any>((resolve, reject) => {
        if (fatal || child.exitCode !== null || child.signalCode !== null) { reject(fatal ?? new Error(`${name} is not running`)); return; }
        const id = ++sequence;
        const timer = setTimeout(() => { if (requests.delete(id)) reject(new Error(`Browser command timed out: ${code}`)); }, 15000);
        timer.unref();
        requests.set(id, { resolve, reject, timer });
        child.stdin!.write(JSON.stringify({ id, code, gesture }) + "\n");
      });
      await until(() => ready, name);
      await until(() => js("!!window.__labSession()?.connected"), `${name} authenticated`);
      workers.push({ child, js, id: key.peerId });
    }
    const publisher = workers[0]!;
    if (mode === "ingress") {
      const config = join(directory, "ingress.json");
      writeFileSync(config, JSON.stringify({ databasePath: join(directory, "data/couch.sqlite"), publisherId: publisher.id,
        receiverIds: workers.slice(1).map(worker => worker.id), allowedOrigins: [sourceOrigin], packetMs, leadMs }), { mode: 0o600 });
      const serverBundle = await Bun.build({ entrypoints: ["tests/audio-lab/ingress-cli.ts"], target: "node", outdir: directory, naming: "ingress-cli.mjs" });
      assert(serverBundle.success, String(serverBundle.logs));
      const browserBundle = await Bun.build({ entrypoints: ["tests/audio-lab/ingress-browser.ts"], target: "browser", format: "iife" });
      assert(browserBundle.success, String(browserBundle.logs));
      const ingress = launch("ingress", ["node", join(directory, "ingress-cli.mjs"), config]);
      let ingressOrigin: string | undefined, snapshotId = 0, response: { id: number; value: unknown } | undefined;
      createInterface({ input: ingress.stdout! }).on("line", line => {
        if (!line.startsWith("COUCH_INGRESS ")) return;
        const message = JSON.parse(line.slice("COUCH_INGRESS ".length));
        if (message.ready) ingressOrigin = message.origin;
        else if (message.error) fatal ??= new Error(message.error);
        else response = message;
      });
      await until(() => !!ingressOrigin, "authenticated PCM prototype");
      const browserCode = await browserBundle.outputs[0]!.text();
      for (const worker of workers) await worker.js(browserCode + "\n;true;");
      for (const worker of workers.slice(1)) await worker.js(`__ingressLab.receive({origin:${JSON.stringify(ingressOrigin)},requiredLeadTimeMs:10,minBufferMs:10,outputCompensation:${outputCompensation}}).then(value => {window.__ingressReceiver=value;return true;})`, true);
      await until(async () => (await Promise.all(workers.slice(1).map(worker => worker.js("__ingressReceiver.snapshot().timeSync.synced")))).every(Boolean), "both PCM receiver clocks synchronized");
      await publisher.js(`__ingressLab.publish({origin:${JSON.stringify(ingressOrigin)},packetMs:${packetMs}}).then(value => {window.__ingressPublisher=value;return true;})`, true);
      snapshotIngress = async () => {
        const id = ++snapshotId; ingress.stdin!.write(JSON.stringify({ id }) + "\n");
        await until(() => response?.id === id, "PCM prototype snapshot");
        return { server: response!.value, browsers: await Promise.all(workers.map(worker => worker.js("(window.__ingressPublisher ?? window.__ingressReceiver).snapshot()"))) };
      };
    } else {
    const source = await publisher.js("__labSession().startLive({ kind: 'microphone' }).then(source => ({ id: source.id }))", true);
    await publisher.js(`__labSession().run({type:'playLive',sourceId:${JSON.stringify(source.id)},deviceId:${JSON.stringify(workers[1]!.id)}})`);
    for (const worker of workers.slice(2)) await publisher.js(`__labSession().run({type:'output',deviceId:${JSON.stringify(worker.id)},level:100})`);
    if (mode === "sync") await publisher.js("__labSession().run({type:'inSync',inSync:true})");
    for (const worker of workers.slice(1)) await worker.js("(() => { for (const button of document.querySelectorAll('button')) if (/tap.*(play|sound)|enable.*sound/i.test(button.textContent)) button.click(); return true; })()", true);
    }
    if (jitterBufferTargetMs !== null) for (const worker of workers.slice(1)) {
      await until(() => worker.js("__labPeers.some(peer => peer.getReceivers().some(receiver => receiver.track?.kind === 'audio'))"), "WebRTC receiver before buffer preference");
      jitterPreferences.push(await worker.js(`__labPeers.flatMap(peer => peer.getReceivers()).filter(receiver => receiver.track?.kind === 'audio').map(receiver => {
        if (!('jitterBufferTarget' in receiver)) throw new Error('jitterBufferTarget is unavailable');
        const previous = receiver.jitterBufferTarget; receiver.jitterBufferTarget = ${jitterBufferTargetMs};
        return { previous, requested: ${jitterBufferTargetMs}, readback: receiver.jitterBufferTarget };
      })`));
    }
    const warmupEnd = Date.now() + (mode === "sync" ? 6000 : 2000);
    await until(() => Date.now() >= warmupEnd, "fixed browser startup wait");
    if (snapshotIngress) {
      ingressBefore = await snapshotIngress();
      writeFileSync(join(directory, "ingress-startup.json"), JSON.stringify(ingressBefore, null, 2));
      const startup = ingressBefore as { server: { publisherConnected: boolean; timeline: unknown } };
      assert(startup.server.publisherConnected && startup.server.timeline, "PCM source stopped or never established its timeline during setup; inspect ingress-startup.json");
    }
    browserState = await Promise.all(workers.map(worker => worker.js("({ state: __labSession().state, peers: __labPeers.map(peer => ({connectionState:peer.connectionState,iceConnectionState:peer.iceConnectionState})), media: [...document.querySelectorAll('audio,video')].map(element=>({paused:element.paused,readyState:element.readyState,muted:element.muted})) })")));
    rtcBefore = await Promise.all(workers.map(worker => worker.js("__labRTCStats()")));
  }
  graph.kill("SIGUSR1");
  await until(() => graph.exitCode !== null, "audio measurement", (seconds + tailFrames / rate + 15) * 1000);
  if (pending.length) { assert.equal(pending.length % stride, 0); consume(pending); }
  if (workers.length) rtcAfter = await Promise.all(workers.map(worker => worker.js("__labRTCStats()")));
  if (snapshotIngress) ingressAfter = await snapshotIngress();
  sampleResources();
  const analysis = analyzer.finish();
  const health = /RESULT frames=(\d+) overflow=(\d+) xruns=(\d+) graphDeviationUs=([\d.]+)/.exec(logs.get(graph)!);
  const graphHealth = { xruns: health ? Number(health[3]) : null, overflow: health ? health[2] !== "0" : null,
    graphDeviationUs: health ? Number(health[4]) : null, exitCode: graph.exitCode };
  const mediaPath = mode === "direct" ? ids.map((id, index) => {
    const before = (rtcBefore[index + 1] ?? []).flatMap((peer: any) => peer.media).filter((media: any) => media.type === "inbound-rtp" && media.kind === "audio");
    const after = (rtcAfter[index + 1] ?? []).flatMap((peer: any) => peer.media).filter((media: any) => media.type === "inbound-rtp" && media.kind === "audio");
    const receivedAudioBytes = after.reduce((total: number, media: any) => total + Math.max(0, (media.bytesReceived ?? 0) - (before.find((previous: any) => previous.id === media.id)?.bytesReceived ?? 0)), 0);
    const selectedPairs = (rtcAfter[index + 1] ?? []).flatMap((peer: any) => peer.selectedPairs);
    const serverAddress = network ? new URL(network.serverUrl).hostname : null;
    const routedPair = selectedPairs.some((pair: any) => pair.remote?.address === serverAddress && pair.local?.address !== "127.0.0.1");
    return { id, receivedAudioBytes, selectedPairs, shapedRouteObserved: network ? routedPair && receivedAudioBytes > 0 : null };
  }) : [];
  const calibration = mode === "calibration" ? assessGraphCalibration(analysis, { "receiver-0": 20, "receiver-1": 80, "receiver-2": 150 }, graphHealth) : null;
  const observedCodecs = [...new Set(rtcAfter.slice(1).flatMap(peers => peers.flatMap((peer: any) =>
    peer.media.filter((media: any) => media.type === "inbound-rtp" && media.kind === "audio")
      .map((media: any) => peer.codecs.find((codec: any) => codec.id === media.codecId)?.mimeType).filter(Boolean))))] as string[];
  const result = { mode, seed, receivers, seconds, sampleRate: rate, graphQuantumFrames: quantum, graphExit: graph.exitCode, calibration,
    jitterBufferPreference: { requestedMs: jitterBufferTargetMs, receivers: jitterPreferences, scope: "Browser preference only; readback does not prove actual occupancy or a maximum delay" },
    backend: { jackDriver: "dummy", jackRealtime: false, pulseRealtime: false, pulseHighPriority: false },
    ingress: mode === "ingress" ? { packetMs, leadMs, outputCompensation, before: ingressBefore, after: ingressAfter } : null,
    exploratory: true, graph: logs.get(graph), graphHealth, resources, ipc, network: network?.profile ?? null,
    browserSandboxDisabled: process.getuid?.() === 0,
    browserSandboxReason: process.getuid?.() === 0 ? "Electron native fixture running as root in the disposable user namespace" : null,
    rtc: { before: rtcBefore, after: rtcAfter, mediaPath },
    sourceToCaptureCorrectionMs: null, outputPresentationOffsetMs: null,
    sourceToCapture: "Included in raw latency: graph source to actual browser capture and graph output; separate capture/presentation calibration is unmeasured",
    timeline: "Source and outputs share sample indices; graphDeviationUs separately observes virtual-driver sample time versus JACK wall time", browserDiagnostics, browserState, analysis,
    untested: ["physical phone audio latency and speaker alignment", "Wi-Fi/radio contention", "mobile browsers", "stereo channel mapping", "output clocks on independent devices"] };
  writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2));
  process.env.COUCH_EVIDENCE = directory;
  await writeEvidence(`live-audio-${mode}`, { input: `Private PulseAudio/JACK dummy common graph; ${mode === "ingress" ? "test-only authenticated PCM prototype and official Sendspin renderer" : "production Couch"} in independent Electron processes`, measured: result, untested: result.untested });
  if (mode !== "calibration") await writeLiveAudioEvidence({
    evidenceKind: "virtual-output", input: "Recorded upstream source and downstream PulseAudio JACK output ports in one sample graph; mono",
    route: mode === "ingress" ? "test-only authenticated PCM / official Sendspin" : mode === "direct" ? "production WebRTC" : "production MediaRecorder/HLS/Sendspin",
    codec: { name: mode === "ingress" ? "pcm-s16le" : observedCodecs.length ? observedCodecs.join(", ") : null, packetDurationMs: mode === "ingress" ? packetMs : null },
    source: { count: 1, sampleRate: rate, channels: 1 }, receivers: { requested: receivers, admitted: workers.length - 1, activelyRendering: analysis.receivers.filter(receiver => receiver.detected > 0).length, excluded: 0 },
    network: { profile: network?.profile.profile ?? "unshaped-loopback", seed: network?.profile.seed ?? seed,
      quality: network?.profile.profile === "N1" ? "mild" : network?.profile.profile === "N2" ? "fault" : "clean",
      configuration: network ? { ...network.profile, evidenceDirectory: process.env.COUCH_NETWORK_EVIDENCE, mediaPath } : null },
    timeline: { basis: "shared-graph", clockMappingErrorMs: 0 },
    calibration: { method: "audio-graph", status: "unmeasured", sourceToCaptureMs: null, outputPresentationOffsetMs: null, uncertaintyMs: null, artifact: null },
    workers: [{ id: "local", cpuCount: resources.cpuCount, memoryBytes: totalmem(), cpuPercentMax: resources.cpuPercentMax,
      rssBytesMax: resources.rssBytesMax, overloaded: graphHealth.xruns ? true : null }],
    telemetry: ids.map(id => ({ id, rendererUnderruns: null, unexpectedMutes: null, disconnects: null, missingSourceMs: null, concealedSourceMs: null, longestInterruptionMs: null, queueAgeMsMax: null, queueBytesMax: null })),
    analysis, fixedWarmupMs: 2000, untested: [...result.untested, "browser-thread headroom; aggregate sampled CPU/RSS does not prove it", "source-to-capture calibration measured separately", "continuous codec/renderer dropout telemetry"],
  });
  console.log(`Audio lab ${mode}: ${join(directory, "result.json")}`);
  assert.equal(graph.exitCode, 0, "Invalid graph measurement: xrun, stalled recorder or overflow; inspect graph.log");
  if (mode === "direct") assert(mediaPath.every(receiver => receiver.receivedAudioBytes > 0), "Every WebRTC receiver must receive actual audio bytes during recording");
  if (network && mode === "direct") assert(mediaPath.every(receiver => receiver.shapedRouteObserved), "Real receiver RTP must increase on a selected candidate pair to the shaped server address; inspect result.json");
  if (calibration) assert.equal(calibration.status, "passed", JSON.stringify(calibration.reasons));
} catch (error) {
  writeFileSync(join(directory, "failure.json"), JSON.stringify({ status: "inconclusive", error: String(error),
    mode, seed, receivers, seconds, sampleRate: rate, graphQuantumFrames: quantum,
    packetMs, leadMs, outputCompensation, jitterBufferTargetMs, ipc, resources, network: network?.profile ?? null }, null, 2));
  throw error;
} finally { clearTimeout(deadline); await cleanup(); }
