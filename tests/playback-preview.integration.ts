// Real Core, HTTP authorization and WebSocket transport; only the external extractor is a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import https from "node:https";
import { PassThrough, Readable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import fixture from "./fixtures/youtube-storyboard.json";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { startHelpers, helper } from "../src/server/helpers";
import { createSession, type MediaSource } from "../src/server/session";
import { storyboardPreview } from "../src/server/playback-preview";
import type { Action, PlaybackCommand, ServerMessage, SessionState } from "../src/shared/protocol";

const until = async (check: () => boolean) => {
  const end = Date.now() + 5000;
  while (!check()) { if (Date.now() > end) throw new Error("State did not arrive"); await new Promise(resolve => setTimeout(resolve, 10)); }
};
for (const kind of ["storyboard", "vtt"]) test(`${kind}: a controller without media reads the current preview; private, replaced and revoked playback cannot`, async t => {
  const directory = mkdtempSync(join(tmpdir(), "couch-preview-"));
  const databasePath = join(directory, "couch.sqlite"), root = join(directory, "helpers");
  const originalPath = process.env.PATH;
  const spawn = cp.spawn, execFile = cp.execFile;
  const versions = new Map<string, string>();
  for (const [name, version] of [["yt-dlp", "2099.01.01"], ["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    const dir = join(root, name!, "fixture"); mkdirSync(dir, { recursive: true });
    const path = join(dir, "helper"); writeFileSync(path, "fixture", { mode: 0o755 }); versions.set(path, version!);
  }
  process.env.PATH = "";
  const downloads = t.mock.method(globalThis, "fetch", async () => { throw new Error("No helper downloads"); });
  t.mock.method(cp, "execFile", (file: string, args: string[], options: object, callback: (...args: unknown[]) => void) => versions.has(file)
    ? execFile(process.execPath, ["-e", `console.log(${JSON.stringify(versions.get(file))})`], options, callback) : execFile(file, args, options, callback));
  let extractions = 0, failExtraction = false, manifests = 0, hangManifest = false;
  let pendingManifest: AbortSignal | undefined;
  const nativeRequest = https.request;
  t.mock.method(https, "request", (url: URL, options: import("node:http").RequestOptions, callback: (response: import("node:http").IncomingMessage) => void) => {
    if (url.hostname !== "preview.example") return nativeRequest(url, options, callback);
    manifests++;
    const stream = new PassThrough({ autoDestroy: false });
    const abort = () => stream.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    options.signal?.addEventListener("abort", abort, { once: true });
    stream.once("close", () => options.signal?.removeEventListener("abort", abort));
    stream.once("finish", () => {
      if (hangManifest) { pendingManifest = options.signal; return; }
      const response = Readable.from([Buffer.from("WEBVTT\n\n00:00.000 --> 00:16.000\nsheet.webp#xywh=0,0,180,101\n\n00:20.000 --> 00:32.000\nsheet.webp#xywh=180,0,180,101\n")]) as import("node:http").IncomingMessage;
      response.statusCode = 200; response.statusMessage = "OK"; response.rawHeaders = ["Content-Type", "application/octet-stream"];
      response.headers = { "content-type": "application/octet-stream" };
      Object.defineProperty(response, "socket", { value: { remoteAddress: "93.184.216.34" } });
      callback(response);
    });
    return stream;
  });
  t.mock.method(cp, "spawn", (file: string, args: string[], options: cp.SpawnOptions) => {
    if (!versions.has(file)) return spawn(file, args, options);
    extractions++;
    if (failExtraction) return spawn(process.execPath, ["-e", "process.stderr.write('ERROR: Video unavailable'); process.exit(1)"], options);
    const info = { ...fixture, title: "Preview fixture", url: "https://media.example/film.mp4", protocol: "https", vcodec: "avc1", acodec: "mp4a", ...(kind === "vtt" ? { formats: [], couch_preview_vtt: "https://preview.example/previews.vtt" } : {}) };
    return spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(JSON.stringify(info))})`], options);
  });
  syncBuiltinESMExports();
  startHelpers(root); await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  downloads.mock.restore();
  const store = openStore(databasePath, true), tvId = "t".repeat(43), controllerId = "c".repeat(43);
  const tokens = { [tvId]: store.pair(tvId, "TV"), [controllerId]: store.pair(controllerId, "Controller") }; store.close();
  const hub = await createHub({ databasePath, hostToken: "h".repeat(64), hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(socket => socket.terminate()); await hub.close(); t.mock.restoreAll(); syncBuiltinESMExports(); process.env.PATH = originalPath; rmSync(directory, { recursive: true, force: true }); });
  const connect = async (id: string, share: boolean) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${tokens[id]}&device=${id}&audio=${+share}&video=${+share}`, { headers: { Origin: hub.origin } }); sockets.push(socket);
    const messages: ServerMessage[] = []; let state: SessionState | undefined, seq = 0;
    const pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    socket.on("message", data => { const message = JSON.parse(String(data)) as ServerMessage; messages.push(message); if (message.type === "state") state = message.state; if (message.type === "result") pending.get(message.requestId)?.(message); });
    await until(() => !!state);
    return { messages, get state() { return state!; }, report: () => socket.send(JSON.stringify({ type: "player", state: { ...state!.player, status: "playing", duration: 693, seekable: true, buffering: false, speed: 1 } })), command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => { const requestId = String(++seq); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action })); }) };
  };
  const tv = await connect(tvId, true), controller = await connect(controllerId, false);
  assert.equal((await tv.command({ type: "enqueue", entry: { id: "film", title: "Film", source: "web:https://www.youtube.com/watch?v=vWLJeqLPfSU" }, playNow: true, deviceId: tvId })).ok, true);
  await until(() => tv.messages.some(message => message.type === "player" && message.command.type === "load"));
  let playbackId = tv.state.player.playbackId!;
  const read = (token = tokens[controllerId]) => fetch(`${hub.origin}/api/playback-preview?playbackId=${playbackId}`, { headers: { Authorization: `Bearer ${token}`, Origin: hub.origin } });
  assert.equal((await read("invalid")).status, 401);
  assert.equal(manifests, 0, "No preview manifest before an authorized request");
  const response = await read(); assert.equal(response.status, 200);
  const text = await response.text(); assert.equal(JSON.parse(text).images, kind === "vtt" ? 1 : 6); assert.ok(!text.includes("ytimg")); assert.ok(!text.includes("preview.example"));
  if (kind === "vtt") { assert.equal(JSON.parse(text).duration, 32); assert.equal(manifests, 1); }
  assert.equal(extractions, 1, "preview reuses playback extraction");
  assert.ok(!controller.messages.some(message => message.type === "player" && message.command.type === "load"), "controller creates no receiver");
  assert.ok(!JSON.stringify(tv.messages).includes("preview.example"));
  assert.ok(!JSON.stringify(tv.messages).includes("storyboard3"), "renderer commands do not leak preview URLs");
  tv.report(); await until(() => tv.state.player.status === "playing");
  failExtraction = true;
  assert.equal((await tv.command({ type: "videoQuality", playbackId, quality: "720p" })).ok, false);
  assert.equal(tv.state.player.playbackId, playbackId);
  assert.equal((await read()).status, 200, "failed quality change retains the active preview");
  if (kind === "vtt") assert.equal(manifests, 1, "Failed quality change retains the same lazy metadata");
  failExtraction = false;
  const timeout = AbortSignal.timeout, deadlines: AbortController[] = [];
  const deadlineMock = t.mock.method(AbortSignal, "timeout", (ms: number) => {
    if (ms !== 30_000) return timeout(ms);
    const controller = new AbortController(); deadlines.push(controller); return controller.signal;
  });
  const previousId = playbackId;
  assert.equal((await tv.command({ type: "videoQuality", playbackId, quality: "720p" })).ok, true);
  await until(() => tv.state.player.playbackId !== previousId);
  playbackId = tv.state.player.playbackId!;
  assert.ok(deadlines.length > 0);
  deadlines.forEach(controller => controller.abort(new DOMException("Resolution deadline", "TimeoutError")));
  deadlineMock.mock.restore();
  assert.equal((await read()).status, 200, "successful quality change outlives its extraction deadline");
  assert.equal((await fetch(`${hub.origin}/api/playback-preview?playbackId=${previousId}`, { headers: { Authorization: `Bearer ${tokens[tvId]}` } })).status, 404);
  assert.equal((await tv.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
  await until(() => tv.state.devices?.find(device => device.id === tvId)?.sharing?.audio === false);
  assert.equal((await read()).status, 404, "private output denies another controller");
  assert.equal((await tv.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  await until(() => tv.state.devices?.find(device => device.id === tvId)?.sharing?.audio === true);
  assert.equal((await read()).status, 200);
  const revoke = openStore(databasePath, true); revoke.pair(controllerId, "Repaired controller"); revoke.close();
  assert.equal((await read()).status, 401, "replaced token loses access");
  if (kind === "vtt") {
    tv.report(); await until(() => tv.state.player.status === "playing");
    const old = playbackId;
    assert.equal((await tv.command({ type: "videoQuality", playbackId, quality: "480p" })).ok, true);
    await until(() => tv.state.player.playbackId !== old);
    playbackId = tv.state.player.playbackId!;
    hangManifest = true;
    const late = read(tokens[tvId]);
    await until(() => !!pendingManifest);
    assert.equal((await tv.command({ type: "stop" })).ok, true);
    assert.equal((await late).status, 404, "Stopped playback cannot return late manifest data");
    assert.equal(pendingManifest?.aborted, true, "Stop cancels the admitted preview's manifest request");
  } else assert.equal((await tv.command({ type: "stop" })).ok, true);
  assert.equal((await read(tokens[tvId])).status, 404);
});

test("initial loads, direct reloads and quality changes never send private preview descriptors to a renderer", async () => {
  const store = openStore(":memory:");
  const media: MediaSource = { source: "https://media.example/video.mp4", preview: storyboardPreview(fixture) };
  const commands: PlaybackCommand[] = [];
  let state: SessionState;
  const session = createSession({ ...store, ...store.playback("preview") }, command => commands.push(command), next => { state = structuredClone(next); }, { resolveSource: () => media });
  try {
    session.command({ type: "enqueue", entry: { id: "film", title: "Film", source: "web:https://www.youtube.com/watch?v=vWLJeqLPfSU" }, playNow: true });
    session.observe({ ...state!.player, status: "playing", duration: 693, seekable: true });
    session.reload(media);
    await session.command({ type: "videoQuality", playbackId: state!.player.playbackId!, quality: "720p" });
    const loads = commands.filter(command => command.type === "load");
    assert.equal(loads.length, 3);
    assert.ok(loads.every(command => !("preview" in command)));
    assert.ok(!JSON.stringify(commands).includes("i.ytimg.com"));
  } finally { session.close(); store.close(); }
});
