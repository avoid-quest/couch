import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { helper, startHelpers } from "../src/server/helpers";
import { updateStatus } from "../src/server/helper-status";
import type { Action, ServerMessage, SessionState } from "../src/shared/protocol";

// Real Core intake, Session and extractor subprocesses; only the helper executable and
// renderer are fixtures. Each run owns its database, helper directory and loopback port.
const hostId = "h".repeat(43), hostToken = "h".repeat(64);
const video = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const options = { skip: process.platform === "win32", timeout: 15_000 };
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function fixture(t: TestContext, mode = "success", delay = 50) {
  const directory = mkdtempSync(join(tmpdir(), "couch-web-intake-")), bin = join(directory, "bin"), helpers = join(directory, "helpers");
  const runsFile = join(directory, "runs"), gate = join(directory, "gate");
  const before = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, SSL_CERT_FILE: process.env.SSL_CERT_FILE };
  mkdirSync(bin);
  process.env.PATH = bin; process.env.COUCH_DATA_DIR = directory;
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline fixture"); });
  for (const [name, version] of [["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    writeFileSync(join(bin, name!), `#!/bin/sh\necho '${version}'\n`, { mode: 0o755 });
  }
  writeFileSync(join(bin, "yt-dlp"), `#!${process.execPath}
const fs = process.getBuiltinModule("node:fs");
if (process.argv.includes("--version")) console.log("2026.10.21");
else {
  const inspect = process.argv.includes("--ignore-no-formats-error"), url = process.argv.at(-1);
  fs.appendFileSync(${JSON.stringify(runsFile)}, JSON.stringify({inspect, url}) + "\\n");
  const finish = () => {
    if (!inspect && fs.existsSync(${JSON.stringify(gate)})) { setTimeout(finish, 10); return; }
    if (!inspect && ${JSON.stringify(mode)} === "failure") { console.error("Requested format is not available"); process.exit(1); }
    const metadata = !inspect && ${JSON.stringify(mode)} === "empty" ? {} : {title:"Title " + url.slice(-11), duration:60, thumbnail:"https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", channel:"Channel", channel_url:"https://www.youtube.com/@fixture"};
    console.log(JSON.stringify({url:"https://example.com/video.mp4", protocol:"https", ...metadata}));
  };
  setTimeout(finish, inspect ? 10 : ${delay});
}
`, { mode: 0o755 });
  startHelpers(helpers);
  await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  const hub = await createHub({ databasePath: join(directory, "couch.sqlite"), hostToken, hostname: "127.0.0.1", port: 0, streamingCommunityFetch: async () => new Response("", { status: 503 }) });
  const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${hostToken}&device=${hostId}&tv=1`, { headers: { Origin: hub.origin } });
  let state: SessionState | undefined, sequence = 0;
  const pending = new Map<string, (result: Extract<ServerMessage, { type: "result" }>) => void>();
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
    if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
    if (message.type === "text") socket.send(JSON.stringify({ type: "textResult", requestId: message.requestId, ok: true }));
    if (message.type === "player" && message.command.type === "load") socket.send(JSON.stringify({ type: "player", state: { playbackId: message.command.playbackId, status: "playing", position: 0, duration: 60, volume: 80, seekable: true, buffering: false, error: null, speed: 1, tracks: [], audioDelay: 0, subtitleDelay: 0 } }));
  };
  let closed = false;
  const close = async () => { if (!closed) { closed = true; socket.terminate(); await hub.close(); } };
  t.after(async () => {
    await close();
    for (const timer of timers) clearInterval(timer);
    await updateStatus(helpers, () => {});
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => !!state, "Core published its state");
  return {
    close,
    get state() { return state!; },
    hold: () => writeFileSync(gate, ""),
    release: () => rmSync(gate, { force: true }),
    runs: (): { inspect: boolean; url: string }[] => existsSync(runsFile) ? readFileSync(runsFile, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [],
    command: async (action: Action) => {
      const requestId = String(++sequence);
      const result = await new Promise<Extract<ServerMessage, { type: "result" }>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Core did not answer")), 3_000);
        pending.set(requestId, result => { clearTimeout(timer); resolve(result); });
        socket.send(JSON.stringify({ type: "command", requestId, action }));
      });
      assert.equal(result.ok, true, result.ok ? undefined : result.error);
    },
  };
}

for (const intake of ["enqueueWeb", "enqueueProvider"] as const) test(`${intake} Play extracts once and retains title, artwork and creator`, options, async t => {
  const f = await fixture(t), url = video("abcdefghijk");
  await f.command(intake === "enqueueWeb" ? { type: intake, entryId: "playing", url, playNow: true } : { type: intake, provider: "youtube", shape: "atom", url, playNow: true });
  await until(() => f.state.player.status === "playing", "pasted video played");
  const entry = f.state.queue[0]!;
  assert.equal(entry.title, "Title abcdefghijk");
  assert.equal(entry.duration, 60);
  assert.equal(entry.thumbnail, "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  assert.deepEqual(entry.creator, { title: "Channel", url: "https://www.youtube.com/@fixture" });
  assert.deepEqual(f.runs(), [{ inspect: false, url }]);
});

test("a queued link is inspected immediately without starting playback", options, async t => {
  const f = await fixture(t), url = video("abcdefghijk");
  await f.command({ type: "enqueueWeb", entryId: "queued", url });
  await until(() => f.state.queue[0]?.title === "Title abcdefghijk", "queue title resolved");
  assert.equal(f.state.player.status, "idle");
  assert.deepEqual(f.runs(), [{ inspect: true, url }]);
});

for (const mode of ["failure", "empty"]) test(`playback with ${mode} metadata still inspects its queue title`, options, async t => {
  const f = await fixture(t, mode), url = video("abcdefghijk");
  await f.command({ type: "enqueueWeb", entryId: "playing", url, playNow: true });
  await until(() => f.state.queue[0]?.title === "Title abcdefghijk" && f.state.player.status === (mode === "failure" ? "error" : "playing"), "fallback metadata and playback state resolved");
  assert.deepEqual(f.runs(), [{ inspect: false, url }, { inspect: true, url }]);
});

test("a later Play cancels extraction but keeps the earlier queued title", options, async t => {
  const f = await fixture(t);
  f.hold();
  await f.command({ type: "enqueueWeb", entryId: "earlier", url: video("abcdefghijk"), playNow: true });
  await until(() => f.runs().length > 0, "first extraction started");
  await f.command({ type: "enqueueWeb", entryId: "later", url: video("lmnopqrstuv"), playNow: true });
  f.release();
  await until(() => f.state.player.status === "playing" && f.state.queue.find(entry => entry.id === "earlier")?.title === "Title abcdefghijk", "cancelled entry enriched");
  assert.equal(f.state.currentEntryId, "later");
  assert.equal(f.state.queue.find(entry => entry.id === "later")?.title, "Title lmnopqrstuv");
  assert.equal(f.runs().filter(run => run.inspect && run.url === video("abcdefghijk")).length, 1);
  assert.equal(f.runs().filter(run => run.url === video("lmnopqrstuv")).length, 1);
});

test("Stop keeps the queued link and still resolves its title", options, async t => {
  const f = await fixture(t);
  f.hold();
  await f.command({ type: "enqueueWeb", entryId: "stopped", url: video("abcdefghijk"), playNow: true });
  await until(() => f.runs().length > 0, "extraction started");
  await f.command({ type: "stop" });
  await until(() => f.state.queue.find(entry => entry.id === "stopped")?.title === "Title abcdefghijk", "stopped entry enriched");
  assert.equal(f.state.currentEntryId, null);
  assert.equal(f.state.player.playbackId, null);
  assert.deepEqual(f.runs(), [{ inspect: false, url: video("abcdefghijk") }, { inspect: true, url: video("abcdefghijk") }]);
});

test("removing a resolving entry prevents its fallback inspection", options, async t => {
  const f = await fixture(t);
  f.hold();
  await f.command({ type: "enqueueWeb", entryId: "removed", url: video("abcdefghijk"), playNow: true });
  await until(() => f.runs().length > 0, "extraction started");
  await f.command({ type: "remove", entryId: "removed" });
  f.release();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(f.state.queue.some(entry => entry.id === "removed"), false);
  assert.deepEqual(f.runs(), [{ inspect: false, url: video("abcdefghijk") }]);
});

test("shutdown cancels a resolving entry without starting fallback inspection", options, async t => {
  const f = await fixture(t);
  f.hold();
  await f.command({ type: "enqueueWeb", entryId: "closing", url: video("abcdefghijk"), playNow: true });
  await until(() => f.runs().length > 0, "extraction started");
  await f.close();
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(f.runs(), [{ inspect: false, url: video("abcdefghijk") }]);
});

test("playback metadata does not replace a supplied title", options, async t => {
  const f = await fixture(t), url = video("abcdefghijk");
  await f.command({ type: "enqueueWeb", entryId: "named", url, title: "My title", playNow: true });
  await until(() => f.state.player.status === "playing", "named item played");
  assert.equal(f.state.queue[0]?.title, "My title");
  assert.deepEqual(f.runs(), [{ inspect: false, url }]);
});
