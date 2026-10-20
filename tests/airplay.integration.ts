import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Socket as NetSocket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
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
  // What pinned UxPlay may do as its sender leaves (lib/httpd.c): log the removal before it stops
  // decoding, so a last packet follows, then accept the next RTSP connection at once.
  if (command.leave) {
    clearInterval(timer);
    console.log('removing connection type RAOP socket ' + command.leave.socket + ' conn 0x1');
    const packet = Buffer.alloc(14 + 441 * 4);
    packet.writeUInt16BE(packet.length - 2, 0); packet[2] = 0x80; packet[3] = 96;
    packet.writeUInt32BE(0x5eed, 10);
    fs.writeSync(3, packet);
    console.log('New connection 0x2 identified as Connection type RAOP');
  }
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
// What UxPlay 1.74 logs with -d 1 (lib/httpd.c, lib/raop.c, lib/raop_handlers.h): any TCP connection,
// then the one it takes as its RTSP sender, which it refuses to a second while one is open, that sender
// setting up audio once admitted, and each connection's removal.
const accepted = (fake: Fake, socket: number) => fake.send({ log: `Accepted IPv4 client on socket ${socket}, port 7000` });
const sender = (fake: Fake, socket: number, name?: string, admitted = true) => {
  accepted(fake, socket);
  fake.send({ log: `New connection 0x${socket} identified as Connection type RAOP` });
  if (name) fake.send({ log: `connection request from ${name} (iPhone15,3) with deviceID = 11:22:33:44:55:${socket}` });
  // An admitted sender passes UxPlay's password check, then sets up its audio stream.
  if (admitted) { fake.send({ log: "Client authentication success" }); fake.send({ log: "RAOP initialized success" }); }
};
const closed = (fake: Fake, socket: number, type = "RAOP") => {
  fake.send({ log: `removing connection type ${type} socket ${socket} conn 0x${socket}` });
  fake.send({ log: `Connection closed on socket ${socket}` });
};

test("AirPlay stays off until an admin turns it on, and runs UxPlay only in Couch's own data", { skip: !linux }, async t => {
  const { request, airplay, fakes, next, directory, controller } = await fixture(t);
  const initial = await airplay();
  assert.equal(initial.status, "off");
  assert.match(initial.code, /^[a-hj-km-np-z2-9]{4}(?:-[a-hj-km-np-z2-9]{4}){2}$/, "a password that can't be guessed by trying");
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
  assert.equal(option("-d"), "1", "UxPlay's debug log names its sender connection, without packet data");
  assert.equal(option("-vs"), "0", "sound only: UxPlay renders no picture");
  assert.equal(option("-artp"), "pt=96 ! rtpstreampay ! fdsink fd=3 sync=false", "decoded sound goes only to Core's private pipe");
  // The code is UxPlay's password, which it requires before it sets up any sound. It is in a file
  // only Couch can read, not on a command line everyone on the computer can see.
  assert.ok(!fake.argv.includes("-pin") && !fake.argv.includes("-reg"), "-pin pairing doesn't stop a sender that skips it");
  assert.ok(!fake.argv.includes(initial.code));
  assert.equal(option("-rc"), join(own, "uxplayrc"));
  assert.equal(await readFile(join(own, "uxplayrc"), "utf8"), `pw ${initial.code}\n`);
  assert.equal((await stat(join(own, "uxplayrc"))).mode & 0o777, 0o600);
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
  assert.equal(await readFile(join(own, "uxplayrc"), "utf8"), `pw ${initial.code}\n`);

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
  sender(fake, 31, "Mallory", false);
  fake.send({ log: "*** CLIENT MUST NOW ENTER PIN = \"1234\" AS AIRPLAY PASSWORD" });
  // Sound while it is connected isn't its: it never set up audio.
  fake.send({ tone: { frequency: 440 } });
  await new Promise(resolve => setTimeout(resolve, 300));
  fake.send({ quiet: true });
  assert.equal((await airplay()).status, "ready");
  assert.equal(await player(), "idle", "an unadmitted connection never holds off updates");
  assert.deepEqual(host.state.liveSources ?? [], []);
  // Sound flushed after every connection closed is not a sender either.
  closed(fake, 31);
  fake.send({ tone: { frequency: 440 } });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(host.state.liveSources ?? [], []);
  fake.send({ quiet: true });

  sender(fake, 32, "Kitchen\u0007 iPhone");
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!host.state.liveSources?.length);
  const [source] = host.state.liveSources!;
  assert.deepEqual({ ...source, id: undefined }, { id: undefined, deviceId: "airplay", name: "AirPlay · Kitchen iPhone", kind: "airplay", audio: true, video: false });
  assert.equal((await airplay()).status, "receiving");
  assert.equal((await airplay()).sender, "Kitchen iPhone");
  assert.equal(await player(), "playing", "an admitted sender holds off unattended updates before anyone plays it");
  assert.deepEqual(host.state.playbacks ?? [], [], "AirPlay never takes over a playback by itself");

  // Another sender trying meanwhile changes nothing; UxPlay refuses it (no -nohold).
  accepted(fake, 40);
  fake.send({ log: "*** WARNING: rejecting new connection request from 192.168.1.9" });
  closed(fake, 40, "Unknown");
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
  sender(fake, 32, "Kitchen iPhone");
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
  closed(fake, 32);
  await until(() => !device.state.liveSources?.length);
  await until(() => device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  await until(async () => await player() === "idle");
  assert.equal((await airplay()).sender, null);
  // A fresh UxPlay serves the next sender, so nothing the last one left behind reaches it.
  await ready(await next(2), airplay);
  void host;
});

test("a sender's source ends with its own connection whatever else is connected, and the next sender never continues it", { skip: !linux || !hasFfmpeg, timeout: 60_000 }, async t => {
  const { airplay, player, next, request, connect, receiver } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const device = await connect(receiver.id, receiver.token);
  sender(fake, 31, "Alice");
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!device.state.liveSources?.length);
  const alice = device.state.liveSources![0]!;
  assert.equal((await device.command({ type: "playLive", sourceId: alice.id, deviceId: receiver.id })).ok, true);
  await until(() => !!device.load()?.hls, 30_000);
  const loads = () => device.messages.filter(message => message.type === "player" && message.command.type === "load").length;
  const loaded = loads();

  // Someone else connects meanwhile and never pairs. Alice leaves; that connection stays open.
  accepted(fake, 40);
  fake.send({ quiet: true });
  closed(fake, 31);
  await until(() => !device.state.liveSources?.length, 900);
  await until(() => device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  await until(async () => await player() === "idle", 900);
  // UxPlay restarts for the next sender, taking the unpaired connection with it.
  const second = await next(2);
  await ready(second, airplay);
  assert.deepEqual(device.state.liveSources ?? [], []);
  assert.equal(await player(), "idle", "an unpaired connection holds no session and no update off");

  // Bob plays at once: a new source, under his name, that nothing plays until someone chooses it.
  sender(second, 41, "Bob");
  second.send({ tone: { frequency: 880, ssrc: 0xb0b } });
  await until(() => !!device.state.liveSources?.length);
  const bob = device.state.liveSources![0]!;
  assert.notEqual(bob.id, alice.id);
  assert.equal(bob.name, "AirPlay · Bob");
  assert.equal((await airplay()).sender, "Bob");
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.equal(loads(), loaded, "Bob's sound never reaches the playback Alice's source had");
  assert.ok(!device.state.queue.some(entry => entry.liveSourceId === bob.id || entry.source.includes(bob.id)), "nor its queue");
  // Another connection opening and closing meanwhile changes nothing for Bob.
  accepted(second, 50);
  closed(second, 50, "Unknown");
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(device.state.liveSources?.[0]?.id, bob.id);

  // Straight after his last packet, the next sender is another session on another UxPlay.
  second.send({ quiet: true });
  closed(second, 41);
  const third = await next(3);
  await ready(third, airplay);
  sender(third, 42, "Carol");
  third.send({ tone: { frequency: 440, ssrc: 0xca } });
  await until(() => device.state.liveSources?.[0]?.name === "AirPlay · Carol");
  assert.equal(device.state.liveSources!.length, 1);
  assert.notEqual(device.state.liveSources![0]!.id, bob.id);
});

test("sound the last sender's decoding still sends after it left never admits the connection that follows, however Core reads the pipes", { skip: !linux }, async t => {
  const { airplay, player, next, request, connect, hostToken } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken);
  sender(fake, 31, "Alice");
  fake.send({ tone: { frequency: 440 } });
  await until(() => host.state.liveSources?.[0]?.name === "AirPlay · Alice");
  // Core stalls while UxPlay logs Alice's removal, writes her last packet and logs an unpaired
  // connection, so it reads both log lines before that packet.
  fake.send({ leave: { socket: 31 } });
  await new Promise(resolve => setTimeout(resolve, 25));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  await new Promise(resolve => setTimeout(resolve, 1_500));
  assert.deepEqual(host.state.liveSources, [], "only Alice sent sound, and she has left");
  assert.equal(await player(), "idle", "the unpaired connection holds no update off");
  await ready(await next(2), airplay);
  assert.deepEqual(host.state.liveSources, []);
});

test("the pipe's framing holds from its first byte, while UxPlay hasn't yet said whose the sound is", { skip: !linux }, async t => {
  const { airplay, next, request, connect, hostToken } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken);
  sender(fake, 31, "Alice", false);
  // Part of Alice's first frame arrives before Core reads that UxPlay authenticated her, the rest after.
  const packet = Buffer.alloc(14 + 441 * 4);
  packet.writeUInt16BE(packet.length - 2, 0); packet[2] = 0x80; packet[3] = 96; packet.writeUInt32BE(0x5eed, 10);
  fake.send({ raw: packet.subarray(0, 15).toString("base64") });
  await new Promise(resolve => setTimeout(resolve, 100));
  fake.send({ log: "Client authentication success" });
  fake.send({ log: "RAOP initialized success" });
  await new Promise(resolve => setTimeout(resolve, 100));
  fake.send({ raw: packet.subarray(15).toString("base64") });
  fake.send({ tone: { frequency: 440, ssrc: 0x5eed } });
  await until(() => host.state.liveSources?.[0]?.name === "AirPlay · Alice");
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(alive(fake.pid), "the receiver keeps running");
  assert.equal((await airplay()).status, "receiving");
});

test("a device that stops sharing its speakers leaves AirPlay waiting, and AirPlay stays published", { skip: !linux || !hasFfmpeg, timeout: 60_000 }, async t => {
  const { airplay, next, request, connect, receiver, controller } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  const fake = await next(1);
  await ready(fake, airplay);
  const device = await connect(receiver.id, receiver.token), other = await connect(controller.id, controller.token);
  sender(fake, 32, "Kitchen iPhone");
  fake.send({ tone: { frequency: 440 } });
  await until(() => !!device.state.liveSources?.length);
  const sourceId = device.state.liveSources![0]!.id;
  assert.equal((await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok, false, "only with the receiver's consent");
  assert.equal((await device.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
  assert.equal((await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok, true);
  await until(() => !!device.load()?.hls, 30_000);
  const revoked = await device.command({ type: "sharing", sharing: { audio: false, video: false } });
  assert.equal(revoked.ok, true, JSON.stringify(revoked));
  await until(() => device.messages.some(message => message.type === "player" && message.command.type === "stop"));
  assert.equal((await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok, false);
  assert.equal(device.state.liveSources?.length, 1);
  assert.equal((await airplay()).status, "receiving");
});

test("turning AirPlay off ends the receiver and its source; a crashing receiver restarts a bounded number of times", { skip: !linux }, async t => {
  const { airplay, player, next, request, connect, hostToken, fakes } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  let fake = await next(1);
  await ready(fake, airplay);
  const host = await connect(Identity.generate().peerId, hostToken);
  sender(fake, 32);
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
  sender(fake, 32);
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

test("a missing runtime says what to install instead of restarting, and a new code restarts AirPlay with it", { skip: !linux }, async t => {
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
  const response = await request("/api/settings/airplay/code", { body: {} });
  assert.equal(response.status, 200);
  const after = (await response.json() as AirPlayState).code;
  assert.notEqual(after, before);
  await until(() => !alive(fake.pid));
  fake = await next(4);
  // Devices that stored the old password fail UxPlay's check and ask for the new one.
  assert.equal(await readFile(join(directory, "data", "airplay", "uxplayrc"), "utf8"), `pw ${after}\n`);
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
echo 'New connection 0x30 identified as Connection type RAOP'
echo 'Client authentication success'
echo 'RAOP initialized success'
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
  const log = t.mock.method(console, "log");
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
  // Speak to it as senders that haven't paired: it answers, but Couch publishes nothing.
  const { createConnection } = await import("node:net");
  const logged = (line: string) => log.mock.calls.filter(call => String(call.arguments[0]).endsWith(` ${line}`)).length;
  const ask = async (socket: NetSocket, sequence: number) => {
    socket.write(`GET /info RTSP/1.0\r\nCSeq: ${sequence}\r\nUser-Agent: AirPlay/800.0\r\n\r\n`);
    return String((await once(socket, "data") as [Buffer])[0]);
  };
  const open = async () => { const socket = createConnection({ host: "127.0.0.1", port: ports[0]! }); await once(socket, "connect"); return socket; };
  const first = await open(), second = await open();
  assert.match(await ask(first, 1), /^RTSP\/1\.0 200/);
  await until(() => logged("airplay sender connected") === 1);
  // UxPlay holds one sender connection: the other is refused, and its open socket is no sender.
  assert.match(await ask(second, 1), /^RTSP\/1\.0 409/);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await player(), "idle");
  assert.deepEqual(host.state.liveSources ?? [], []);
  first.end();
  await until(() => logged("airplay sender disconnected") === 1);
  // Once the first has gone, the next connection to speak is UxPlay's sender in turn.
  assert.match(await ask(second, 2), /^RTSP\/1\.0 200/);
  await until(() => logged("airplay sender connected") === 2);
  second.end();
  await until(() => logged("airplay sender disconnected") === 2);
  assert.deepEqual(host.state.liveSources ?? [], []);
  assert.equal((await airplay()).status, "ready");
  // Off ends it promptly, through its own shutdown.
  const stopped = Date.now();
  await request("/api/settings/airplay", { body: { enabled: false } });
  await until(() => !alive(pid));
  assert.ok(Date.now() - stopped < 3_000, "UxPlay exits on SIGTERM without being killed");
});

// A sender that never learns the code, against the real UxPlay with Couch's arguments: the attack on
// UxPlay's own -pin mode, which sets up audio for a sender that skips pairing. Its first SETUP carries
// all-zero keys, which UxPlay's FairPlay can't decrypt and so leaves as a zero AES key (lib/raop_handlers.h),
// then an ALAC stream encrypted with it. A sender that knows the code answers UxPlay's Digest challenge
// the same way and plays, which shows the same path admits the sender that does; FairPlay, pairing and
// an Apple device's own behaviour are not exercised.
const setupKeys = Buffer.from("YnBsaXN0MDDXAQIDBAUGBwgJCgsMDQ5YZGV2aWNlSURTZWl2VGVrZXlVbW9kZWxUbmFtZVp0aW1pbmdQb3J0XnRpbWluZ1Byb3RvY29sXxARMDI6MDA6MDA6MDA6MDA6MDlPEBAAAAAAAAAAAAAAAAAAAAAATxBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVFRlc3RdTm8gUElOIHNlbmRlchGyblNOVFAIFyAkKS80P05idcDF09YAAAAAAAABAQAAAAAAAAAPAAAAAAAAAAAAAAAAAAAA2g==", "base64"); // deviceID, zero eiv/ekey, name "No PIN sender", NTP timing
const setupAudio = Buffer.from("YnBsaXN0MDDRAQJXc3RyZWFtc6ED1gQFBgcICQoLDA0OD1thdWRpb0Zvcm1hdFtjb250cm9sUG9ydFJjdFdpc01lZGlhU3NwZlR0eXBlEgAEAAAQABACCREBYBBgCAsTFSIuOj1FSU5TVVdYWwAAAAAAAAEBAAAAAAAAABAAAAAAAAAAAAAAAAAAAABd", "base64"); // one ALAC stream, type 96, ct 2, spf 352
const alacFrame = Buffer.from("IAAQAAACwAACDQoBYf6SAN//jAAkDwgBAAAAAAAAAA/4Baf+AWj/gFo+o+iBhAAAAAgccOgKMAAgpgAMAII4ygQtxYFmFqpK/D7PVMTpFotGcYZ5vWkKCdA7h0SVzrKqzMIZKmXn291aWSkZKTTVaGnHHXC6tzLXvXiAz9S0EtlE+U92lpK7wFSKIaSrJHMmIirhxopVdRl0jPTJV7+byer3eCtlRgpUCoQmdrAripmRhDPixuxkaDPj5Pc0WrsSsoU5x9DI0Gl1zc5qwpxTQU2po+kqms7RSKIDiVaRTQrvCGhk97bUhTR/wFf4", "base64"); // one 352-sample ALAC frame of a tone
test("the real UxPlay sets up sound only for a sender that answers with the code", { skip: !linux || !realUxPlay, timeout: 60_000 }, async t => {
  const { airplay, player, request, connect, hostToken } = await fixture(t, { uxplay: `#!/bin/sh\nexec ${realUxPlay} "$@"\n` });
  await request("/api/settings/airplay", { body: { enabled: true } });
  await until(async () => ["ready", "error"].includes((await airplay()).status), 20_000);
  assert.equal((await airplay()).status, "ready", (await airplay()).error ?? "");
  const host = await connect(Identity.generate().peerId, hostToken);
  const commands = await Promise.all((await readdir("/proc")).filter(entry => /^\d+$/.test(entry)).map(async entry => [Number(entry), await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => "")] as const));
  const pid = commands.find(([, command]) => command.startsWith(`${realUxPlay}\0`))?.[0] ?? 0;
  const [port] = await listening(pid);
  const { createConnection } = await import("node:net");
  const { createSocket } = await import("node:dgram");
  const { createCipheriv, createHash } = await import("node:crypto");
  const md5 = (text: string) => createHash("md5").update(text).digest("hex");
  const open = async () => {
    const socket = createConnection({ host: "127.0.0.1", port: port! });
    t.after(() => socket.destroy());
    await once(socket, "connect");
    let sequence = 0;
    const setup = (body: Buffer, authorization?: string) => new Promise<{ status: number; headers: string; body: Buffer }>((resolve, reject) => {
      let data = Buffer.alloc(0);
      const got = (chunk: Buffer) => {
        data = Buffer.concat([data, chunk]);
        const end = data.indexOf("\r\n\r\n");
        if (end < 0) return;
        const headers = data.subarray(0, end).toString(), length = Number(/Content-Length: (\d+)/i.exec(headers)?.[1] ?? 0);
        if (data.length < end + 4 + length) return;
        socket.off("data", got); socket.off("close", closed);
        resolve({ status: Number(headers.split(" ")[1]), headers, body: data.subarray(end + 4, end + 4 + length) });
      };
      const closed = () => reject(new Error("UxPlay closed the connection"));
      socket.on("data", got); socket.once("close", closed);
      socket.write(`SETUP rtsp://127.0.0.1/1 RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.length}\r\n${authorization ? `Authorization: ${authorization}\r\n` : ""}\r\n`);
      socket.write(body);
    });
    return { socket, setup };
  };
  const digest = (challenge: string, password: string) => {
    const nonce = /nonce="([^"]+)"/.exec(challenge)![1]!, uri = "rtsp://127.0.0.1/1";
    return `Digest username="AirPlay", realm="raop", nonce="${nonce}", uri="${uri}", response="${md5(`${md5(`AirPlay:raop:${password}`)}:${nonce}:${md5(`SETUP:${uri}`)}`)}"`;
  };
  // The data and control ports from UxPlay's binary plist answer to the audio SETUP.
  const ports = (plist: Buffer) => {
    const size = plist.at(-26)!, ref = plist.at(-25)!, table = Number(plist.readBigUInt64BE(plist.length - 8));
    const int = (at: number, bytes: number) => plist.readUIntBE(at, bytes);
    const object = (id: number): unknown => {
      let at = int(table + id * size, size);
      const marker = plist[at++]!, kind = marker >> 4;
      let count = marker & 15;
      if (count === 15 && kind !== 1) { const bytes = 1 << (plist[at++]! & 15); count = int(at, bytes); at += bytes; }
      if (kind === 1) return int(at, 1 << count);
      if (kind === 5) return plist.subarray(at, at + count).toString();
      if (kind === 10) return Array.from({ length: count }, (_, index) => object(int(at + index * ref, ref)));
      if (kind === 13) return Object.fromEntries(Array.from({ length: count }, (_, index) => [object(int(at + index * ref, ref)), object(int(at + (count + index) * ref, ref))]));
      throw new Error(`unexpected binary plist object ${kind}`);
    };
    return (object(Number(plist.readBigUInt64BE(plist.length - 16))) as { streams: { dataPort: number; controlPort: number }[] }).streams[0]!;
  };
  const sync = async (stream: { controlPort: number }) => {
    const udp = createSocket("udp4");
    await new Promise<void>(resolve => udp.bind(0, "127.0.0.1", resolve));
    t.after(() => udp.close());
    const packet = Buffer.alloc(20); packet[0] = 0x90; packet[1] = 0xd4; packet.writeUInt16BE(4, 2); packet.writeBigUInt64BE((BigInt(Math.floor(Date.now() / 1000)) + 2208988800n) << 32n, 8);
    udp.send(packet, stream.controlPort, "127.0.0.1");
    return udp;
  };
  const play = async (stream: { dataPort: number; controlPort: number }) => {
    const udp = await sync(stream);
    for (let index = 0; index < 240; index++) {
      const cipher = createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)); cipher.setAutoPadding(false);
      const whole = Math.floor(alacFrame.length / 16) * 16;
      const header = Buffer.alloc(12); header[0] = 0x80; header[1] = 0x60; header.writeUInt16BE(index, 2); header.writeUInt32BE(index * 352, 4); header.writeUInt32BE(0x1234, 8);
      udp.send(Buffer.concat([header, cipher.update(alacFrame.subarray(0, whole)), cipher.final(), alacFrame.subarray(whole)]), stream.dataPort, "127.0.0.1");
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  };

  // Without the code: UxPlay challenges the key SETUP and sets up no stream to play.
  const stranger = await open();
  const challenged = await stranger.setup(setupKeys);
  assert.equal(challenged.status, 401);
  assert.match(challenged.headers, /WWW-Authenticate: Digest realm="raop", nonce="/);
  // A wrong code is challenged again.
  assert.equal((await stranger.setup(setupKeys, digest(challenged.headers, "wrong-code-here"))).status, 401);
  // Skipping to the audio SETUP gets no stream: UxPlay drops the connection.
  const closed = once(stranger.socket, "close");
  void stranger.setup(setupAudio).catch(() => {});
  await closed;
  await new Promise(resolve => setTimeout(resolve, 1_000));
  assert.deepEqual(host.state.liveSources ?? [], []);
  assert.equal(await player(), "idle", "a sender without the code holds no update off");
  assert.equal((await airplay()).status, "ready");

  // With the code, the same requests set up a stream, and its sound becomes a source.
  const { code } = await airplay();
  const known = await open();
  const challenge = await known.setup(setupKeys);
  assert.equal(challenge.status, 401);
  assert.equal((await known.setup(setupKeys, digest(challenge.headers, code))).status, 200);
  const audio = await known.setup(setupAudio);
  assert.equal(audio.status, 200);
  // While it is connected, another address that knows neither the code nor the stream's key sends a
  // frame shorter than one AES block, which UxPlay never decrypts (lib/raop_buffer.c): one stereo sample,
  // in ALAC's uncompressed form. Couch's patch drops packets that aren't from the sender's address.
  const stream = ports(audio.body);
  await sync(stream);
  const elsewhere = Object.values(networkInterfaces()).flat().find(entry => entry?.family === "IPv4" && !entry.internal)?.address;
  assert.ok(elsewhere, "the container has an address besides loopback");
  const intruder = createSocket("udp4");
  await new Promise<void>(resolve => intruder.bind(0, elsewhere, resolve));
  t.after(() => intruder.close());
  for (let index = 0; index < 400; index++) {
    const header = Buffer.alloc(12); header[0] = 0x80; header[1] = 0x60; header.writeUInt16BE(index, 2); header.writeUInt32BE(index * 352, 4); header.writeUInt32BE(0x1234, 8);
    intruder.send(Buffer.concat([header, Buffer.from("200012000000025dc05dc1c0", "hex")]), stream.dataPort, elsewhere);
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  await new Promise(resolve => setTimeout(resolve, 1_000));
  assert.deepEqual(host.state.liveSources ?? [], [], "sound from another address never reaches the sender's stream");
  await play(stream);
  await until(() => host.state.liveSources?.[0]?.name === "AirPlay · No PIN sender", 5_000);
  assert.equal(await player(), "playing");
  known.socket.destroy();
  await until(() => !host.state.liveSources?.length, 10_000);
});
