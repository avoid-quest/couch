// Run only through scripts/live-audio-network.sh; see docs/live-audio-performance.md.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { monitorEventLoopDelay } from "node:perf_hooks";
import electron from "electron";
import { Identity } from "@sonn-audio/node-sendspin";
import { assessInboundCounters, totalObservedCounter } from "./audio-lab/rtc-counters";
import { createActivityMeasurement } from "./audio-lab/activity";

assert(process.env.COUCH_NETWORK_MANIFEST && process.env.COUCH_LAB_IPC, "Use the isolated network runner");
const network = JSON.parse(readFileSync(process.env.COUCH_NETWORK_MANIFEST, "utf8"));
const ipc = JSON.parse(process.env.COUCH_LAB_IPC);
assert.equal(network.schema, "couch-network-lab/1");
assert.equal(network.pidNamespace, readlinkSync("/proc/self/ns/pid"));
for (const name of ["user", "mount", "ipc", "pid"]) {
  assert.equal(ipc.namespaces[name], readlinkSync(`/proc/self/ns/${name === "mount" ? "mnt" : name}`));
  assert.notEqual(ipc.namespaces[name], ipc.host.namespaces[name]);
}
assert.equal(statSync("/dev/shm").dev, ipc.shm.device);
assert.notEqual(ipc.shm.device, ipc.host.shm.device);
const root = resolve(import.meta.dirname, ".."), directory = resolve(process.argv[2]!);
mkdirSync(directory, { mode: 0o700 });
const count = network.profile.clients.length, seconds = Number(process.env.COUCH_SCALE_SECONDS ?? 60);
const rounds = Number(process.env.COUCH_SCALE_ROUNDS ?? 3);
const tailSeconds = Number(process.env.COUCH_SCALE_TAIL_SECONDS ?? 0);
assert(Number.isInteger(seconds) && seconds >= 5 && seconds <= 3600);
assert(Number.isInteger(rounds) && rounds >= 0 && rounds <= 10);
assert(Number.isInteger(tailSeconds) && tailSeconds >= 0 && tailSeconds <= 3600);
const faultCounts = (process.env.COUCH_SCALE_FAULTS ?? `${Math.max(1, count - 1)},${count}`).split(",").map(Number);
assert(faultCounts.every(n => Number.isInteger(n) && n > 0 && n <= count));
const prefix = process.env.COUCH_LAB_PREFIX;
const bin = (name: string) => prefix ? join(prefix, "bin", name) : name;
const { ELECTRON_RUN_AS_NODE: _electronNode, DBUS_SESSION_BUS_ADDRESS: _dbus, ...inherited } = process.env;
const baseEnv: NodeJS.ProcessEnv = { ...inherited, DBUS_SYSTEM_BUS_ADDRESS: `unix:path=${directory}/no-system-bus`,
  ...(prefix ? { LD_LIBRARY_PATH: `${prefix}/lib/x86_64-linux-gnu:${prefix}/lib/x86_64-linux-gnu/pulseaudio:${prefix}/lib/pulse-17.0+dfsg1/modules` } : {}) };
const inNode = (node: string, args: string[]) => [...network.exec, node, "--", ...args];
const write = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2));
const log = (name: string, value: unknown) => appendFileSync(join(directory, name), JSON.stringify(value) + "\n");
const children: { name: string; child: ChildProcess; closed: boolean; code: number | null; signal: string | null }[] = [];
let fatal: Error | undefined, ending = false;
const launch = (name: string, args: string[], env = baseEnv, node?: string, raw = false) => {
  const argv = node ? inNode(node, args) : args;
  const child = spawn(argv[0]!, argv.slice(1), { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const record = { name, child, closed: false, code: null as number | null, signal: null as string | null }; children.push(record);
  let tail = "";
  const stderr = (data: Buffer) => { tail = (tail + data.toString()).slice(-64000); writeFileSync(join(directory, `${name}.log`), tail); };
  child.stderr!.on("data", stderr);
  if (!raw) child.stdout!.on("data", stderr);
  child.on("error", error => { fatal ??= error; });
  child.stdin!.on("error", error => { if (!ending) fatal ??= error; });
  child.once("close", (code, signal) => { Object.assign(record, { closed: true, code, signal }); if (!ending) fatal ??= new Error(`${name} exited: ${code ?? signal}; ${tail.slice(-1200)}`); });
  return { child, tail: () => tail };
};
const until = async (predicate: () => boolean | Promise<boolean>, label: string, timeout = 15000) => {
  const deadline = performance.now() + timeout;
  do { if (fatal) throw fatal; if (await predicate()) return; await Bun.sleep(100); } while (performance.now() < deadline);
  throw new Error(`Timed out: ${label}`);
};
const command = (args: string[], env = baseEnv, input?: string) => {
  const result = spawnSync(args[0]!, args.slice(1), { cwd: root, env, input, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.error}`); return result.stdout;
};
type Worker = { index: number; id: string; child: ChildProcess; request: (value: object) => Promise<any>; js: (code: string) => Promise<any> };
const workers: Worker[] = [], pulseEnvs: NodeJS.ProcessEnv[] = [];
type Output = { frames: number; windows: number; active: number; silent: number; invalid: number; clipped: number; lastActive: number; lastWindow: number; pending: number; sum: number; peak: number; carry: Buffer };
const outputs: Output[] = [];
let activityDeadline = 0;
let activityMeasurements: ReturnType<typeof createActivityMeasurement>[] | null = null;
const results: any = { schema: "couch-live-performance/2", startedAt: new Date().toISOString(), head: command(["git", "rev-parse", "HEAD"]).trim(),
  contract: { count, seconds, rounds, faultCounts, tailSeconds, warmupMs: 15000, observationMs: 5000, outputWindowFrames: 48000, minimumRms: .001, activityDrainMs: 1500,
    timing: "Harness monotonic observation time; PCM monitors have no source timestamps",
    recoveryAllocationMs: 5000, hardRecoveryTimeoutMs: 45000, fullOutagePlayAtMs: 8000, capture: "looping 30-second 440+997 Hz fake microphone", route: "production direct WebRTC", applicationAudioDefaults: process.env.COUCH_LAB_APP_AUDIO_DEFAULTS === "1", senderParameterReadback: "before-initial-warmup-only", qualified: false },
  hashes: Object.fromEntries(["tests/live-audio-scale.native.ts", "tests/live-audio-scale-worker.ts", "app/audio.ts", "build/core.mjs", "dist/index.html"].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  admissions: [], faults: [], stages: [], browserAudioBuffers: [], functionalPassed: false, telemetryComplete: false, qualified: false };
const resources: any[] = [];
let lastResourceAt = performance.now(), lastTicks = new Map<string, number>(), highCpuSince = 0;
const ticksPerSecond = Number(command(["getconf", "CLK_TCK"]));
const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
const sampleResources = () => {
  const now = performance.now(), elapsed = now - lastResourceAt;
  if (elapsed < 1000) return;
  let rss = 0, ticks = 0, processes = 0;
  const next = new Map<string, number>();
  for (const pid of readdirSync("/proc").filter(p => /^\d+$/.test(p))) try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8"), fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
    const key = `${pid}:${fields[19]}`, total = Number(fields[11]) + Number(fields[12]);
    next.set(key, total); if (lastTicks.has(key)) ticks += Math.max(0, total - lastTicks.get(key)!);
    rss += Number(fields[21]) * 4096; processes++;
  } catch {}
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))![1]) * 1024;
  const cpus = lastTicks.size ? ticks / ticksPerSecond / (elapsed / 1000) : null;
  const item = { at: Date.now(), elapsed, cpus, rss, processes, available, harnessEventLoopMaxMs: delay.max / 1e6 };
  resources.push(item); log("resources.jsonl", item); delay.reset(); lastResourceAt = now; lastTicks = next;
  highCpuSince = cpus !== null && cpus > (network.profile.resources.cpuAffinity?.length ?? 16) * .8 ? highCpuSince || now : 0;
  if (available < 8 * 1024 ** 3 || highCpuSince && now - highCpuSince > 30000) fatal ??= new Error("Worker resource guard: inconclusive");
};
const resourceTimer = setInterval(sampleResources, 2000);
const snapshot = async (label: string, includeSenderParameters = false) => {
  const values = await Promise.all(workers.map(async worker => ({ index: worker.index, value: await worker.js(`__scale.snapshot(${includeSenderParameters})`) })));
  log("observations.jsonl", { at: Date.now(), label, values });
  for (const { index, value } of values) {
    assert.equal(value.omitted, 0, `receiver ${index}: telemetry truncation`);
    assert.deepEqual(value.errors, [], `receiver ${index}: browser errors`);
  }
  return values.map(item => item.value);
};
const activePeer = (state: any, first = 0) => state?.peers.findLast((peer: any) => peer.index >= first && peer.state === "connected" && peer.stats.some((s: any) => s.type === "inbound-rtp" && s.bytesReceived > 0));
const steady = async (label: string, duration: number) => {
  const before = await snapshot(label + "-before"), start = performance.now();
  const firstFrames = outputs.map(output => output.frames);
  const measurements = outputs.map(() => createActivityMeasurement(duration * 48000));
  activityMeasurements = measurements;
  activityDeadline = start + duration * 1000 + 1500;
  const stage: any = { label, start, requestedSeconds: duration, collectionDeadline: activityDeadline, firstFrames, endFrames: firstFrames.map(frame => frame + duration * 48000), status: "running", receivers: [] };
  results.stages.push(stage); write("result.json", results);
  let after: any[] = [];
  try {
    const end = start + duration * 1000;
    while (performance.now() < end) {
      await Bun.sleep(Math.max(0, Math.min(5000, end - performance.now())));
      await snapshot(label); if (fatal) throw fatal;
    }
    // Freeze each original sample endpoint. Draining only delivers those bytes;
    // it cannot substitute later active windows for a silent or missing cell.
    const drainDeadline = activityDeadline;
    while (measurements.some(value => !value.complete) && performance.now() < drainDeadline) {
      if (fatal) throw fatal;
      await Bun.sleep(Math.min(25, Math.max(0, drainDeadline - performance.now())));
    }
    activityMeasurements = null; // Snapshot latency cannot extend the frozen drain deadline.
    after = await snapshot(label + "-after");
  } finally {
    activityMeasurements = null;
    stage.end = performance.now();
    stage.receivers = measurements.map((measurement, index) => {
      const a = activePeer(before[index + 1]), b = activePeer(after[index + 1]);
      const counters = assessInboundCounters(a, b);
      return { index, stablePeer: !!a && !!b && a.index === b.index, activity: measurement.finish(), counters, delta: counters.delta };
    });
    stage.telemetryComplete = stage.receivers.every((receiver: any) => receiver.counters.status === "observed");
    stage.activityPassed = stage.receivers.every((receiver: any) => receiver.activity.passed);
    stage.stablePeers = stage.receivers.every((receiver: any) => receiver.stablePeer);
    stage.status = after.length && stage.activityPassed && stage.stablePeers ? "activity-passed" : "incomplete";
    stage.concealedSamples = totalObservedCounter(stage.receivers.map((receiver: any) => receiver.delta.concealedSamples));
    write("result.json", results);
  }
  console.log(JSON.stringify({ stage: label, seconds: (stage.end - start) / 1000,
    activityPassed: stage.activityPassed, telemetryComplete: stage.telemetryComplete, concealedSamples: stage.concealedSamples }));
  assert(stage.activityPassed && stage.stablePeers, "Incomplete, silent, clipped or invalid steady output, or changed peer; inspect stage coverage");
};

let cleanupPromise: Promise<void> | undefined;
const cleanup = () => cleanupPromise ??= (async () => {
  ending = true; clearInterval(resourceTimer); delay.disable();
  for (const worker of [...workers].reverse()) if (worker.child.exitCode === null) worker.child.stdin!.end(JSON.stringify({ close: true }) + "\n");
  await Bun.sleep(1000);
  for (const entry of [...children].reverse()) if (!entry.closed && entry.child.pid) try { process.kill(-entry.child.pid, "SIGTERM"); } catch {}
  await Bun.sleep(1000);
  for (const entry of children) if (!entry.closed && entry.child.pid) try { process.kill(-entry.child.pid, "SIGKILL"); } catch {}
  await Promise.race([Promise.all(children.filter(e => !e.closed).map(e => new Promise(resolve => e.child.once("close", resolve)))), Bun.sleep(2000)]);
  for (let index = -1; index < count; index++) { rmSync(join(directory, `profile-${index}`), { recursive: true, force: true }); rmSync(join(directory, `browser-${index}.json`), { force: true }); }
  results.cleanup = children.map(({ name, child, closed, code, signal }) => ({ name, pid: child.pid, closed, code, signal }));
  results.monitorFinal = outputs.map((output, index) => ({ index, frames: output.frames, pendingBytes: output.carry.length }));
  if (children.some(entry => !entry.closed) || outputs.some(output => output.carry.length)) {
    results.functionalPassed = false; results.cleanupError = "Unclosed child or partial PCM sample"; process.exitCode = 1;
  }
  results.resources = resources; write("result.json", results);
})();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { results.error = signal; void cleanup().then(() => process.exit(2)); });
try {
  const wav = Buffer.alloc(44 + 30 * 48000 * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let n = 0; n < 30 * 48000; n++) wav.writeInt16LE(Math.round(5000 * (Math.sin(2 * Math.PI * 440 * n / 48000) + Math.sin(2 * Math.PI * 997 * n / 48000))), 44 + n * 2);
  writeFileSync(join(directory, "capture.wav"), wav);
  for (let group = 0; group < Math.ceil(count / 10); group++) {
    const base = join(directory, `p${group}`); mkdirSync(base, { mode: 0o700 });
    for (const path of ["runtime", "state", "config", "cache", "data"]) mkdirSync(join(base, path), { mode: 0o700 });
    const env = { ...baseEnv, PULSE_SERVER: `unix:${base}/native`, PULSE_RUNTIME_PATH: join(base, "runtime"), PULSE_STATE_PATH: join(base, "state"),
      PULSE_COOKIE: join(base, "cookie"), PULSE_CLIENTCONFIG: join(base, "client.conf"), PULSE_CONFIG: join(base, "daemon.conf"),
      XDG_RUNTIME_DIR: join(base, "runtime"), XDG_CONFIG_HOME: join(base, "config"), XDG_CACHE_HOME: join(base, "cache"), XDG_DATA_HOME: join(base, "data") };
    writeFileSync(env.PULSE_COOKIE, randomBytes(256), { mode: 0o600 });
    writeFileSync(env.PULSE_CLIENTCONFIG, `autospawn = no\ndefault-server = ${env.PULSE_SERVER}\ncookie-file = ${env.PULSE_COOKIE}\n`);
    writeFileSync(env.PULSE_CONFIG, "default-sample-rate = 48000\nalternate-sample-rate = 48000\nrlimit-nofile = 8192\n");
    const sinks = Array.from({ length: Math.min(10, count - group * 10) }, (_, i) => `receiver_${group * 10 + i}`);
    writeFileSync(join(base, "pulse.pa"), [`load-module module-native-protocol-unix socket=${base}/native auth-cookie=${env.PULSE_COOKIE}`, ...["publisher", ...sinks].map(name => `load-module module-null-sink sink_name=${name} rate=48000 channels=1`), "set-default-sink publisher"].join("\n"));
    launch(`pulse-${group}`, [bin("pulseaudio"), "--daemonize=no", "--exit-idle-time=-1", "--use-pid-file=no", "--high-priority=no", "--realtime=no", "--log-target=stderr", "-n", "-F", join(base, "pulse.pa"), ...(prefix ? [`--dl-search-path=${prefix}/lib/pulse-17.0+dfsg1/modules`] : [])], env);
    await until(() => spawnSync(bin("pactl"), ["info"], { env, timeout: 1000 }).status === 0, "private Pulse server"); pulseEnvs.push(env);
  }
  results.pulseVersion = command([bin("pulseaudio"), "--version"]);
  const core = launch("core", ["node", "--cpu-prof", `--cpu-prof-dir=${directory}`, "--cpu-prof-name=core.cpuprofile", "build/core.mjs"], { ...baseEnv, COUCH_PORT: String(network.port), COUCH_HOST: "0.0.0.0", COUCH_DATA_DIR: network.nodes.server.dataDirectory }, "server");
  await until(() => /Pairing code: (\d+)/.test(core.tail()), "scratch Core", 60000);
  const pairingCode = /Pairing code: (\d+)/.exec(core.tail())![1];
  const certificate = new X509Certificate(readFileSync(join(network.nodes.server.dataDirectory, "tls/cert.pem")));
  const receiverOrigin = network.serverUrl.replace(/^http:/, "https:"), sourceOrigin = `http://127.0.0.1:${network.port}`;
  const certificatePin = { hostname: new URL(receiverOrigin).hostname, fingerprint256: certificate.fingerprint256 };
  assert(certificate.checkIP(certificatePin.hostname));
  const build = await Bun.build({ entrypoints: ["tests/live-audio-scale-worker.ts"], target: "node", external: ["electron"], outdir: directory, naming: "worker.mjs" }); assert(build.success);
  for (let index = -1; index < count; index++) {
    const identity = Identity.generate(), name = `Scale ${index}`;
    const paired = JSON.parse(command(inNode("server", ["node", "--input-type=module", "-e", `import {readFileSync} from 'node:fs';const p=JSON.parse(readFileSync(0,'utf8'));const r=await fetch(p.url,{method:'POST',headers:{'Content-Type':'application/json',Origin:p.origin},body:JSON.stringify(p.body),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Pairing '+r.status);process.stdout.write(await r.text());`]), baseEnv,
      JSON.stringify({ url: `${sourceOrigin}/api/pair`, origin: sourceOrigin, body: { code: pairingCode, id: identity.peerId, name } })));
    const config = { origin: index === -1 ? sourceOrigin : receiverOrigin, name, key: identity.privateB64u, token: paired.token, installationId: paired.installationId,
      certificatePin, profile: join(directory, `profile-${index}`), ...(index === -1 ? { capture: join(directory, "capture.wav") } : {}) };
    const path = join(directory, `browser-${index}.json`); writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    const env = { ...pulseEnvs[Math.max(0, Math.floor(index / 10))]!, PULSE_SINK: index === -1 ? "publisher" : `receiver_${index}` };
    const { child } = launch(`browser-${index}`, [electron as unknown as string, "--no-sandbox", join(directory, "worker.mjs"), path], env, index === -1 ? "server" : `client-${index + 1}`, true);
    let ready = false, sequence = 0; const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    createInterface({ input: child.stdout! }).on("line", line => {
      if (!line.startsWith("COUCH_SCALE ")) return;
      const value = JSON.parse(line.slice(12));
      if (value.ready) { ready = true; results.browserVersions = value.versions; results.browserAudioBuffers.push({ index, frames: value.audioBufferFrames }); }
      const callback = pending.get(value.id); if (callback) { pending.delete(value.id); value.error ? callback.reject(new Error(value.error)) : callback.resolve(value.value); }
    });
    const request = (value: object) => new Promise<any>((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${name}: request timeout`)); }, 15000);
      pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      child.stdin!.write(JSON.stringify({ id, ...value }) + "\n");
    });
    const worker = { index, id: identity.peerId, child, request, js: (code: string) => request({ code }) }; workers.push(worker);
    await until(() => ready, `${name} ready`, 30000);
    await until(() => worker.js("!!__scaleSession()?.connected"), `${name} connected`);
    if (index < 0) continue;
    const output: Output = { frames: 0, windows: 0, active: 0, silent: 0, invalid: 0, clipped: 0, lastActive: 0, lastWindow: 0, pending: 0, sum: 0, peak: 0, carry: Buffer.alloc(0) }; outputs.push(output);
    const monitor = launch(`monitor-${index}`, [bin("parec"), "--raw", "--format=float32le", "--rate=48000", "--channels=1", `--device=receiver_${index}.monitor`, "--latency-msec=20"], env, undefined, true);
    monitor.child.stdout!.on("data", (chunk: Buffer) => {
      const measurement = performance.now() <= activityDeadline ? activityMeasurements?.[index] : null;
      const data = output.carry.length ? Buffer.concat([output.carry, chunk]) : chunk, end = data.length - data.length % 4;
      for (let at = 0; at < end; at += 4) {
        const sample = data.readFloatLE(at); measurement?.push(sample); output.frames++; output.pending++;
        if (!Number.isFinite(sample)) output.invalid++; else { output.sum += sample * sample; output.peak = Math.max(output.peak, Math.abs(sample)); if (Math.abs(sample) >= 1) output.clipped++; }
        if (output.pending === 48000) {
          const rms = Math.sqrt(output.sum / output.pending), now = performance.now(); output.windows++; output.lastWindow = now;
          if (rms > .001) { output.active++; output.lastActive = now; } else output.silent++;
          log("output-windows.jsonl", { index, at: now, firstFrame: output.frames - 48000, rms, peak: output.peak }); output.pending = 0; output.sum = 0; output.peak = 0;
        }
      }
      output.carry = Buffer.from(data.subarray(end));
    });
    const started = performance.now();
    if (index === 0) {
      const source = await workers[0]!.js("__scaleSession().startLive({kind:'microphone'}).then(source=>({id:source.id}))");
      assert(await workers[0]!.js(`__scaleSession().run({type:'playLive',sourceId:${JSON.stringify(source.id)},deviceId:${JSON.stringify(identity.peerId)}})`));
    } else assert(await workers[0]!.js(`__scaleSession().run({type:'output',deviceId:${JSON.stringify(identity.peerId)},level:100})`));
    await until(async () => { const state = await worker.js("__scale.snapshot()"); log("observations.jsonl", { label: "admission", index, state }); return activePeer(state) && output.lastActive > started; }, `${name} active output`);
    results.admissions.push({ index, elapsedMs: performance.now() - started }); console.log(`Admitted ${index + 1}/${count}`);
  }
  // Validate exact sink routing, accepting Chromium's owned audio-service descendant.
  for (let group = 0; group < pulseEnvs.length; group++) {
    const sinks = JSON.parse(command([bin("pactl"), "--format=json", "list", "sinks"], pulseEnvs[group]!));
    const inputs = JSON.parse(command([bin("pactl"), "--format=json", "list", "sink-inputs"], pulseEnvs[group]!));
    write(`routing-${group}.json`, { sinks, inputs });
    for (const worker of workers.filter(w => w.index >= group * 10 && w.index < (group + 1) * 10)) {
      const sink = sinks.find((s: any) => s.name === `receiver_${worker.index}`), streams = inputs.filter((s: any) => s.sink === sink?.index); assert.equal(streams.length, 1);
      let pid = Number(streams[0].properties["application.process.id"]);
      while (pid > 1 && pid !== worker.child.pid) pid = Number(/^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))![1]);
      assert.equal(pid, worker.child.pid, "Output must belong to this receiver's browser");
    }
  }
  await snapshot("sender-parameters", true);
  await Bun.sleep(15000); await steady("initial", seconds);
  for (let round = 0; round < rounds; round++) for (const faultCount of faultCounts) {
    const before = await snapshot("before-fault"), faultStart = performance.now();
    const fault: any = { round, count: faultCount, start: faultStart, receivers: [], resumeAtMs: null, automatic: true, completed: false };
    results.faults.push(fault);
    const unaffected = outputs.map(o => o.silent);
    await workers[0]!.request({ profile: "start" });
    const oldPeers = before.slice(1).map(s => s.peers.length);
    const faultRequests = await Promise.all(workers.slice(1, faultCount + 1).map(w => w.js("__scale.disconnect()")));
    fault.requestSpreadMs = Math.max(...faultRequests.map(r => r.at)) - Math.min(...faultRequests.map(r => r.at));
    const progress = Array.from({ length: faultCount }, (_, index) => ({ index, controlMs: null as number | null, mediaMs: null as number | null, outputMs: null as number | null, paused: false, outputAfterWindow: 0 }));
    fault.receivers = progress;
    while (performance.now() - faultStart < 45000 && progress.some(p => p.outputMs === null)) {
      const state = await snapshot("fault"), elapsed = performance.now() - faultStart;
      for (let index = faultCount; index < count; index++) {
        assert.equal(activePeer(state[index + 1])?.index, activePeer(before[index + 1])?.index, `unaffected receiver ${index}: peer changed`);
        assert.equal(outputs[index]!.silent, unaffected[index], `unaffected receiver ${index}: silent output`);
      }
      for (const item of progress) {
        const s = state[item.index + 1]; if (s.connected && s.sockets.length > before[item.index + 1].sockets.length && s.sockets.some((socket: any) => socket.path === "/api/ws" && socket.readyState === 1) && item.controlMs === null) item.controlMs = elapsed;
        if (s.player?.status === "paused") { item.paused = true; fault.automatic = false; }
        if (activePeer(s, oldPeers[item.index]) && item.mediaMs === null) { item.mediaMs = elapsed; item.outputAfterWindow = outputs[item.index]!.windows + 1; }
        if (item.mediaMs !== null && outputs[item.index]!.windows > item.outputAfterWindow && outputs[item.index]!.lastActive === outputs[item.index]!.lastWindow && item.outputMs === null) item.outputMs = elapsed;
      }
      if (faultCount === count && elapsed >= 8000 && fault.resumeAtMs === null) { fault.resumeAtMs = performance.now() - faultStart; assert(await workers[0]!.js("__scaleSession().run({type:'pause',playbackId:__scaleSession().state.player.playbackId,paused:false})")); }
      await Bun.sleep(250);
    }
    const profile = await workers[0]!.request({ profile: "stop" }); write(`publisher-${round}-${faultCount}.cpuprofile`, profile.profile);
    fault.receivers = progress; fault.completed = progress.every(p => p.outputMs !== null); fault.withinAllocation = fault.completed && fault.automatic && progress.every(p => p.outputMs! <= 5000);
    write("result.json", results); console.log(JSON.stringify(fault));
    assert(fault.completed, "Recovery hard timeout"); await steady(`after-${round}-${faultCount}`, 15);
  }
  if (tailSeconds) { await Bun.sleep(15000); await steady("soak", tailSeconds); }
  await workers[0]!.js("__scaleSession().endLive()");
  const stop = performance.now(); await until(() => outputs.every(o => o.lastWindow > stop + 2000 && o.lastActive < o.lastWindow), "all outputs silent after source stop");
  results.functionalPassed = true;
  results.telemetryComplete = results.stages.every((stage: any) => stage.telemetryComplete);
  results.recoveryWithinAllocation = results.faults.length > 0 && results.faults.every((f: any) => f.withinAllocation);
} catch (error) { results.error = String(error); process.exitCode = 1; console.error(error); }
finally { await cleanup(); }
