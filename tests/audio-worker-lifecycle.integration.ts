import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Worker } from "node:worker_threads";
import { WebSocket } from "ws";
import { createSendspin } from "../src/server/sendspin";
import type { Ffmpeg } from "../src/server/scheduled-capture";
import type { PlayerState } from "../src/shared/protocol";
import { nodeExecutables } from "./executable.fixture";

const until = async (check: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Expected worker lifecycle event did not arrive"); await new Promise(resolve => setTimeout(resolve, 10)); }
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
type Message = { type: string; group?: string; epoch?: string; state?: PlayerState; value?: { receivers: unknown[][] } };

async function fixture(t: TestContext, ffmpeg?: Ffmpeg) {
  const directory = mkdtempSync(join(tmpdir(), "couch-worker-lifecycle-"));
  const executables = nodeExecutables(directory, { workers: true });
  const threads = process.getBuiltinModule("node:worker_threads"), Original = threads.Worker;
  let worker!: Worker, hold: ((message: Message) => boolean) | undefined;
  const held: Message[] = [];
  threads.Worker = class extends Original {
    constructor(file: string | URL, options?: import("node:worker_threads").WorkerOptions) { super(file, options); worker = this; }
    override emit(event: string | symbol, ...args: unknown[]) {
      if (event === "message" && hold?.(args[0] as Message)) { held.push(args[0] as Message); return true; }
      return super.emit(event, ...args);
    }
  };
  syncBuiltinESMExports();
  const source = createServer((_request, response) => response.end("synthetic source"));
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const script = join(directory, "ffmpeg");
  writeFileSync(script, "#!couch-test-node\nsetInterval(() => {}, 1000);\n");
  const states: PlayerState[] = [], sourceErrors: string[] = [];
  const audio = createSendspin({ name: "Worker ownership", admit: () => true, changed() {}, ffmpeg: ffmpeg ?? (async () => script), sourceFailed: (_id, error) => sourceErrors.push(error) });
  const workerId = worker.threadId, failures: unknown[] = [];
  worker.on("error", error => failures.push(error));
  t.after(async () => {
    try { await audio.close(); }
    finally {
      threads.Worker = Original; syncBuiltinESMExports();
      const forced = await executables.close();
      if (process.env.COUCH_DATA_DIR) writeFileSync(join(process.env.COUCH_DATA_DIR, basename(directory) + ".json"), JSON.stringify({ workerId, retired: worker.threadId === -1, forced, journal: readFileSync(join(directory, "fixture-processes.jsonl"), "utf8") }));
      source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
      assert.deepEqual(forced, { children: [], workers: [] }, "production teardown must retire every owned child and worker before fixture cleanup");
    }
  });
  return { directory, source, audio, states, sourceErrors, script, worker, failures, executables, held, hold: (next?: typeof hold) => { hold = next; },
    deliver: (message: Message) => Original.prototype.emit.call(worker, "message", message),
    load: { type: "load" as const, playbackId: "item", source: `http://127.0.0.1:${(source.address() as { port: number }).port}/input` } };
}

for (const capture of [false, true]) test(`a malformed ${capture ? "capture" : "programme"} encoder fails only its owner`, { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  writeFileSync(f.script, "#!couch-test-node\nprocess.stdout.write(Buffer.alloc(64, 120)); setInterval(() => {}, 1000);\n");
  const healthy: PlayerState[] = [];
  const group = f.audio.group("healthy", state => healthy.push(state));
  group.send({ ...f.load, paused: true });
  await until(() => healthy.length > 0);
  const bad = f.audio.group("bad", state => f.states.push(state));
  bad.members([{ deviceId: "unconnected", level: 100 }]);
  if (capture) {
    f.audio.registerSource("synthetic-capture");
    bad.send({ ...f.load, liveSourceId: "synthetic-capture", live: true });
    assert.equal(f.audio.writeSource("synthetic-capture", { generation: "one", sequence: 0, samplePosition: 0, capturedAtUs: 1_000_000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }), true);
  } else bad.send(f.load);
  await until(() => f.states.some(state => state.status === "error"));
  assert.match(f.states.at(-1)!.error!, /broken Ogg stream/);
  assert.deepEqual(f.failures, [], "an encoder parser failure must never become a worker error");
  assert.equal(healthy.some(state => state.status === "error"), false, "the other programme must not fail");
  await until(() => f.executables.active().length === 0);
  group.send({ ...f.load, paused: true, startPosition: 4 });
  await until(() => healthy.at(-1)?.position === 4);
  assert.equal(healthy.at(-1)!.status, "paused", "an independent group remains usable after the malformed encoder");
  assert.notEqual(f.worker.threadId, -1, "the shared worker survives");
  assert.equal(f.sourceErrors.length, capture ? 1 : 0);
});

test("queued receiver errors belong to their group incarnation", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  f.source.on("upgrade", (request, socket, head) => f.audio.upgrade(request, socket as import("node:net").Socket, head));
  const peer = new WebSocket(f.load.source.replace("http:", "ws:"));
  t.after(() => peer.terminate());
  await once(peer, "open");
  const greeting = once(peer, "message");
  peer.send(JSON.stringify({ type: "client/hello", payload: { client_id: "unsupported", version: 1, supported_roles: ["player@v1"],
    "player@v1_support": { supported_formats: [{ codec: "pcm", sample_rate: 44100, channels: 2, bit_depth: 16 }], buffer_capacity: 65536, supported_commands: [] } } }));
  await greeting;
  peer.send(JSON.stringify({ type: "client/state", payload: { player: { state: "synchronized" } } }));
  await until(() => f.audio.connected("unsupported"));
  // A synthetic Ogg page is enough to anchor the real worker's encoder queue;
  // no physical device or decoder is involved in this ownership test.
  writeFileSync(f.script, "#!couch-test-node\nconst page = Buffer.alloc(29); page.write('OggS'); page[26] = 1; page[27] = 1; page[28] = 0; process.stdout.write(page); setInterval(() => {}, 1000);\n");
  f.hold(message => message.type === "status" && !!message.value?.receivers.length);
  const old = f.audio.group("reused", () => {});
  old.members([{ deviceId: "unsupported", level: 100 }]); old.send(f.load);
  await until(() => f.held.length > 0);
  f.deliver(f.held[0]!);
  assert.match(f.audio.receiverError("unsupported")!, /supports neither/, "current-incarnation output errors remain visible");
  old.close(); f.hold();
  const group = f.audio.group("reused", state => f.states.push(state));
  group.send({ ...f.load, paused: true });
  await until(() => f.states.length > 0);
  for (const message of f.held) f.deliver(message);
  assert.equal(f.audio.receiverError("unsupported"), undefined, "old output errors must not be projected onto a replacement group");
});

test("later groups and sources fail explicitly after an actual worker exit", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  await f.worker.terminate();
  const group = f.audio.group("later", state => f.states.push(state));
  group.send(f.load);
  f.audio.registerSource("later-source");
  await until(() => f.states.length > 0 && f.sourceErrors.length > 0);
  assert.equal(f.states.at(-1)!.status, "error");
  assert.equal(f.states.at(-1)!.playbackId, "item");
  assert.match(f.audio.sourceError("later-source")!, /audio worker stopped/);
  assert.equal(f.audio.writeSource("later-source", { generation: "one", sequence: 0, samplePosition: 0, capturedAtUs: 1, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }), false);
});

test("close retires a running encoder after unexpected worker termination", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const group = f.audio.group("crashed", state => f.states.push(state));
  group.members([{ deviceId: "unconnected", level: 100 }]); group.send(f.load);
  await until(() => f.executables.active().length === 1);
  const [pid] = f.executables.active();
  await f.worker.terminate();
  await assert.doesNotReject(f.audio.close(), "worker failure must not make owned encoder retirement fail");
  if (alive(pid!)) {
    assert.notEqual(process.platform, "win32", "a terminated Windows child must be gone");
    const [child, parent, state] = execFileSync("ps", ["-o", "pid=,ppid=,stat=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim().split(/\s+/);
    assert.equal(Number(child), pid);
    assert.equal(Number(parent), process.pid);
    assert.match(state!, /^Z/, "a remaining PID must be confirmed dead, not merely signaled");
    if (process.env.COUCH_DATA_DIR) writeFileSync(join(process.env.COUCH_DATA_DIR, "crash-process-state.json"), JSON.stringify({ pid, state, reaped: false }));
  }
});

test("queued state and errors cannot cross a recreated group with the same item ID", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  f.hold(message => message.group === "reused" && ["state", "logError"].includes(message.type));
  const old = f.audio.group("reused", () => {});
  old.send({ ...f.load, paused: true, startPosition: 37 });
  await until(() => f.held.some(message => message.state?.position === 37));
  old.members([{ deviceId: "unconnected", level: 100 }]);
  writeFileSync(f.script, "#!couch-test-node\nprocess.stderr.write('Synthetic old encoder failure'); process.exitCode = 1;\n");
  old.send(f.load);
  await until(() => f.held.some(message => message.type === "logError") && f.held.some(message => message.state?.status === "error"));
  old.close(); f.hold();
  const group = f.audio.group("reused", state => f.states.push(state));
  group.send({ ...f.load, paused: true });
  await until(() => f.states.length > 0);
  const logs: string[] = [];
  t.mock.method(console, "log", (line: string) => logs.push(line));
  const before = f.states.length;
  for (const message of f.held) f.deliver(message);
  assert.equal(f.states.length, before, "a new observer must not receive any retired incarnation state");
  assert.deepEqual(logs, [], "retired errors must not be attributed to the new incarnation");
  const oldEpoch = f.held.find(message => message.type === "state")!.epoch;
  f.worker.postMessage({ type: "group", group: "reused", epoch: oldEpoch, method: "send", args: [{ ...f.load, paused: true, startPosition: 99 }] });
  f.worker.postMessage({ type: "group", group: "reused", epoch: oldEpoch, method: "close", args: [] });
  old.send({ ...f.load, paused: true, startPosition: 99 }); old.close();
  group.send({ ...f.load, paused: true, startPosition: 4 });
  await until(() => f.states.at(-1)?.position === 4);
  assert.equal(f.states.some(state => state.position === 99), false, "retired handles cannot control or delete the replacement");
});

for (const capture of [false, true]) test(`close awaits the real worker and its ${capture ? "capture" : "programme"} child, and repeated close shares completion`, { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const group = f.audio.group("owned", state => f.states.push(state));
  group.members([{ deviceId: "unconnected", level: 100 }]);
  if (capture) {
    f.audio.registerSource("capture");
    group.send({ ...f.load, liveSourceId: "capture" });
    f.audio.writeSource("capture", { generation: "one", sequence: 0, samplePosition: 0, capturedAtUs: 1_000_000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
  } else group.send(f.load);
  await until(() => f.executables.active().length === 1);
  const [pid] = f.executables.active();
  const post = f.worker.postMessage.bind(f.worker);
  let closeRequest: unknown;
  t.mock.method(f.worker, "postMessage", (message: { type: string }) => { if (message.type === "close") closeRequest = message; else post(message); });
  const closing = f.audio.close();
  assert.ok(closing instanceof Promise, "shutdown exposes a completion promise to Hub");
  assert.equal(f.audio.close(), closing);
  let settled = false; void closing.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "close remains pending while its worker has not consumed teardown");
  assert.equal(alive(pid!), true);
  assert.ok(closeRequest); post(closeRequest);
  await closing;
  assert.equal(f.worker.threadId, -1);
  assert.equal(alive(pid!), false, "successful close precedes neither worker nor child retirement");
  assert.deepEqual(f.executables.active(), []);
});

test("bounded close fallback retires an owned child even when the worker misses close", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const group = f.audio.group("fallback", () => {});
  group.members([{ deviceId: "unconnected", level: 100 }]); group.send(f.load);
  await until(() => f.executables.active().length === 1);
  const [pid] = f.executables.active();
  // Drop only the close request at the actual Worker transport; all source and
  // child lifecycle messages still cross the real file-backed worker boundary.
  const post = f.worker.postMessage.bind(f.worker);
  let dropped = 0, exitCode: number | undefined;
  f.worker.once("exit", code => { exitCode = code; });
  t.mock.method(f.worker, "postMessage", (message: { type: string }) => { if (message.type === "close") dropped++; else post(message); });
  const closing = f.audio.close();
  assert.ok(closing instanceof Promise);
  assert.equal(f.audio.close(), closing);
  await closing;
  assert.equal(dropped, 1);
  assert.equal(exitCode, 1, "the bounded fallback actually terminated the worker");
  assert.equal(f.worker.threadId, -1);
  assert.equal(alive(pid!), false, "worker termination alone must not strand its child");
  assert.deepEqual(f.executables.active(), []);
});

test("close releases a helper that resolves after worker retirement without starting a child", { timeout: 15_000 }, async t => {
  let requested = false, released = 0, resolve!: (lease: { path: string; release(): void }) => void;
  const lease = new Promise<{ path: string; release(): void }>(done => { resolve = done; });
  const f = await fixture(t, () => { requested = true; return lease; });
  const group = f.audio.group("pending", () => {});
  group.members([{ deviceId: "unconnected", level: 100 }]); group.send(f.load);
  await until(() => requested);
  const closing = f.audio.close(); let settled = false;
  void closing.then(() => { settled = true; });
  await until(() => f.worker.threadId === -1);
  assert.equal(settled, false, "the selected helper lease is still owned until release");
  resolve({ path: f.script, release() { released++; } });
  await closing;
  assert.equal(released, 1);
  assert.deepEqual(f.executables.active(), []);
});

for (const pendingReady of [true, false]) test(`close retires a socket ${pendingReady ? "waiting for worker readiness" : "waiting for a client hello"}`, { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  if (pendingReady) f.hold(message => message.type === "ready");
  let upgraded!: () => void;
  const accepted = new Promise<void>(resolve => { upgraded = resolve; });
  f.source.on("upgrade", (request, socket, head) => { f.audio.upgrade(request, socket as import("node:net").Socket, head); upgraded(); });
  const peer = connect((f.source.address() as { port: number }).port, "127.0.0.1");
  peer.on("error", () => {}); t.after(() => peer.destroy());
  const disconnected = new Promise<void>(resolve => peer.once("close", () => resolve()));
  await once(peer, "connect");
  peer.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
  await accepted;
  if (!pendingReady) await once(peer, "data");
  await f.audio.close(); await disconnected;
  assert.equal(peer.destroyed, true);
  assert.equal(f.worker.threadId, -1);
});
