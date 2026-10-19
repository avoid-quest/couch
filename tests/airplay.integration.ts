import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { access, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket as NetSocket } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import WebSocket from "ws";
import { Identity } from "@sonn-audio/node-sendspin";
import { createAirPlay } from "../src/server/airplay";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { AirPlayState } from "../src/shared/airplay";
import type { Action, PlaybackCommand, ServerMessage, SessionState } from "../src/shared/protocol";

// Real Core, HTTP, WebSockets, setpriv, stdbuf and FFmpeg. UxPlay is a script that speaks its
// interface: the log lines Couch reads and RFC 4571-framed L16 RTP on fd 3, which the test drives.
// No AirPlay sender or network discovery is involved; that needs real Apple hardware (docs/airplay.md).
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
const linux = process.platform === "linux" && spawnSync("setpriv", ["--version"], { stdio: "ignore" }).status === 0;

// A stand-in Core for the test that kills one: it runs only the receiver, until killed.
if (process.env.COUCH_TEST_AIRPLAY_CORE) {
  const { executable, directory } = JSON.parse(process.env.COUCH_TEST_AIRPLAY_CORE) as { executable: string; directory: string };
  createAirPlay({ executable, directory, enabled: true, network: () => true, name: () => "Couch", identity: () => ({ code: "1234", deviceId: "02:00:00:00:00:01" }), sessions: { started() {}, audio() {}, ended() {} }, changed() {} });
  await new Promise(() => {});
}

const fakeUxPlay = `#!${process.execPath}
const net = require('node:net'), fs = require('node:fs');
const control = net.connect(process.env.COUCH_TEST_UXPLAY_CONTROL);
control.write(JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, cache: process.env.XDG_CACHE_HOME, rc: process.env.UXPLAYRC ?? null, pid: process.pid }) + '\\n');
let pending = '', timer;
// rtpL16pay ! rtpstreampay: 10 ms of 44.1 kHz stereo S16BE per packet, after a 16-bit length.
const tone = ({ frequency, ssrc = 0x5eed }) => {
  clearInterval(timer);
  const started = Date.now();
  let sent = 0;
  timer = setInterval(() => {
    for (; sent < Math.floor((Date.now() - started) / 10); sent++) {
      const packet = Buffer.alloc(14 + 441 * 4);
      packet.writeUInt16BE(packet.length - 2, 0);
      packet[2] = 0x80; packet[3] = 96;
      packet.writeUInt16BE(sent & 0xffff, 4);
      packet.writeUInt32BE(sent * 441, 6);
      packet.writeUInt32BE(ssrc, 10);
      for (let i = 0; i < 441; i++) {
        const value = Math.round(8000 * Math.sin(2 * Math.PI * frequency * (sent * 441 + i) / 44100));
        packet.writeInt16BE(value, 14 + i * 4); packet.writeInt16BE(value, 16 + i * 4);
      }
      fs.writeSync(3, packet);
    }
  }, 5);
};
const run = command => {
  if (command.log) console.log(command.log);
  if (command.stderr) console.error(command.stderr);
  if (command.tone) tone(command.tone);
  if (command.quiet) clearInterval(timer);
  if (command.raw) fs.writeSync(3, Buffer.from(command.raw, 'base64'));
  if (command.exit !== undefined) process.exit(command.exit);
};
control.on('data', chunk => {
  pending += chunk;
  for (let index; (index = pending.indexOf('\\n')) >= 0; pending = pending.slice(index + 1)) run(JSON.parse(pending.slice(0, index)));
});
control.on('close', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
`;

type Fake = { argv: string[]; home: string; cache: string; rc: string | null; pid: number; send: (command: object) => void; closed: Promise<unknown> };
// A process nobody has reaped yet (a container's init may not) has still ended.
const alive = (pid: number) => { try { process.kill(pid, 0); return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return false; } };
async function until(check: () => boolean | Promise<boolean>, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) { if (Date.now() > deadline) throw new Error("AirPlay did not reach the expected state."); await new Promise(resolve => setTimeout(resolve, 20)); }
}

async function fixture(t: TestContext, { executable = true, uxplay: replacement }: { executable?: boolean; uxplay?: string } = {}) {
  // Core's provider checks stay offline.
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input)) ? fetchLocal(input, init) : Promise.resolve(new Response(""))) as typeof fetch;
  const directory = await mkdtemp(join(tmpdir(), "couch-airplay-")), databasePath = join(directory, "data", "couch.sqlite");
  const uxplay = join(directory, "uxplay"), control = join(directory, "control.sock");
  await writeFile(uxplay, replacement ?? fakeUxPlay, { mode: 0o755 });
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }'); // Wherever the checkout puts temporary files
  // Real FFmpeg, found through Couch's own helper lookup.
  const previousPath = process.env.PATH, previousControl = process.env.COUCH_TEST_UXPLAY_CONTROL;
  if (process.env.COUCH_TEST_FFMPEG) process.env.PATH = `${dirname(process.env.COUCH_TEST_FFMPEG)}${delimiter}${previousPath ?? ""}`;
  process.env.COUCH_TEST_UXPLAY_CONTROL = control;
  const fakes: Fake[] = [];
  const server = createServer((socket: NetSocket) => {
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
      pending += chunk;
      const index = pending.indexOf("\n");
      if (index < 0 || fakes.some(fake => fake.send === send)) return;
      fakes.push({ ...JSON.parse(pending.slice(0, index)), send, closed: once(socket, "close") });
    });
    const send = (command: object) => socket.write(`${JSON.stringify(command)}\n`);
  });
  server.listen(control);
  await once(server, "listening");
  const store = openStore(databasePath, true);
  const receiverId = Identity.generate().peerId, receiverToken = store.pair(receiverId, "Receiver");
  const controllerId = Identity.generate().peerId, controllerToken = store.pair(controllerId, "Controller");
  store.close();
  const hostToken = "h".repeat(64);
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0, advertisedUrls: [], ...executable ? { airplayExecutable: uxplay } : {} });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await hub.close();
    for (const fake of fakes) if (alive(fake.pid)) process.kill(fake.pid, "SIGKILL");
    server.close();
    globalThis.fetch = fetchLocal;
    process.env.PATH = previousPath;
    if (previousControl === undefined) delete process.env.COUCH_TEST_UXPLAY_CONTROL; else process.env.COUCH_TEST_UXPLAY_CONTROL = previousControl;
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path: string, { token = hostToken, body }: { token?: string; body?: object } = {}) =>
    fetch(`${hub.origin}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, Origin: hub.origin, ...body ? { "Content-Type": "application/json" } : {} }, body: body ? JSON.stringify(body) : undefined });
  const airplay = async () => await (await request("/api/settings/airplay")).json() as AirPlayState;
  const player = async () => (await (await fetch(`${hub.origin}/api/connection`, { headers: { Origin: hub.origin } })).json() as { player: string }).player;
  const connect = async (id: string, token: string) => {
    const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}`, { headers: { Origin: hub.origin } });
    sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined, sequence = 0;
    socket.on("message", data => {
      const message = JSON.parse(String(data)) as ServerMessage;
      messages.push(message);
      if (message.type === "state") state = message.state;
      if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
    });
    await until(() => !!state);
    return {
      messages, get state() { return state!; },
      command: (action: Action) => new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => { const requestId = String(++sequence); pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action })); }),
      load: () => { const message = messages.findLast(message => message.type === "player" && message.command.type === "load"); return message?.type === "player" ? message.command as Extract<PlaybackCommand, { type: "load" }> : undefined; },
    };
  };
  const next = async (count: number) => { await until(() => fakes.length >= count); return fakes[count - 1]!; };
  return { hub, directory, databasePath, uxplay, fakes, next, request, airplay, player, connect, receiver: { id: receiverId, token: receiverToken }, controller: { id: controllerId, token: controllerToken }, hostToken };
}

const ready = async (fake: Fake, airplay: () => Promise<AirPlayState>) => { fake.send({ log: "Initialized server socket(s)" }); await until(async () => (await airplay()).status === "ready"); };

test("AirPlay stays off until an admin turns it on, and runs UxPlay only in Couch's own data", { skip: !linux }, async t => {
  const { request, airplay, fakes, next, directory, controller } = await fixture(t);
  const initial = await airplay();
  assert.equal(initial.status, "off");
  assert.match(initial.code, /^\d{4}$/);
  assert.equal((await request("/api/settings/airplay", { token: controller.token })).status, 403);
  assert.equal((await request("/api/settings/airplay", { token: controller.token, body: { enabled: true } })).status, 403);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(fakes.length, 0, "nothing listens for AirPlay while it is off");

  assert.equal((await request("/api/settings/airplay", { body: { enabled: true } })).status, 200);
  const fake = await next(1);
  const own = join(directory, "data", "airplay");
  const option = (name: string) => fake.argv[fake.argv.indexOf(name) + 1];
  assert.equal(option("-n"), "Couch");
  assert.ok(fake.argv.includes("-nh"));
  assert.equal(option("-vs"), "0", "sound only: UxPlay renders no picture");
  assert.equal(option("-artp"), "pt=96 ! rtpstreampay ! fdsink fd=3 sync=false", "decoded sound goes only to Core's private pipe");
  assert.equal(option("-pin"), initial.code);
  assert.equal(option("-reg"), join(own, "register"));
  assert.equal(option("-key"), join(own, "key.pem"));
  assert.match(option("-m")!, /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/);
  assert.equal(parseInt(option("-m")!.slice(0, 2), 16) & 3, 2, "a locally administered unicast address");
  assert.ok(!fake.argv.includes("-nohold"), "one sender at a time: a new one can't take over");
  assert.deepEqual([fake.home, fake.cache, fake.rc], [own, join(own, "cache"), null], "no ~/.uxplayrc or registration outside Couch's data applies");
  assert.equal((await airplay()).status, "starting");
  await ready(fake, airplay);
  const identity = option("-m");

  // Off stops the receiver; on again keeps the same identity and code.
  assert.equal((await request("/api/settings/airplay", { body: { enabled: false } })).status, 200);
  await fake.closed;
  await until(() => !alive(fake.pid));
  assert.equal((await airplay()).status, "off");
  await request("/api/settings/airplay", { body: { enabled: true } });
  const again = await next(2);
  assert.equal(again.argv[again.argv.indexOf("-m") + 1], identity);
  assert.equal(again.argv[again.argv.indexOf("-pin") + 1], initial.code);

  // UxPlay listens on every interface: it runs only while the Couch is shared on the network.
  await ready(again, airplay);
  assert.equal((await request("/api/settings/sharing", { body: { enabled: false } })).status, 200);
  await until(() => !alive(again.pid));
  assert.equal((await airplay()).status, "waiting");
  await request("/api/settings/sharing", { body: { enabled: true } });
  await next(3);
});

test("a connection is not admission: only a sender's decoded sound publishes a source, and nobody plays it until asked", { skip: !linux }, async t => {
  const { hub, airplay, player, next, request, connect, hostToken, receiver } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken);

  // Connecting, naming itself, even being asked for the code: none of it is a session.
  fake.send({ log: "Accepted IPv4 client on socket 31, port 7000" });
  fake.send({ log: "connection request from Mallory (iPhone14,2) with deviceID = AA:BB:CC:DD:EE:FF" });
  fake.send({ log: "*** CLIENT MUST NOW ENTER PIN = \"1234\" AS AIRPLAY PASSWORD" });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal((await airplay()).status, "ready");
  assert.equal(await player(), "idle", "an unadmitted connection never holds off updates");
  assert.deepEqual(host.state.liveSources ?? [], []);
  // Sound flushed after every connection closed is not a sender either.
  fake.send({ log: "Connection closed on socket 31" });
  fake.send({ tone: { frequency: 440 } });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(host.state.liveSources ?? [], []);
  fake.send({ quiet: true });

  fake.send({ log: "Accepted IPv4 client on socket 32, port 7000" });
  fake.send({ log: "connection request from Kitchen\u0007 iPhone (iPhone15,3) with deviceID = 11:22:33:44:55:66" });
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!host.state.liveSources?.length);
  const [source] = host.state.liveSources!;
  assert.deepEqual({ ...source, id: undefined }, { id: undefined, deviceId: "airplay", name: "AirPlay · Kitchen iPhone", kind: "airplay", audio: true, video: false });
  assert.equal((await airplay()).status, "receiving");
  assert.equal((await airplay()).sender, "Kitchen iPhone");
  assert.equal(await player(), "playing", "an admitted sender holds off unattended updates before anyone plays it");
  assert.deepEqual(host.state.playbacks ?? [], [], "AirPlay never takes over a playback by itself");

  // Another sender trying meanwhile changes nothing; UxPlay refuses it (no -nohold).
  fake.send({ log: "Accepted IPv4 client on socket 40, port 7000" });
  fake.send({ log: "connection request from Intruder (iPhone9,1) with deviceID = 66:55:44:33:22:11" });
  fake.send({ log: "Connection closed on socket 40" });
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.equal((await airplay()).sender, "Kitchen iPhone");
  assert.equal(host.state.liveSources?.length, 1);

  // No device can end Core's source or send it media; the host included.
  const other = await connect(receiver.id, receiver.token);
  assert.equal((await other.command({ type: "endLive", sourceId: source!.id })).ok, false);
  for (const token of [receiver.token, hostToken]) assert.equal((await fetch(`${hub.origin}/api/live/upload?${new URLSearchParams({ sourceId: source!.id, key: "1".repeat(64), token })}`, { headers: { Origin: hub.origin } })).status, 403);
  assert.equal(host.state.liveSources?.length, 1);
});

test("playing AirPlay delivers the sender's sound through Couch's buffered stream, and the sender leaving ends it everywhere", { skip: !linux || !hasFfmpeg, timeout: 60_000 }, async t => {
  const { airplay, player, next, request, connect, hostToken, receiver } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken), device = await connect(receiver.id, receiver.token);
  fake.send({ log: "Accepted IPv4 client on socket 32, port 7000" });
  fake.send({ log: "connection request from Kitchen iPhone (iPhone15,3) with deviceID = 11:22:33:44:55:66" });
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!device.state.liveSources?.length);
  const source = device.state.liveSources![0]!;
  assert.equal((await device.command({ type: "playLive", sourceId: source.id, deviceId: receiver.id })).ok, true);
  // Every receiver plays Core's HLS of it, in the ordinary player; nothing is peer-to-peer.
  await until(() => !!device.load()?.hls, 30_000);
  const load = device.load()!;
  assert.match(load.source, /\/api\/live\/media\/[^/]+\/[^/]+\/[^/]+\/audio\/[^/]+\/stream\.m3u8$/);
  assert.equal(load.livePeerId, undefined);
  // Past the first segment, which begins with the quarter second Core holds back for late packets.
  let playlist = "";
  await until(async () => (playlist = await (await fetch(load.source)).text()).split("#EXTINF").length > 3, 15_000);
  const segment = playlist.split("\n").findLast(line => line.endsWith(".ts"))!;
  const media = Buffer.from(await (await fetch(new URL(segment, load.source))).arrayBuffer());
  const decoded = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "44100", "-f", "s16le", "pipe:1"], { input: media });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  const samples = Array.from({ length: decoded.stdout.length / 2 }, (_, index) => decoded.stdout.readInt16LE(index * 2));
  assert.ok(samples.length > 44100 / 2, "a segment holds the sender's sound");
  const crossings = samples.slice(1).filter((value, index) => value >= 0 !== samples[index]! >= 0).length;
  const frequency = crossings / 2 / (samples.length / 44100);
  assert.ok(Math.abs(frequency - 440) < 15, `the sender's 440 Hz tone arrives, not silence or noise (${frequency.toFixed(1)} Hz)`);
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  assert.ok(rms > 3000, `at the sender's level (${rms.toFixed(0)})`);
  // Where it plays shows what it plays, not the browser fallback's Buffered.
  assert.equal(device.state.outputs?.find(output => output.deviceId === receiver.id)?.buffered, undefined);

  // The sender stops AirPlay: its connections close. The source, its playback and busy-ness end.
  fake.send({ quiet: true });
  fake.send({ log: "Connection closed on socket 32" });
  await until(() => !device.state.liveSources?.length);
  await until(() => device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  await until(async () => await player() === "idle");
  assert.equal((await airplay()).status, "ready");
  assert.equal((await airplay()).sender, null);
  void host;
});

test("turning AirPlay off ends the receiver and its source; a crashing receiver restarts a bounded number of times", { skip: !linux }, async t => {
  const { airplay, player, next, request, connect, hostToken, fakes } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  let fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken);
  fake.send({ log: "Accepted IPv4 client on socket 32, port 7000" });
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!host.state.liveSources?.length);
  assert.equal(host.state.liveSources![0]!.name, "AirPlay · AirPlay device");
  await request("/api/settings/airplay", { body: { enabled: false } });
  await until(() => !alive(fake.pid));
  await until(() => !host.state.liveSources?.length);
  assert.equal(await player(), "idle");

  await request("/api/settings/airplay", { body: { enabled: true } });
  fake = await next(2);
  await ready(fake, airplay);
  // A crash in a session ends it, then UxPlay starts again.
  fake.send({ log: "Accepted IPv4 client on socket 32, port 7000" });
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!host.state.liveSources?.length);
  fake.send({ exit: 1 });
  await until(() => !host.state.liveSources?.length);
  for (let count = 3; count <= 5; count++) {
    fake = await next(count);
    if (count < 5) fake.send({ exit: 1 });
  }
  fake.send({ exit: 1 });
  await until(async () => (await airplay()).status === "error");
  assert.match((await airplay()).error!, /keeps stopping/);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.equal(fakes.length, 5, "restarts are bounded");
  // Off and on retries.
  await request("/api/settings/airplay", { body: { enabled: false } });
  await request("/api/settings/airplay", { body: { enabled: true } });
  await next(6);
});

test("a missing runtime says what to install instead of restarting, and a new code forgets paired senders", { skip: !linux }, async t => {
  const { airplay, next, request, fakes, directory } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  let fake = await next(1);
  fake.send({ log: "Required gstreamer plugin 'libav' not found" });
  fake.send({ exit: 1 });
  await until(async () => (await airplay()).status === "error");
  assert.match((await airplay()).error!, /gstreamer1\.0-libav/);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.equal(fakes.length, 1);
  // What UxPlay 1.74 prints, then exits 0, where multicast can't be used.
  await request("/api/settings/airplay", { body: { enabled: false } });
  await request("/api/settings/airplay", { body: { enabled: true } });
  fake = await next(2);
  fake.send({ log: "Initialized server socket(s)" });
  fake.send({ log: "*** ERROR: dnssd_register_raop failed with error code -19" });
  fake.send({ exit: 0 });
  await until(async () => (await airplay()).status === "error");
  assert.match((await airplay()).error!, /multicast and UDP port 5353/);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.equal(fakes.length, 2);

  await request("/api/settings/airplay", { body: { enabled: false } });
  await request("/api/settings/airplay", { body: { enabled: true } });
  fake = await next(3);
  await ready(fake, airplay);
  const before = (await airplay()).code;
  await writeFile(join(directory, "data", "airplay", "register"), "key,AA:BB:CC:DD:EE:FF,Old iPhone\n");
  const response = await request("/api/settings/airplay/code", { body: {} });
  assert.equal(response.status, 200);
  const after = (await response.json() as AirPlayState).code;
  await until(() => !alive(fake.pid));
  fake = await next(4);
  assert.equal(fake.argv[fake.argv.indexOf("-pin") + 1], after);
  await assert.rejects(access(join(directory, "data", "airplay", "register")), "senders paired with the old code are forgotten");
  // 1 in 10,000 that a fresh code repeats.
  if (after === before) t.diagnostic("the new code matched the old one by chance");
});

test("AirPlay explains where it can't run", async t => {
  const darwin = createAirPlay({ executable: "/nonexistent", directory: "/nonexistent", enabled: true, network: () => true, name: () => "Couch", identity: () => ({ code: "1234", deviceId: "02:00:00:00:00:01" }), sessions: { started() {}, audio() {}, ended() {} }, changed() {}, platform: "darwin" });
  assert.equal(darwin.state().status, "unsupported");
  assert.match(darwin.state().error!, /Linux/);
  await darwin.close();
  const { request, airplay } = await fixture(t, { executable: false });
  if (process.platform === "linux") {
    assert.equal((await airplay()).status, "unavailable");
    const refused = await request("/api/settings/airplay", { body: { enabled: true } });
    assert.equal(refused.status, 409);
    assert.match((await refused.json() as { error: string }).error, /doesn't include the AirPlay receiver/);
  }
});

test("UxPlay ends with Core however Core ends", { skip: !linux }, async t => {
  const { directory, uxplay, fakes, next } = await fixture(t);
  const core = spawn(process.execPath, [process.argv[1]!], { env: { ...process.env, COUCH_TEST_AIRPLAY_CORE: JSON.stringify({ executable: uxplay, directory: join(directory, "core") }) }, stdio: "ignore" });
  t.after(() => { core.kill("SIGKILL"); });
  const fake = await next(1);
  assert.ok(alive(fake.pid));
  core.kill("SIGKILL");
  await until(() => !alive(fake.pid));
  assert.equal(fakes.length, 1);
});

// GStreamer's own payloader and framing, exactly as Couch asks UxPlay to configure them.
const gstLaunch = process.env.COUCH_TEST_GST_LAUNCH;
test("sound framed by GStreamer's rtpL16pay and rtpstreampay plays as sent", { skip: !linux || !hasFfmpeg || !gstLaunch, timeout: 60_000 }, async t => {
  const pipeline = "audiotestsrc is-live=true freq=440 volume=0.3 ! audioconvert ! audio/x-raw,format=S16BE,rate=44100,channels=2 ! rtpL16pay pt=96 ! rtpstreampay ! fdsink fd=3 sync=false";
  const script = `#!/bin/sh
echo 'Initialized server socket(s)'
echo 'Accepted IPv4 client on socket 30, port 7000'
echo 'connection request from GStreamer (gst-launch) with deviceID = 02:00:00:00:00:02'
exec ${gstLaunch} -q ${pipeline}
`;
  const { airplay, next, request, connect, receiver } = await fixture(t, { uxplay: script });
  void next;
  await request("/api/settings/airplay", { body: { enabled: true } });
  const device = await connect(receiver.id, receiver.token);
  await until(() => !!device.state.liveSources?.length, 15_000);
  assert.equal((await airplay()).sender, "GStreamer");
  assert.equal((await device.command({ type: "playLive", sourceId: device.state.liveSources![0]!.id, deviceId: receiver.id })).ok, true);
  await until(() => !!device.load()?.hls, 30_000);
  const load = device.load()!;
  let playlist = "";
  await until(async () => (playlist = await (await fetch(load.source)).text()).split("#EXTINF").length > 3, 15_000);
  const media = Buffer.from(await (await fetch(new URL(playlist.split("\n").findLast(line => line.endsWith(".ts"))!, load.source))).arrayBuffer());
  const decoded = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "44100", "-f", "s16le", "pipe:1"], { input: media });
  const samples = Array.from({ length: decoded.stdout.length / 2 }, (_, index) => decoded.stdout.readInt16LE(index * 2));
  const crossings = samples.slice(1).filter((value, index) => value >= 0 !== samples[index]! >= 0).length;
  const frequency = crossings / 2 / (samples.length / 44100);
  assert.ok(Math.abs(frequency - 440) < 15, `GStreamer's 440 Hz tone (${frequency.toFixed(1)} Hz)`);
  // A continuous tone: no gaps from framing, timestamps or pacing.
  const quiet = samples.findIndex((_, index) => index + 441 <= samples.length && samples.slice(index, index + 441).every(value => Math.abs(value) < 500));
  assert.equal(quiet, -1, "no 10 ms of silence inside a segment of a continuous tone");
});

// The UxPlay build Couch ships, with the arguments Couch gives it. No sender is involved.
const realUxPlay = process.env.COUCH_TEST_UXPLAY;
const listening = async (pid: number) => {
  const sockets = new Set((await Promise.all((await readdir(`/proc/${pid}/fd`)).map(fd => readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")))).flatMap(link => /^socket:\[(\d+)\]$/.exec(link)?.[1] ?? []));
  const table = (await readFile(`/proc/${pid}/net/tcp`, "utf8")).split("\n").slice(1).map(line => line.trim().split(/\s+/));
  return table.filter(fields => fields[3] === "0A" && sockets.has(fields[9]!)).map(fields => parseInt(fields[1]!.split(":")[1]!, 16));
};
test("the real UxPlay starts with Couch's arguments, and a connection that never pairs publishes nothing", { skip: !linux || !realUxPlay, timeout: 60_000 }, async t => {
  const { airplay, player, request, connect, hostToken, directory } = await fixture(t, { uxplay: `#!/bin/sh\nexec ${realUxPlay} "$@"\n` });
  await request("/api/settings/airplay", { body: { enabled: true } });
  await until(async () => ["ready", "error"].includes((await airplay()).status), 20_000);
  const state = await airplay();
  assert.equal(state.status, "ready", state.error ?? "");
  const host = await connect(Identity.generate().peerId, hostToken);
  const commands = await Promise.all((await readdir("/proc")).filter(entry => /^\d+$/.test(entry)).map(async entry => [Number(entry), await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "")] as const));
  const pid = commands.find(([, command]) => command.startsWith(`${realUxPlay}\0`))?.[0] ?? 0;
  assert.ok(pid, "UxPlay runs");
  const ports = await listening(pid);
  assert.ok(ports.length, "UxPlay listens for senders");
  assert.ok((await readFile(`/proc/${pid}/environ`, "utf8")).split("\0").includes(`HOME=${join(directory, "data", "airplay")}`));
  // Speak to it as a sender that hasn't paired: it answers, but Couch publishes nothing.
  const { createConnection } = await import("node:net");
  const socket = createConnection({ host: "127.0.0.1", port: ports[0]! });
  await once(socket, "connect");
  socket.write("GET /info RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: AirPlay/800.0\r\n\r\n");
  const [answer] = await once(socket, "data") as [Buffer];
  assert.match(String(answer), /^RTSP\/1\.0 200/);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await player(), "idle");
  assert.deepEqual(host.state.liveSources ?? [], []);
  socket.end();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal((await airplay()).status, "ready");
  // Off ends it promptly, through its own shutdown.
  const stopped = Date.now();
  await request("/api/settings/airplay", { body: { enabled: false } });
  await until(() => !alive(pid));
  assert.ok(Date.now() - stopped < 3_000, "UxPlay exits on SIGTERM without being killed");
});
