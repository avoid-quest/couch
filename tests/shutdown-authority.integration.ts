import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Worker } from "node:worker_threads";
import { startHelpers } from "../src/server/helpers";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";
import { executableName, nodeExecutables } from "./executable.fixture";

test("Core starts independent producer cancellation before awaiting buffered FFmpeg selection", { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "shutdown-"));
  const gate = join(directory, "gate"), selecting = join(directory, "selecting"), previousPath = process.env.PATH;
  writeFileSync(gate, "");
  const executables = nodeExecutables(directory, { workers: true });
  process.env.PATH = `${directory}${delimiter}${previousPath ?? ""}`;
  for (const [name, version] of [["yt-dlp", "2026.10.21"], ["qjs", "0.17.0"]]) writeFileSync(join(directory, executableName(name!)), `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
  writeFileSync(join(directory, executableName("ffmpeg")), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(selecting)}, String(process.pid));
const finish = () => { if (fs.existsSync(${JSON.stringify(gate)})) setTimeout(finish, 10); else console.log('ffmpeg version 9.0.2'); };
finish();
`, { mode: 0o755 });
  const f = await authorityFixture();
  let closing: Promise<void> | undefined, bufferedDirectory: string | undefined, directSignal: AbortSignal | undefined, workerClose = false;
  t.after(async () => {
    rmSync(gate, { force: true });
    await closing;
    await f.close();
    if (process.env.COUCH_DATA_DIR) writeFileSync(join(process.env.COUCH_DATA_DIR, "shutdown-owned.jsonl"), readFileSync(join(directory, "fixture-processes.jsonl")));
    assert.deepEqual(await executables.close(), { children: [], workers: [] });
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(directory, { recursive: true, force: true });
  });
  const makeTemp = fs.mkdtemp;
  t.mock.method(fs, "mkdtemp", async (...args: Parameters<typeof fs.mkdtemp>) => {
    const result = await makeTemp(...args);
    if (String(args[0]).includes("couch-live-stream-")) bufferedDirectory = String(result);
    return result;
  });
  syncBuiltinESMExports();
  const post = Worker.prototype.postMessage;
  t.mock.method(Worker.prototype, "postMessage", function(this: Worker, ...args: Parameters<Worker["postMessage"]>) {
    if ((args[0] as { type?: string })?.type === "close") workerClose = true;
    return Reflect.apply(post, this, args);
  });
  const request = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/independent.m3u8")) {
      directSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => directSignal!.addEventListener("abort", () => reject(directSignal!.reason), { once: true }));
    }
    return request(input, init);
  });
  startHelpers(join(directory, "helpers"));
  const host = await f.connect(f.host), phone = await f.connect(), tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1"), other = await f.connect(f.devices[3]!, "&audio=1&video=1");
  resultOk(await phone.command({ type: "enqueue", entry: { id: "independent", title: "Independent", source: `${f.hub.origin}/independent.m3u8` }, playNow: true, deviceId: phone.id }));
  await until(() => !!directSignal);
  resultOk(await host.command({ type: "publishLive", sourceId: "buffered", uploadToken: "1".repeat(64), kind: "screen", audio: true, video: true }));
  resultOk(await tv.command({ type: "playLive", sourceId: "buffered", deviceId: tv.id }));
  resultOk(await tv.command({ type: "output", deviceId: other.id, level: 80 }));
  resultOk(await tv.command({ type: "inSync", inSync: true }));
  await until(() => !!bufferedDirectory && existsSync(selecting));
  closing = f.hub.close();
  assert.equal(directSignal!.aborted, true, "an independent Direct preparation is canceled before the buffered helper gate is released");
  assert.equal(workerClose, true, "owned worker shutdown begins before waiting for buffered setup");
  assert.ok(existsSync(gate), "the helper selection is still held for the cancellation assertions");
  rmSync(gate);
  await closing;
  assert.equal(existsSync(bufferedDirectory!), false, "late setup releases its owned temporary directory");
});

test("Core close awaits its owned audio worker's completion and remains idempotent", { timeout: 10_000 }, async t => {
  const f = await authorityFixture();
  const stopped = Promise.withResolvers<void>();
  const stop = f.hub.server.stop.bind(f.hub.server), post = Worker.prototype.postMessage;
  let release: (() => void) | undefined, workerExited = false, completed = false, closing: Promise<void> | undefined;
  t.after(async () => { release?.(); await closing; await f.close(); });
  t.mock.method(f.hub.server, "stop", async () => { await stop(); stopped.resolve(); });
  t.mock.method(Worker.prototype, "postMessage", function(this: Worker, ...args: Parameters<Worker["postMessage"]>) {
    if ((args[0] as { type?: string })?.type !== "close") return Reflect.apply(post, this, args);
    this.once("exit", () => { workerExited = true; });
    release = () => { release = undefined; Reflect.apply(post, this, args); };
  });
  closing = f.hub.close();
  void closing.then(() => { completed = true; });
  assert.equal(f.hub.close(), closing, "repeated close returns the same completion promise");
  await stopped.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(completed, false, "network shutdown alone cannot complete Core while worker teardown is held");
  assert.ok(release);
  release();
  await closing;
  assert.equal(workerExited, true, "Core completion follows the actual owned worker exit");
});
