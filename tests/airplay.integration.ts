import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Socket as NetSocket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { AudioCodec, Roles, SendspinClient, Identity } from "@sonn-audio/node-sendspin";
import { createAirPlay } from "../src/server/airplay";
import { helper, startHelpers } from "../src/server/helpers";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import type { AirPlayState } from "../src/shared/airplay";
import type { Action, PlaybackCommand, ServerMessage, SessionState } from "../src/shared/protocol";
import { withState } from "./whole-state.fixture";

// Real Core, HTTP, WebSockets, setpriv, stdbuf and FFmpeg. UxPlay is a script that speaks its
// interface: the log lines Couch reads and RFC 4571-framed L16 RTP on fd 3, which the test drives.
// No AirPlay sender or network discovery is involved; that needs real Apple hardware (docs/airplay.md).
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
const linux =
  process.platform === "linux" &&
  spawnSync("setpriv", ["--version"], { stdio: "ignore" }).status === 0;

// A stand-in Core for the test that kills one: it runs only the receiver, until killed.
if (process.env.COUCH_TEST_AIRPLAY_CORE) {
  const { executable, directory } = JSON.parse(process.env.COUCH_TEST_AIRPLAY_CORE) as {
    executable: string;
    directory: string;
  };
  createAirPlay({
    executable,
    directory,
    enabled: true,
    network: () => true,
    name: () => "Couch",
    identity: () => ({ code: "1234", deviceId: "02:00:00:00:00:01", askCode: true }),
    sessions: { started() {}, audio() {}, ended() {} },
    changed() {},
  });
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
// Audio-only AirPlay through Couch's UxPlay patch: payload type 97, each timestamp when the sender
// means that packet heard (start: the first one's, on the wall clock in 1/44100 s), ahead (ms, 1.75 s
// by default) after it sends it. Each 10 ms packet holds one level, a step above the last.
const steps = ({ start, ahead = 1750, first = 0 }) => {
  clearInterval(timer);
  const from = start / 44.1 - ahead;
  let sent = 0;
  timer = setInterval(() => {
    for (; sent < Math.floor((Date.now() - from) / 10); sent++) {
      const packet = Buffer.alloc(14 + 441 * 4);
      packet.writeUInt16BE(packet.length - 2, 0);
      packet[2] = 0x80; packet[3] = 97;
      packet.writeUInt16BE((first + sent) & 0xffff, 4);
      packet.writeUInt32BE((start + sent * 441) % 2 ** 32, 6);
      packet.writeUInt32BE(0x7e57, 10);
      for (let i = 0; i < 441; i++) {
        packet.writeInt16BE((sent % 300) * 100, 14 + i * 4); packet.writeInt16BE((sent % 300) * 100, 16 + i * 4);
      }
      fs.writeSync(3, packet);
    }
  }, 5);
};
const run = command => {
  if (command.log) console.log(command.log);
  if (command.stderr) console.error(command.stderr);
  if (command.tone) tone(command.tone);
  if (command.steps) steps(command.steps);
  // One write holding a sender-timed packet, then the first of a tone: the sound changes timing
  // within one read of the pipe.
  if (command.mixed) {
    const packet = (type, timestamp, ssrc) => {
      const bytes = Buffer.alloc(14 + 441 * 4);
      bytes.writeUInt16BE(bytes.length - 2, 0);
      bytes[2] = 0x80; bytes[3] = type;
      bytes.writeUInt32BE(timestamp % 2 ** 32, 6);
      bytes.writeUInt32BE(ssrc, 10);
      return bytes;
    };
    fs.writeSync(3, Buffer.concat([packet(97, command.mixed.start, 0x7e57), packet(96, 0, 0x5eed)]));
    tone({ frequency: 440 });
  }
  if (command.quiet) clearInterval(timer);
  if (command.exit !== undefined) process.exit(command.exit);
};
control.on('data', chunk => {
  pending += chunk;
  for (let index; (index = pending.indexOf('\\n')) >= 0; pending = pending.slice(index + 1)) run(JSON.parse(pending.slice(0, index)));
});
control.on('close', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
`;

type Fake = {
  argv: string[];
  home: string;
  cache: string;
  rc: string | null;
  pid: number;
  send: (command: object) => void;
  closed: Promise<unknown>;
};
// A process nobody has reaped yet (a container's init may not) has still ended.
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
};
async function until(check: () => boolean | Promise<boolean>, timeout = 8_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("AirPlay did not reach the expected state.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function fixture(t: TestContext, { uxplay: replacement }: { uxplay?: string } = {}) {
  // Core's provider checks stay offline.
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = ((input, init) =>
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input))
      ? fetchLocal(input, init)
      : Promise.resolve(new Response(""))) as typeof fetch;
  const directory = await mkdtemp(join(tmpdir(), "couch-airplay-")),
    databasePath = join(directory, "data", "couch.sqlite");
  const uxplay = join(directory, "uxplay"),
    control =
      process.platform === "win32"
        ? String.raw`\\.\pipe\couch-airplay-${crypto.randomUUID()}`
        : join(directory, "control.sock");
  await writeFile(uxplay, replacement ?? fakeUxPlay, { mode: 0o755 });
  await writeFile(join(directory, "package.json"), '{ "type": "commonjs" }'); // Wherever the checkout puts temporary files
  // Real FFmpeg, found through Couch's own helper lookup.
  const previousPath = process.env.PATH,
    previousControl = process.env.COUCH_TEST_UXPLAY_CONTROL;
  if (process.env.COUCH_TEST_FFMPEG)
    process.env.PATH = `${dirname(process.env.COUCH_TEST_FFMPEG)}${delimiter}${previousPath ?? ""}`;
  // Keep helper status and downloads in this run's directory, not the working directory.
  startHelpers(join(directory, "helpers"));
  await Promise.allSettled([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  process.env.COUCH_TEST_UXPLAY_CONTROL = control;
  const fakes: Fake[] = [];
  const server = createServer((socket: NetSocket) => {
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      pending += chunk;
      const index = pending.indexOf("\n");
      if (index < 0 || fakes.some((fake) => fake.send === send)) return;
      fakes.push({ ...JSON.parse(pending.slice(0, index)), send, closed: once(socket, "close") });
    });
    const send = (command: object) => socket.write(`${JSON.stringify(command)}\n`);
  });
  server.listen(control);
  await once(server, "listening");
  const store = openStore(databasePath, true);
  const receiverKey = Identity.generate(),
    receiverId = receiverKey.peerId,
    receiverToken = store.pair(receiverId, "Receiver");
  const controllerId = Identity.generate().peerId,
    controllerToken = store.pair(controllerId, "Controller");
  store.close();
  const hostToken = "h".repeat(64);
  const hub = await createHub({
    databasePath,
    hostToken,
    hostname: "127.0.0.1",
    port: Number(process.env.COUCH_TEST_AIRPLAY_PORT ?? 0),
    advertisedUrls: [],
    airplayExecutable: uxplay,
  });
  const sockets: WebSocket[] = [],
    speakers: SendspinClient[] = [];
  t.after(async () => {
    await Promise.all(speakers.map((speaker) => speaker.disconnect()));
    for (const socket of sockets) socket.terminate();
    await hub.close();
    for (const fake of fakes) if (alive(fake.pid)) process.kill(fake.pid, "SIGKILL");
    server.close();
    globalThis.fetch = fetchLocal;
    process.env.PATH = previousPath;
    if (previousControl === undefined) delete process.env.COUCH_TEST_UXPLAY_CONTROL;
    else process.env.COUCH_TEST_UXPLAY_CONTROL = previousControl;
    await rm(directory, { recursive: true, force: true });
  });
  const request = (
    path: string,
    { token = hostToken, body }: { token?: string; body?: object } = {},
  ) =>
    fetch(`${hub.origin}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: hub.origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const airplay = async () =>
    (await (await request("/api/settings/airplay")).json()) as AirPlayState;
  const player = async () =>
    (
      (await (
        await fetch(`${hub.origin}/api/connection`, { headers: { Origin: hub.origin } })
      ).json()) as { player: string }
    ).player;
  const connect = async (id: string, token: string) => {
    const socket = new WebSocket(
      `${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}&device=${id}`,
      { headers: { Origin: hub.origin } },
    );
    sockets.push(socket);
    const messages: ServerMessage[] = [],
      pending = new Map<string, (message: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState | undefined,
      sequence = 0;
    socket.on("message", (data) => {
      const message = withState(socket, JSON.parse(String(data)) as ServerMessage);
      messages.push(message);
      if (message.type === "state") state = message.state;
      if (message.type === "result") {
        pending.get(message.requestId)?.(message);
        pending.delete(message.requestId);
      }
    });
    await until(() => !!state);
    return {
      messages,
      get state() {
        return state!;
      },
      command: (action: Action) =>
        new Promise<Extract<ServerMessage, { type: "result" }>>((resolve) => {
          const requestId = String(++sequence);
          pending.set(requestId, resolve);
          socket.send(JSON.stringify({ type: "command", requestId, action }));
        }),
      load: () => {
        const message = messages.findLast(
          (message) => message.type === "player" && message.command.type === "load",
        );
        return message?.type === "player"
          ? (message.command as Extract<PlaybackCommand, { type: "load" }>)
          : undefined;
      },
    };
  };
  const next = async (count: number) => {
    await until(() => fakes.length >= count);
    return fakes[count - 1]!;
  };
  return {
    hub,
    directory,
    databasePath,
    uxplay,
    fakes,
    next,
    request,
    airplay,
    player,
    connect,
    // listen: each chunk with its play time, on Core's clock (this process's performance.now()).
    hear: async (listen?: (timestampUs: number, bytes: Buffer) => void) => {
      const chunks: Buffer[] = [];
      const speaker = new SendspinClient(receiverId, "AirPlay receiver", [Roles.PLAYER], {
        playerSupport: {
          supported_formats: [
            { codec: AudioCodec.PCM, sample_rate: 48000, channels: 2, bit_depth: 16 },
          ],
          buffer_capacity: 512 * 1024,
          supported_commands: [],
        },
      });
      speakers.push(speaker);
      speaker.addAudioChunkListener((time, bytes) => {
        chunks.push(Buffer.from(bytes));
        listen?.(time, Buffer.from(bytes));
      });
      await speaker.connect(
        `${hub.origin.replace("http:", "ws:")}/api/audio/${receiverToken}/sendspin`,
        { timeoutMs: 3000 },
      );
      return chunks;
    },
    receiver: { id: receiverId, token: receiverToken },
    controller: { id: controllerId, token: controllerToken },
    hostToken,
  };
}

const scheduled = (client: { state: SessionState }) =>
  client.state.playbacks?.find(
    (playback) => playback.liveSourceId && playback.delivery === "scheduled",
  );
const ready = async (fake: Fake, airplay: () => Promise<AirPlayState>) => {
  fake.send({ log: "Initialized server socket(s)" });
  await until(async () => (await airplay()).status === "ready");
};
// What UxPlay 1.74 logs with -d 1 (lib/httpd.c, lib/raop.c, lib/raop_handlers.h): any TCP connection,
// then the one it takes as its RTSP sender, which it refuses to a second while one is open, that sender
// setting up audio once admitted, and each connection's removal.
const accepted = (fake: Fake, socket: number) =>
  fake.send({ log: `Accepted IPv4 client on socket ${socket}, port 7000` });
const sender = (fake: Fake, socket: number, name?: string, admitted = true) => {
  accepted(fake, socket);
  fake.send({ log: `New connection 0x${socket} identified as Connection type RAOP` });
  if (name)
    fake.send({
      log: `connection request from ${name} (iPhone15,3) with deviceID = 11:22:33:44:55:${socket}`,
    });
  // An admitted sender passes UxPlay's password check, then sets up its audio stream.
  if (admitted) {
    fake.send({ log: "Client authentication success" });
    fake.send({ log: "RAOP initialized success" });
  }
};
const closed = (fake: Fake, socket: number, type = "RAOP") => {
  fake.send({ log: `removing connection type ${type} socket ${socket} conn 0x${socket}` });
  fake.send({ log: `Connection closed on socket ${socket}` });
};

test("Ask for a code is saved apart from the identity an older build writes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "couch-airplay-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "couch.sqlite");
  let store = openStore(path);
  const identity = store.airplayIdentity();
  assert.equal(identity.askCode, true);
  store.saveAirPlayAskCode(false);
  store.close();

  // The previous preview writes the identity row as it always has.
  const previous = new DatabaseSync(path);
  previous
    .prepare("INSERT OR IGNORE INTO installation_airplay VALUES (1, 0, ?, ?)")
    .run("unused-code", "unused-device");
  previous.exec("UPDATE installation_airplay SET enabled = 1 WHERE id = 1");
  previous.close();

  store = openStore(path);
  assert.equal(store.airplayEnabled(), true);
  assert.deepEqual(store.airplayIdentity(), { ...identity, askCode: false });
  store.close();
});

test(
  "public AirPlay discovery exposes capability while settings stay admin-only across role changes",
  { skip: !linux },
  async (t) => {
    const {
      hub,
      hostToken,
      request,
      airplay,
      receiver: admin,
      controller,
      fakes,
    } = await fixture(t);
    const discovery = async (token?: string) => {
      const response = token
        ? await request("/api/connection", { token })
        : await fetch(`${hub.origin}/api/connection`, { headers: { Origin: hub.origin } });
      assert.equal(response.status, 200);
      const details = (await response.json()) as Record<string, unknown>;
      assert.equal(details.airplay, "available");
      for (const field of ["enabled", "status", "code", "sender", "error"])
        assert.equal(field in details, false);
      return details;
    };
    const original = await discovery();
    for (const token of [hostToken, admin.token, controller.token, "unpaired"])
      assert.deepEqual(await discovery(token), original);
    const initial = await airplay();
    assert.equal(JSON.stringify(original).includes(initial.code), false);
    assert.equal((await request("/api/settings/airplay", { token: admin.token })).status, 200);
    const refused = async (token: string, status: number) => {
      for (const [path, body] of [
        ["/api/settings/airplay", undefined],
        ["/api/settings/airplay", { enabled: true }],
        ["/api/settings/airplay/code", {}],
      ] as const)
        assert.equal((await request(path, { token, body })).status, status);
    };
    await refused("unpaired", 401);
    await refused(controller.token, 403);
    assert.equal(
      (await request(`/api/devices/${admin.id}/role`, { body: { role: "controller" } })).status,
      200,
    );
    await refused(admin.token, 403);
    assert.deepEqual(await discovery(admin.token), original);
    assert.equal((await airplay()).code, initial.code, "refused code renewals don't change it");
    assert.equal(fakes.length, 0, "refused enable requests never start a receiver");
    assert.equal(
      (await request(`/api/devices/${admin.id}/role`, { body: { role: "administrator" } })).status,
      200,
    );
    assert.equal((await request("/api/settings/airplay", { token: admin.token })).status, 200);
  },
);

test(
  "AirPlay rechecks the administrator after restarting the receiver",
  { skip: !linux },
  async (t) => {
    const { request, airplay, next, receiver: admin } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    process.kill(fake.pid, "SIGSTOP");
    const changing = request("/api/settings/airplay/ask-code", {
      token: admin.token,
      body: { enabled: false },
    });
    try {
      await until(async () => !(await airplay()).askCode);
      const demoted = await request(`/api/devices/${admin.id}/role`, {
        body: { role: "controller" },
      });
      assert.equal(demoted.status, 200);
    } finally {
      process.kill(fake.pid, "SIGCONT");
    }
    const response = await changing;
    assert.equal(response.status, 403);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
  },
);

test(
  "AirPlay stays off until an admin turns it on, and runs UxPlay only in Couch's own data",
  { skip: !linux },
  async (t) => {
    const { request, airplay, fakes, next, directory, controller } = await fixture(t);
    const initial = await airplay();
    assert.equal(initial.status, "off");
    assert.match(
      initial.code,
      /^[a-hj-km-np-z2-9]{4}(?:-[a-hj-km-np-z2-9]{4}){2}$/,
      "a password that can't be guessed by trying",
    );
    assert.equal((await request("/api/settings/airplay", { token: controller.token })).status, 403);
    assert.equal(
      (await request("/api/settings/airplay", { token: controller.token, body: { enabled: true } }))
        .status,
      403,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(fakes.length, 0, "nothing listens for AirPlay while it is off");

    assert.equal((await request("/api/settings/airplay", { body: { enabled: true } })).status, 200);
    const fake = await next(1);
    const own = join(directory, "data", "airplay");
    const option = (name: string) => fake.argv[fake.argv.indexOf(name) + 1];
    assert.equal(
      option("-artp"),
      "! rtpstreampay ! fdsink fd=3 sync=false",
      "decoded sound goes only to Core's private pipe",
    );
    assert.ok(fake.argv.includes("-async"), "audio-only AirPlay keeps the sender's timing");
    assert.equal(option("-vsync"), "no", "mirroring's sound, whose picture is discarded, doesn't");
    // The code is UxPlay's password, which it requires before it sets up any sound. It is in a file
    // only Couch can read, not on a command line everyone on the computer can see.
    assert.ok(
      !fake.argv.includes("-pin") && !fake.argv.includes("-reg"),
      "-pin pairing doesn't stop a sender that skips it",
    );
    assert.ok(!fake.argv.includes(initial.code));
    assert.equal(option("-rc"), join(own, "uxplayrc"));
    assert.equal(await readFile(join(own, "uxplayrc"), "utf8"), `pw ${initial.code}\n`);
    assert.equal((await stat(join(own, "uxplayrc"))).mode & 0o777, 0o600);
    assert.ok(!fake.argv.includes("-nohold"), "one sender at a time: a new one can't take over");
    assert.deepEqual(
      [fake.home, fake.cache, fake.rc],
      [own, join(own, "cache"), null],
      "no ~/.uxplayrc or registration outside Couch's data applies",
    );
    assert.equal((await airplay()).status, "starting");
    await ready(fake, airplay);
    const identity = option("-m");

    // Off stops the receiver; on again keeps the same identity and code.
    assert.equal(
      (await request("/api/settings/airplay", { body: { enabled: false } })).status,
      200,
    );
    await fake.closed;
    await until(() => !alive(fake.pid));
    assert.equal((await airplay()).status, "off");
    await request("/api/settings/airplay", { body: { enabled: true } });
    const again = await next(2);
    assert.equal(again.argv[again.argv.indexOf("-m") + 1], identity);
    assert.equal(await readFile(join(own, "uxplayrc"), "utf8"), `pw ${initial.code}\n`);

    // UxPlay listens on every interface: it runs only while the Couch is shared on the network.
    await ready(again, airplay);
    assert.equal(
      (await request("/api/settings/sharing", { body: { enabled: false } })).status,
      200,
    );
    await until(() => !alive(again.pid));
    assert.equal((await airplay()).status, "waiting");
    await request("/api/settings/sharing", { body: { enabled: true } });
    await next(3);
  },
);

test(
  "a connection is not admission: only a sender's decoded sound publishes and starts playback",
  { skip: !linux },
  async (t) => {
    const { hub, airplay, player, next, request, connect, hostToken, receiver } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken);

    // Connecting, naming itself, even being asked for the code: none of it is a session.
    sender(fake, 31, "Mallory", false);
    fake.send({ log: '*** CLIENT MUST NOW ENTER PIN = "1234" AS AIRPLAY PASSWORD' });
    // Sound while it is connected isn't its: it never set up audio.
    fake.send({ tone: { frequency: 440 } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    fake.send({ quiet: true });
    assert.equal((await airplay()).status, "ready");
    assert.equal(await player(), "idle", "an unadmitted connection never holds off updates");
    assert.deepEqual(host.state.liveSources ?? [], []);
    assert.deepEqual(host.state.playbacks ?? [], []);
    // Sound flushed after every connection closed is not a sender either.
    closed(fake, 31);
    fake.send({ tone: { frequency: 440 } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(host.state.liveSources ?? [], []);
    fake.send({ quiet: true });

    sender(fake, 32, "Kitchen\u0007 iPhone");
    fake.send({ tone: { frequency: 440 } });
    await until(() => !!host.state.liveSources?.length);
    const [source] = host.state.liveSources!;
    assert.deepEqual(
      { ...source, id: undefined },
      {
        id: undefined,
        deviceId: "airplay",
        name: "AirPlay from Kitchen iPhone",
        kind: "airplay",
        audio: true,
        video: false,
        audioDelivery: "pcm",
      },
    );
    assert.equal((await airplay()).status, "receiving");
    assert.equal((await airplay()).sender, "Kitchen iPhone");
    const publicDetails = (await (await fetch(`${hub.origin}/api/connection`)).json()) as Record<
      string,
      unknown
    >;
    assert.equal(publicDetails.airplay, "available", "receiving doesn't change public capability");
    for (const field of ["enabled", "status", "code", "sender", "error"])
      assert.equal(field in publicDetails, false);
    assert.equal(JSON.stringify(publicDetails).includes("Kitchen iPhone"), false);
    assert.equal(JSON.stringify(publicDetails).includes((await airplay()).code), false);
    assert.ok(
      ["loading", "playing"].includes(await player()),
      "an admitted sender holds off unattended updates",
    );
    assert.equal(host.state.playbacks?.length, 1, "the sender starts one playback on the host");

    // Another sender trying meanwhile changes nothing; UxPlay refuses it (no -nohold).
    accepted(fake, 40);
    fake.send({ log: "*** WARNING: rejecting new connection request from 192.168.1.9" });
    closed(fake, 40, "Unknown");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal((await airplay()).sender, "Kitchen iPhone");
    assert.equal(host.state.liveSources?.length, 1);

    // No device can end Core's source or send it media; the host included.
    const other = await connect(receiver.id, receiver.token);
    assert.equal((await other.command({ type: "endLive", sourceId: source!.id })).ok, false);
    for (const token of [receiver.token, hostToken])
      assert.equal(
        (
          await fetch(
            `${hub.origin}/api/live/upload?${new URLSearchParams({ sourceId: source!.id, key: "1".repeat(64), token })}`,
            { headers: { Origin: hub.origin } },
          )
        ).status,
        403,
      );
    assert.equal(host.state.liveSources?.length, 1);
  },
);

test(
  "incoming AirPlay automatically delivers the sender's sound through scheduled PCM without HLS, and the sender leaving ends it everywhere",
  { skip: !linux || !hasFfmpeg, timeout: 60_000 },
  async (t) => {
    const { airplay, player, next, request, connect, hostToken, receiver, hear } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken),
      device = await connect(receiver.id, receiver.token);
    sender(fake, 32, "Kitchen iPhone");
    fake.send({ tone: { frequency: 440 } });
    await until(() => !!device.state.liveSources?.length);
    const source = device.state.liveSources![0]!;
    await until(() => scheduled(host)?.status === "playing", 5_000);
    assert.equal(
      (await device.command({ type: "playLive", sourceId: source.id, deviceId: receiver.id })).ok,
      true,
    );
    const chunks = await hear();
    await until(() => scheduled(device)?.status === "playing");
    assert.equal(source.audioDelivery, "pcm");
    assert.equal(device.load()?.hls, undefined, "audio-only AirPlay never loads an HLS receiver");
    await until(() => Buffer.concat(chunks).length >= 48000 * 4 * 2);
    const decoded = Buffer.concat(chunks).subarray(-48000 * 4);
    const samples = Array.from({ length: decoded.length / 4 }, (_, index) =>
      decoded.readInt16LE(index * 4),
    );
    const crossings = samples
      .slice(1)
      .filter((value, index) => value >= 0 !== samples[index]! >= 0).length;
    const frequency = crossings / 2 / (samples.length / 48000);
    assert.ok(Math.abs(frequency - 440) < 15, `scheduled sender tone (${frequency.toFixed(1)} Hz)`);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(rms > 3000, `at the sender's level (${rms.toFixed(0)})`);
    // Where it plays shows what it plays, not the browser fallback's relayed route.
    assert.notEqual(
      device.state.outputs?.find((output) => output.deviceId === receiver.id)?.state,
      "relayed",
    );

    // The sender stops AirPlay: its connections close. The source, its playback and busy-ness end.
    fake.send({ quiet: true });
    closed(fake, 32);
    await until(() => !device.state.liveSources?.length);
    await until(() =>
      device.messages.some((message) => message.type === "sendspin" && !message.listen),
    );
    await until(async () => (await player()) === "idle");
    assert.equal((await airplay()).sender, null);
    // A fresh UxPlay serves the next sender, so nothing the last one left behind reaches it.
    await ready(await next(2), airplay);
  },
);

test(
  "audio-only AirPlay plays when the sender means it heard, also on a speaker that joins later",
  { skip: !linux || !hasFfmpeg, timeout: 60_000 },
  async (t) => {
    const { airplay, next, request, connect, hostToken, receiver, hear } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken),
      device = await connect(receiver.id, receiver.token);
    sender(fake, 32, "Mac");
    const start = Math.round((Date.now() + 1750) * 44.1);
    fake.send({ steps: { start } });
    await until(() => !!device.state.liveSources?.length);
    await until(() => scheduled(host)?.status === "playing", 5_000);
    // The receiver joins a second into the sound.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(
      (
        await device.command({
          type: "playLive",
          sourceId: device.state.liveSources![0]!.id,
          deviceId: receiver.id,
        })
      ).ok,
      true,
    );
    // Each step's first sample, at the time the speaker is told to play it, against the time the
    // sender gave it (both in ms on Core's clock).
    const offsetMs = Date.now() - performance.now();
    const errors: number[] = [];
    await hear((timestampUs, bytes) => {
      const levels = Array.from({ length: bytes.length / 4 }, (_, index) =>
        Math.round(bytes.readInt16LE(index * 4) / 100),
      );
      // A step holds 10 ms (480 samples): 2 ms either side of it keeps out the resampler's ringing.
      for (let index = 96; index + 96 < levels.length; index++) {
        const step = levels[index]!;
        if (step !== levels[index - 1]! + 1 || levels[index - 96] !== step - 1) continue;
        if (levels[index + 96] !== step) continue;
        const heard = timestampUs / 1000 + (index * 1000) / 48_000;
        // The packet with that level nearest the time heard.
        const near = Math.round(((heard + offsetMs) * 44.1 - start) / 441);
        const packet = near + ((((step - near) % 300) + 450) % 300) - 150;
        errors.push(heard - ((start + packet * 441) / 44.1 - offsetMs));
      }
    });
    await until(() => errors.length >= 200, 15_000);
    const worst = Math.max(...errors.map(Math.abs));
    assert.ok(worst < 3, `played within 3 ms of the sender's time (worst ${worst.toFixed(2)} ms)`);
  },
);

test(
  "a sender clock that steps back half a second plays on without a gap, at its new time",
  { skip: !linux || !hasFfmpeg, timeout: 60_000 },
  async (t) => {
    const { airplay, next, request, connect, hostToken, receiver, hear } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken),
      device = await connect(receiver.id, receiver.token);
    sender(fake, 32, "Mac");
    fake.send({ steps: { start: Math.round((Date.now() + 1750) * 44.1) } });
    await until(() => !!device.state.liveSources?.length);
    await until(() => scheduled(host)?.status === "playing", 5_000);
    assert.equal(
      (
        await device.command({
          type: "playLive",
          sourceId: device.state.liveSources![0]!.id,
          deviceId: receiver.id,
        })
      ).ok,
      true,
    );
    const offsetMs = Date.now() - performance.now();
    const errors: number[] = [],
      chunks: { at: number; end: number }[] = [];
    let start: number | undefined;
    await hear((timestampUs, bytes) => {
      chunks.push({ at: timestampUs, end: timestampUs + (bytes.length / 4 / 48_000) * 1e6 });
      if (start === undefined) return;
      const levels = Array.from({ length: bytes.length / 4 }, (_, index) =>
        Math.round(bytes.readInt16LE(index * 4) / 100),
      );
      for (let index = 96; index + 96 < levels.length; index++) {
        const step = levels[index]!;
        if (step !== levels[index - 1]! + 1 || levels[index - 96] !== step - 1) continue;
        if (levels[index + 96] !== step) continue;
        const heard = timestampUs / 1000 + (index * 1000) / 48_000;
        // Only the new time's sound: after the half second that overlaps what already went out.
        if ((heard + offsetMs) * 44.1 < start + 22_050 + 441) continue;
        const near = Math.round(((heard + offsetMs) * 44.1 - start) / 441);
        const packet = near + ((((step - near) % 300) + 450) % 300) - 150;
        errors.push(heard - ((start + packet * 441) / 44.1 - offsetMs));
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // The sender's clock steps back: its next packet, in sequence, is meant heard half a second
    // before the one it follows.
    start = Math.round((Date.now() + 1250) * 44.1);
    fake.send({ steps: { start, ahead: 1250, first: 10_000 } });
    await until(() => errors.length >= 100, 15_000);
    const worst = Math.max(...errors.map(Math.abs));
    assert.ok(
      worst < 3,
      `played within 3 ms of the sender's new time (worst ${worst.toFixed(2)} ms)`,
    );
    // Each chunk the speaker is sent starts where the one before ends.
    const gaps = chunks.slice(1).map((chunk, index) => Math.abs(chunk.at - chunks[index]!.end));
    assert.ok(Math.max(...gaps) < 1_000, `no gap (largest ${Math.max(...gaps)} µs)`);
    assert.equal(host.state.liveSources?.length, 1);
    assert.equal(host.state.liveSources![0]!.senderTimed, true);
    assert.equal(scheduled(host)?.status, "playing");
  },
);

test(
  "AirPlay sound whose sender time Couch can't use plays by its arrival",
  { skip: !linux || !hasFfmpeg, timeout: 30_000 },
  async (t) => {
    const { airplay, next, request, connect, hostToken } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken);
    sender(fake, 32, "Mac");
    // A sender that never answers UxPlay's clock requests: its sound is due as it arrives.
    fake.send({ steps: { start: Math.round(Date.now() * 44.1), ahead: 0 } });
    await until(() => scheduled(host)?.status === "playing", 5_000);
    assert.equal(host.state.liveSources?.length, 1);
    assert.equal(host.state.liveSources![0]!.senderTimed, undefined);
  },
);

test(
  "a read of AirPlay sound that changes timing partway is two sources, split where it changes",
  { skip: !linux || !hasFfmpeg, timeout: 30_000 },
  async (t) => {
    const { airplay, next, request, connect, hostToken } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken);
    sender(fake, 32, "Mac");
    fake.send({ mixed: { start: Math.round((Date.now() + 1750) * 44.1) } });
    // The tone, timed by its arrival, is the source that plays.
    await until(
      () =>
        host.state.liveSources?.length === 1 &&
        !host.state.liveSources[0]!.senderTimed &&
        scheduled(host)?.status === "playing",
      5_000,
    );
  },
);

test(
  "incoming AirPlay takes only the host output, regardless of its selected device, and respects Stop",
  { skip: !linux || !hasFfmpeg, timeout: 30_000 },
  async (t) => {
    const { hub, airplay, next, request, connect, hostToken, receiver, databasePath } =
      await fixture(t);
    const host = await connect(Identity.generate().peerId, hostToken),
      device = await connect(receiver.id, receiver.token);
    assert.equal(
      (
        await host.command({
          type: "enqueue",
          entry: { id: "host-item", title: "Host queue", source: `${hub.origin}/api/health` },
          playNow: true,
        })
      ).ok,
      true,
    );
    await until(() => !!host.load());
    const previousPlayback = host.state.playbacks![0]!.id;
    assert.equal(
      (await device.command({ type: "sharing", sharing: { audio: true, video: false } })).ok,
      true,
    );
    assert.equal(
      (
        await host.command({
          type: "enqueue",
          entry: { id: "remote-item", title: "Remote queue", source: `${hub.origin}/api/health` },
          playNow: true,
          deviceId: receiver.id,
        })
      ).ok,
      true,
    );
    await until(() => !!device.load());
    const remoteLoad = device.load()!,
      remoteMessages = device.messages.length;

    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    sender(fake, 31, "Alice");
    fake.send({ tone: { frequency: 440 } });
    await until(() => scheduled(host)?.status === "playing", 5_000);
    assert.equal(host.state.playbacks?.filter((playback) => playback.liveSourceId).length, 1);
    const saved = openStore(databasePath, true);
    try {
      assert.ok(
        saved.playback(previousPlayback).queue.some((entry) => entry.id === "host-item"),
        "the previous host queue stays",
      );
    } finally {
      saved.close();
    }
    assert.equal(device.load()!.playbackId, remoteLoad.playbackId);
    assert.equal(
      device.messages
        .slice(remoteMessages)
        .filter(
          (message) =>
            message.type === "player" && ["load", "stop", "pause"].includes(message.command.type),
        ).length,
      0,
      "the selected remote keeps playing",
    );

    assert.equal(
      (await host.command({ type: "stop", playbackId: host.state.player.playbackId! })).ok,
      true,
    );
    const loads = host.messages.filter(
      (message) => message.type === "player" && message.command.type === "load",
    ).length;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(
      host.messages.filter(
        (message) => message.type === "player" && message.command.type === "load",
      ).length,
      loads,
      "ongoing packets do not restart a stopped playback",
    );
    assert.equal((await airplay()).status, "receiving");
  },
);

test(
  "a device that stops sharing its speakers leaves AirPlay waiting, and AirPlay stays published",
  { skip: !linux || !hasFfmpeg, timeout: 60_000 },
  async (t) => {
    const { airplay, next, request, connect, receiver, controller } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    const fake = await next(1);
    await ready(fake, airplay);
    const device = await connect(receiver.id, receiver.token),
      other = await connect(controller.id, controller.token);
    sender(fake, 32, "Kitchen iPhone");
    fake.send({ tone: { frequency: 440 } });
    await until(() => !!device.state.liveSources?.length);
    const sourceId = device.state.liveSources![0]!.id;
    assert.equal(
      (await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok,
      false,
      "only with the receiver's consent",
    );
    assert.equal(
      (await device.command({ type: "sharing", sharing: { audio: true, video: false } })).ok,
      true,
    );
    assert.equal(
      (await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok,
      true,
    );
    await until(() => scheduled(device)?.status === "playing", 30_000);
    const revoked = await device.command({
      type: "sharing",
      sharing: { audio: false, video: false },
    });
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
    await until(() =>
      device.messages.some((message) => message.type === "sendspin" && !message.listen),
    );
    assert.equal(
      (await other.command({ type: "playLive", sourceId, deviceId: receiver.id })).ok,
      false,
    );
    assert.equal(device.state.liveSources?.length, 1);
    assert.equal((await airplay()).status, "receiving");
  },
);

test(
  "turning AirPlay off ends the receiver and its source; a crashing receiver restarts a bounded number of times",
  { skip: !linux },
  async (t) => {
    const { airplay, player, next, request, connect, hostToken, fakes } = await fixture(t);
    await request("/api/settings/airplay", { body: { enabled: true } });
    let fake = await next(1);
    await ready(fake, airplay);
    const host = await connect(Identity.generate().peerId, hostToken);
    sender(fake, 32);
    fake.send({ tone: { frequency: 440 } });
    await until(() => !!host.state.liveSources?.length);
    assert.equal(host.state.liveSources![0]!.name, "AirPlay from AirPlay device");
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
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(fakes.length, 5, "restarts are bounded");
    // Off and on retries.
    await request("/api/settings/airplay", { body: { enabled: false } });
    await request("/api/settings/airplay", { body: { enabled: true } });
    await next(6);
  },
);

test("a new code restarts AirPlay with it", { skip: !linux }, async (t) => {
  const { airplay, next, request, directory } = await fixture(t);
  await request("/api/settings/airplay", { body: { enabled: true } });
  let fake = await next(1);
  await ready(fake, airplay);
  const before = (await airplay()).code;
  const response = await request("/api/settings/airplay/code", { body: {} });
  assert.equal(response.status, 200);
  const after = ((await response.json()) as AirPlayState).code;
  assert.notEqual(after, before);
  await until(() => !alive(fake.pid));
  fake = await next(2);
  // Devices that stored the old password fail UxPlay's check and ask for the new one.
  assert.equal(
    await readFile(join(directory, "data", "airplay", "uxplayrc"), "utf8"),
    `pw ${after}\n`,
  );
});

test(
  "with Ask for a code off, UxPlay has no password and any sender plays",
  { skip: !linux },
  async (t) => {
    const { airplay, next, request, directory, connect, hostToken, controller } = await fixture(t);
    const startup = join(directory, "data", "airplay", "uxplayrc");
    assert.equal((await airplay()).askCode, true, "on unless an admin turns it off");
    assert.equal(
      (
        await request("/api/settings/airplay/ask-code", {
          token: controller.token,
          body: { enabled: false },
        })
      ).status,
      403,
    );
    await request("/api/settings/airplay", { body: { enabled: true } });
    let fake = await next(1);
    await ready(fake, airplay);
    assert.equal(await readFile(startup, "utf8"), `pw ${(await airplay()).code}\n`);

    const response = await request("/api/settings/airplay/ask-code", { body: { enabled: false } });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as AirPlayState).askCode, false);
    await until(() => !alive(fake.pid));
    fake = await next(2);
    assert.equal(await readFile(startup, "utf8"), "");
    await ready(fake, airplay);

    // UxPlay logs no authentication without a password; the sender's sound still publishes it.
    const host = await connect(Identity.generate().peerId, hostToken);
    sender(fake, 31, "First guest", false);
    fake.send({ log: "RAOP initialized success" });
    closed(fake, 31);
    // Stream setup commits this process to its sender before any sound arrives on fd 3.
    fake = await next(3);
    await ready(fake, airplay);
    assert.deepEqual(host.state.liveSources ?? [], []);
    // Browsing alone leaves the same receiver ready for a sender.
    sender(fake, 30, undefined, false);
    closed(fake, 30);
    sender(fake, 32, "Guest", false);
    fake.send({ log: "RAOP initialized success" });
    fake.send({ tone: { frequency: 440 } });
    await until(() => !!host.state.liveSources?.length);
    assert.equal(host.state.liveSources![0]!.name, "AirPlay from Guest");

    await request("/api/settings/airplay/ask-code", { body: { enabled: true } });
    await until(() => !alive(fake.pid));
    await next(4);
    assert.equal(await readFile(startup, "utf8"), `pw ${(await airplay()).code}\n`);
  },
);

test("UxPlay ends with Core however Core ends", { skip: !linux }, async (t) => {
  const { directory, uxplay, fakes, next } = await fixture(t);
  const core = spawn(process.execPath, [process.argv[1]!], {
    env: {
      ...process.env,
      COUCH_TEST_AIRPLAY_CORE: JSON.stringify({
        executable: uxplay,
        directory: join(directory, "core"),
      }),
    },
    stdio: "ignore",
  });
  t.after(() => {
    core.kill("SIGKILL");
  });
  const fake = await next(1);
  assert.ok(alive(fake.pid));
  core.kill("SIGKILL");
  await until(() => !alive(fake.pid));
  assert.equal(fakes.length, 1);
});

// GStreamer's own payloader and framing, exactly as Couch asks UxPlay to configure them.
const gstLaunch = process.env.COUCH_TEST_GST_LAUNCH;
test(
  "sound framed by GStreamer's rtpL16pay and rtpstreampay plays as sent",
  { skip: !linux || !hasFfmpeg || !gstLaunch, timeout: 60_000 },
  async (t) => {
    const pipeline =
      "audiotestsrc is-live=true freq=440 volume=0.3 ! audioconvert ! audio/x-raw,format=S16BE,rate=44100,channels=2 ! rtpL16pay pt=96 ! rtpstreampay ! fdsink fd=3 sync=false";
    const script = `#!/bin/sh
echo 'Initialized server socket(s)'
echo 'Accepted IPv4 client on socket 30, port 7000'
echo 'New connection 0x30 identified as Connection type RAOP'
echo 'Client authentication success'
echo 'RAOP initialized success'
echo 'connection request from GStreamer (gst-launch) with deviceID = 02:00:00:00:00:02'
exec ${gstLaunch} -q ${pipeline}
`;
    const { airplay, next, request, connect, receiver, hear } = await fixture(t, {
      uxplay: script,
    });
    void next;
    await request("/api/settings/airplay", { body: { enabled: true } });
    const device = await connect(receiver.id, receiver.token);
    await until(() => !!device.state.liveSources?.length, 15_000);
    assert.equal((await airplay()).sender, "GStreamer");
    assert.equal(
      (
        await device.command({
          type: "playLive",
          sourceId: device.state.liveSources![0]!.id,
          deviceId: receiver.id,
        })
      ).ok,
      true,
    );
    await until(() => scheduled(device)?.status === "playing", 30_000);
    const chunks = await hear();
    await until(() => Buffer.concat(chunks).length >= 48000 * 4 * 2);
    const decoded = Buffer.concat(chunks).subarray(-48000 * 4);
    const samples = Array.from({ length: decoded.length / 4 }, (_, index) =>
      decoded.readInt16LE(index * 4),
    );
    const crossings = samples
      .slice(1)
      .filter((value, index) => value >= 0 !== samples[index]! >= 0).length;
    const frequency = crossings / 2 / (samples.length / 48000);
    assert.ok(
      Math.abs(frequency - 440) < 15,
      `GStreamer's 440 Hz tone (${frequency.toFixed(1)} Hz)`,
    );
    // A continuous tone: no gaps from framing, timestamps or pacing.
    const quiet = samples.findIndex(
      (_, index) =>
        index + 480 <= samples.length &&
        samples.slice(index, index + 480).every((value) => Math.abs(value) < 500),
    );
    assert.equal(quiet, -1, "no 10 ms of silence inside a segment of a continuous tone");
  },
);

// The UxPlay build Couch ships, with the arguments Couch gives it. No sender is involved.
const realUxPlay = process.env.COUCH_TEST_UXPLAY;
const listening = async (pid: number) => {
  const sockets = new Set(
    (
      await Promise.all(
        (await readdir(`/proc/${pid}/fd`)).map((fd) =>
          readlink(`/proc/${pid}/fd/${fd}`).catch(() => ""),
        ),
      )
    ).flatMap((link) => /^socket:\[(\d+)\]$/.exec(link)?.[1] ?? []),
  );
  const table = (await readFile(`/proc/${pid}/net/tcp`, "utf8"))
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/));
  return table
    .filter((fields) => fields[3] === "0A" && sockets.has(fields[9]!))
    .map((fields) => parseInt(fields[1]!.split(":")[1]!, 16));
};
test(
  "the real UxPlay starts with Couch's arguments, and a connection that never pairs publishes nothing",
  { skip: !linux || !realUxPlay, timeout: 60_000 },
  async (t) => {
    const { airplay, player, request, connect, hostToken, directory } = await fixture(t, {
      uxplay: `#!/bin/sh\nexec ${realUxPlay} "$@"\n`,
    });
    const log = t.mock.method(console, "log");
    await request("/api/settings/airplay", { body: { enabled: true } });
    await until(async () => ["ready", "error"].includes((await airplay()).status), 20_000);
    const state = await airplay();
    assert.equal(state.status, "ready", state.error ?? "");
    const host = await connect(Identity.generate().peerId, hostToken);
    const commands = await Promise.all(
      (await readdir("/proc"))
        .filter((entry) => /^\d+$/.test(entry))
        .map(
          async (entry) =>
            [
              Number(entry),
              await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => ""),
            ] as const,
        ),
    );
    const pid = commands.find(([, command]) => command.startsWith(`${realUxPlay}\0`))?.[0] ?? 0;
    assert.ok(pid, "UxPlay runs");
    const ports = await listening(pid);
    assert.ok(ports.length, "UxPlay listens for senders");
    assert.ok(
      (await readFile(`/proc/${pid}/environ`, "utf8"))
        .split("\0")
        .includes(`HOME=${join(directory, "data", "airplay")}`),
    );
    // Speak to it as senders that haven't paired: it answers, but Couch publishes nothing.
    const { createConnection } = await import("node:net");
    const logged = (line: string) =>
      log.mock.calls.filter((call) => String(call.arguments[0]).endsWith(` ${line}`)).length;
    const ask = async (socket: NetSocket, sequence: number) => {
      socket.write(`GET /info RTSP/1.0\r\nCSeq: ${sequence}\r\nUser-Agent: AirPlay/800.0\r\n\r\n`);
      return String(((await once(socket, "data")) as [Buffer])[0]);
    };
    const open = async () => {
      const socket = createConnection({ host: "127.0.0.1", port: ports[0]! });
      await once(socket, "connect");
      return socket;
    };
    const first = await open(),
      second = await open();
    assert.match(await ask(first, 1), /^RTSP\/1\.0 200/);
    await until(() => logged("airplay sender connected") === 1);
    // UxPlay holds one sender connection: the other is refused, and its open socket is no sender.
    assert.match(await ask(second, 1), /^RTSP\/1\.0 409/);
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  },
);

// A sender that never learns the code, against the real UxPlay with Couch's arguments: the attack on
// UxPlay's own -pin mode, which sets up audio for a sender that skips pairing. Its first SETUP carries
// all-zero keys, which UxPlay's FairPlay can't decrypt and so leaves as a zero AES key (lib/raop_handlers.h),
// then an ALAC stream encrypted with it. A sender that knows the code answers UxPlay's Digest challenge
// the same way and plays, which shows the same path admits the sender that does; FairPlay, pairing and
// an Apple device's own behaviour are not exercised.
const setupKeys = Buffer.from(
  "YnBsaXN0MDDXAQIDBAUGBwgJCgsMDQ5YZGV2aWNlSURTZWl2VGVrZXlVbW9kZWxUbmFtZVp0aW1pbmdQb3J0XnRpbWluZ1Byb3RvY29sXxARMDI6MDA6MDA6MDA6MDA6MDlPEBAAAAAAAAAAAAAAAAAAAAAATxBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVFRlc3RdTm8gUElOIHNlbmRlchGyblNOVFAIFyAkKS80P05idcDF09YAAAAAAAABAQAAAAAAAAAPAAAAAAAAAAAAAAAAAAAA2g==",
  "base64",
); // deviceID, zero eiv/ekey, name "No PIN sender", NTP timing
const setupAudio = Buffer.from(
  "YnBsaXN0MDDRAQJXc3RyZWFtc6ED1gQFBgcICQoLDA0OD1thdWRpb0Zvcm1hdFtjb250cm9sUG9ydFJjdFdpc01lZGlhU3NwZlR0eXBlEgAEAAAQABACCREBYBBgCAsTFSIuOj1FSU5TVVdYWwAAAAAAAAEBAAAAAAAAABAAAAAAAAAAAAAAAAAAAABd",
  "base64",
); // one ALAC stream, type 96, ct 2, spf 352
const alacFrame = Buffer.from(
  "IAAQAAACwAACDQoBYf6SAN//jAAkDwgBAAAAAAAAAA/4Baf+AWj/gFo+o+iBhAAAAAgccOgKMAAgpgAMAII4ygQtxYFmFqpK/D7PVMTpFotGcYZ5vWkKCdA7h0SVzrKqzMIZKmXn291aWSkZKTTVaGnHHXC6tzLXvXiAz9S0EtlE+U92lpK7wFSKIaSrJHMmIirhxopVdRl0jPTJV7+byer3eCtlRgpUCoQmdrAripmRhDPixuxkaDPj5Pc0WrsSsoU5x9DI0Gl1zc5qwpxTQU2po+kqms7RSKIDiVaRTQrvCGhk97bUhTR/wFf4",
  "base64",
); // one 352-sample ALAC frame of a tone
test(
  "the real UxPlay sets up sound only for a sender that answers with the code",
  { skip: !linux || !realUxPlay, timeout: 60_000 },
  async (t) => {
    const { airplay, player, request, connect, hostToken } = await fixture(t, {
      uxplay: `#!/bin/sh\nexec ${realUxPlay} "$@"\n`,
    });
    await request("/api/settings/airplay", { body: { enabled: true } });
    await until(async () => ["ready", "error"].includes((await airplay()).status), 20_000);
    assert.equal((await airplay()).status, "ready", (await airplay()).error ?? "");
    const host = await connect(Identity.generate().peerId, hostToken);
    const commands = await Promise.all(
      (await readdir("/proc"))
        .filter((entry) => /^\d+$/.test(entry))
        .map(
          async (entry) =>
            [
              Number(entry),
              await readFile(`/proc/${entry}/cmdline`, "utf8").catch(() => ""),
            ] as const,
        ),
    );
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
      const setup = (body: Buffer, authorization?: string) =>
        new Promise<{ status: number; headers: string; body: Buffer }>((resolve, reject) => {
          let data = Buffer.alloc(0);
          const got = (chunk: Buffer) => {
            data = Buffer.concat([data, chunk]);
            const end = data.indexOf("\r\n\r\n");
            if (end < 0) return;
            const headers = data.subarray(0, end).toString(),
              length = Number(/Content-Length: (\d+)/i.exec(headers)?.[1] ?? 0);
            if (data.length < end + 4 + length) return;
            socket.off("data", got);
            socket.off("close", closed);
            resolve({
              status: Number(headers.split(" ")[1]),
              headers,
              body: data.subarray(end + 4, end + 4 + length),
            });
          };
          const closed = () => reject(new Error("UxPlay closed the connection"));
          socket.on("data", got);
          socket.once("close", closed);
          socket.write(
            `SETUP rtsp://127.0.0.1/1 RTSP/1.0\r\nCSeq: ${++sequence}\r\nContent-Type: application/x-apple-binary-plist\r\nContent-Length: ${body.length}\r\n${authorization ? `Authorization: ${authorization}\r\n` : ""}\r\n`,
          );
          socket.write(body);
        });
      return { socket, setup };
    };
    const digest = (challenge: string, password: string) => {
      const nonce = /nonce="([^"]+)"/.exec(challenge)![1]!,
        uri = "rtsp://127.0.0.1/1";
      return `Digest username="AirPlay", realm="raop", nonce="${nonce}", uri="${uri}", response="${md5(`${md5(`AirPlay:raop:${password}`)}:${nonce}:${md5(`SETUP:${uri}`)}`)}"`;
    };
    // The data and control ports from UxPlay's binary plist answer to the audio SETUP.
    const ports = (plist: Buffer) => {
      const size = plist.at(-26)!,
        ref = plist.at(-25)!,
        table = Number(plist.readBigUInt64BE(plist.length - 8));
      const int = (at: number, bytes: number) => plist.readUIntBE(at, bytes);
      const object = (id: number): unknown => {
        let at = int(table + id * size, size);
        const marker = plist[at++]!,
          kind = marker >> 4;
        let count = marker & 15;
        if (count === 15 && kind !== 1) {
          const bytes = 1 << (plist[at++]! & 15);
          count = int(at, bytes);
          at += bytes;
        }
        if (kind === 1) return int(at, 1 << count);
        if (kind === 5) return plist.subarray(at, at + count).toString();
        if (kind === 10)
          return Array.from({ length: count }, (_, index) => object(int(at + index * ref, ref)));
        if (kind === 13)
          return Object.fromEntries(
            Array.from({ length: count }, (_, index) => [
              object(int(at + index * ref, ref)),
              object(int(at + (count + index) * ref, ref)),
            ]),
          );
        throw new Error(`unexpected binary plist object ${kind}`);
      };
      return (
        object(Number(plist.readBigUInt64BE(plist.length - 16))) as {
          streams: { dataPort: number; controlPort: number }[];
        }
      ).streams[0]!;
    };
    const sync = async (stream: { controlPort: number }) => {
      const udp = createSocket("udp4");
      await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
      t.after(() => udp.close());
      const packet = Buffer.alloc(20);
      packet[0] = 0x90;
      packet[1] = 0xd4;
      packet.writeUInt16BE(4, 2);
      packet.writeBigUInt64BE((BigInt(Math.floor(Date.now() / 1000)) + 2208988800n) << 32n, 8);
      udp.send(packet, stream.controlPort, "127.0.0.1");
      return udp;
    };
    const play = async (stream: { dataPort: number; controlPort: number }) => {
      const udp = await sync(stream);
      for (let index = 0; index < 240; index++) {
        const cipher = createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16));
        cipher.setAutoPadding(false);
        const whole = Math.floor(alacFrame.length / 16) * 16;
        const header = Buffer.alloc(12);
        header[0] = 0x80;
        header[1] = 0x60;
        header.writeUInt16BE(index, 2);
        header.writeUInt32BE(index * 352, 4);
        header.writeUInt32BE(0x1234, 8);
        udp.send(
          Buffer.concat([
            header,
            cipher.update(alacFrame.subarray(0, whole)),
            cipher.final(),
            alacFrame.subarray(whole),
          ]),
          stream.dataPort,
          "127.0.0.1",
        );
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
    };

    // Without the code: UxPlay challenges the key SETUP and sets up no stream to play.
    const stranger = await open();
    const challenged = await stranger.setup(setupKeys);
    assert.equal(challenged.status, 401);
    assert.match(challenged.headers, /WWW-Authenticate: Digest realm="raop", nonce="/);
    // A wrong code is challenged again.
    assert.equal(
      (await stranger.setup(setupKeys, digest(challenged.headers, "wrong-code-here"))).status,
      401,
    );
    // Skipping to the audio SETUP gets no stream: UxPlay drops the connection.
    const closed = once(stranger.socket, "close");
    void stranger.setup(setupAudio).catch(() => {});
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
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
    const elsewhere = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
    assert.ok(elsewhere, "the container has an address besides loopback");
    const intruder = createSocket("udp4");
    await new Promise<void>((resolve) => intruder.bind(0, elsewhere, resolve));
    t.after(() => intruder.close());
    for (let index = 0; index < 400; index++) {
      const header = Buffer.alloc(12);
      header[0] = 0x80;
      header[1] = 0x60;
      header.writeUInt16BE(index, 2);
      header.writeUInt32BE(index * 352, 4);
      header.writeUInt32BE(0x1234, 8);
      intruder.send(
        Buffer.concat([header, Buffer.from("200012000000025dc05dc1c0", "hex")]),
        stream.dataPort,
        elsewhere,
      );
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.deepEqual(
      host.state.liveSources ?? [],
      [],
      "sound from another address never reaches the sender's stream",
    );
    await play(stream);
    await until(() => host.state.liveSources?.[0]?.name === "AirPlay from No PIN sender", 5_000);
    // This sender doesn't answer UxPlay's clock requests, so UxPlay makes its sound due as it
    // arrives, too late to have started; it still holds updates off.
    assert.ok(["loading", "playing"].includes(await player()));
    known.socket.destroy();
    await until(() => !host.state.liveSources?.length, 10_000);
  },
);
