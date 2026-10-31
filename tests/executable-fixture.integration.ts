import assert from "node:assert/strict";
import cp, { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import threads, { Worker } from "node:worker_threads";
import { nodeExecutables } from "./executable.fixture";
import { liveFixture, until } from "./live-input.fixture";
import { helper, startHelpers } from "../src/server/helpers";

for (const workerOwned of [false, true]) test(`executable cleanup reports forced ${workerOwned ? "worker and child" : "child"} retirement`, { timeout: 15_000 }, async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "couch leaked-executable-")));
  const executable = join(directory, "held.exe");
  writeFileSync(executable, '#!couch-test-node\nconsole.log("ready"); setInterval(() => {}, 1000);\n');
  const fixtures = nodeExecutables(directory, { workers: workerOwned });
  t.after(async () => { await fixtures.close(); rmSync(directory, { recursive: true, force: true }); });
  let pid: number, workerId: number | undefined;
  if (workerOwned) {
    const file = join(directory, "worker.mjs");
    writeFileSync(file, `import { parentPort, workerData } from 'node:worker_threads'; import { spawn } from 'node:child_process'; const child = spawn(workerData, []); child.stdout.once('data', () => parentPort.postMessage(child.pid)); setInterval(() => {}, 1000);`);
    const worker = new Worker(file, { workerData: executable });
    workerId = worker.threadId;
    pid = (await once(worker, "message"))[0];
  } else {
    const child = cp.spawn(executable, []);
    await once(child.stdout, "data");
    pid = child.pid!;
  }
  const forced = await fixtures.close();
  assert.deepEqual(forced, { children: [pid], workers: workerOwned ? [workerId] : [] }, "record survivors before any forced cleanup, including worker termination");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the safety net must still stop the deliberately leaked child");
  assert.deepEqual(await fixtures.close(), forced, "repeated cleanup must retain the original evidence");
});

test("executable fixtures reach real children in the parent and worker, then restore the boundary", async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "couch executable-")));
  const executable = join(directory, "codec.exe"), before = [...process.execArgv], spawn = cp.spawn, originalExec = cp.execFile, originalWorker = threads.Worker;
  // Deliberately cannot execute directly even on POSIX: the redirect must be reached.
  writeFileSync(executable, '#!couch-test-node\nconsole.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env.FIXTURE_VALUE }));\n', { mode: 0o755 });
  const fixtures = nodeExecutables(directory, { workers: true });
  t.after(async () => { await fixtures.close(); rmSync(directory, { recursive: true, force: true }); });
  const args = ["argument with spaces", "--selected=it"], options = { cwd: directory, env: { ...process.env, FIXTURE_VALUE: "preserved" } };
  assert.deepEqual(JSON.parse((await promisify(execFile)(executable, args, options)).stdout), { args, cwd: directory, env: "preserved" });
  const workerFile = join(directory, "worker.mjs");
  writeFileSync(workerFile, `import { parentPort, workerData } from 'node:worker_threads'; import { spawn } from 'node:child_process'; const child = spawn(workerData.executable, workerData.args, workerData.options); let stdout = ''; child.stdout.on('data', bytes => stdout += bytes); child.on('error', error => { throw error; }); child.once('close', code => { if (code !== 0) throw new Error('Fixture child failed'); parentPort.postMessage(JSON.parse(stdout)); });`);
  const worker = new Worker(workerFile, { workerData: { executable, args, options } });
  t.after(() => worker.terminate());
  const exited = once(worker, "exit");
  assert.deepEqual((await once(worker, "message"))[0], { args, cwd: directory, env: "preserved" });
  assert.equal((await exited)[0], 0);
  assert.deepEqual(fixtures.active(), []);
  await fixtures.close();
  assert.equal(cp.spawn, spawn);
  assert.equal(cp.execFile, originalExec);
  assert.equal(threads.Worker, originalWorker);
  assert.deepEqual(process.execArgv, before);
});

test("the shared real-media fixture encodes and decodes through actual FFmpeg, including its worker", { skip: !process.env.COUCH_TEST_FFMPEG, timeout: 20_000 }, async t => {
  const ffmpeg = process.env.COUCH_TEST_FFMPEG!;
  const recording = cp.execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "8", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-g", "10", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
  const f = await liveFixture({ media: { ffmpeg, recording } });
  t.after(async () => {
    const pids = [...f.capturePids(), ...f.encoders().map(encoder => encoder.pid)];
    assert.deepEqual(await f.close(), { children: [], workers: [] }, "every encoder and worker must stop before forced cleanup");
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "every capture, encoder and worker decoder must stop");
  });
  startHelpers(join(dirname(f.databasePath), "helpers"));
  const selected = await Promise.allSettled([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  assert.deepEqual(selected[0], { status: "fulfilled", value: f.executable });
  await f.publish("screen");
  assert.equal((await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load());
  f.receiver.report();
  await until(() => f.publisher.state.player.status === "playing");
  assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
  await f.speaker(1);
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
  await until(() => !!other.load()?.follow);
  f.receiver.report(); other.report();
  const deadline = Date.now() + 12_000;
  while (f.heard(1) <= 4 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(f.heard(1) > 4, JSON.stringify({ heard: f.heard(1), captures: f.capturePids().length, encoders: f.encoders().map(encoder => encoder.args), status: f.publisher.state.player.status, error: f.publisher.state.player.error }));
  assert.equal(f.capturePids().length, 1);
  assert.ok(f.encoders().some(encoder => encoder.args.includes("pipe:0")), "the real recording is encoded incrementally");
  assert.ok(f.encoders().some(encoder => encoder.args.includes("s16le")), "the audio worker decodes real HLS to PCM");
});
