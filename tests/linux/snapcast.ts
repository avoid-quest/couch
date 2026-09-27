import { strict as assert } from "node:assert";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createHub } from "../../src/server/hub";
import type { Action, ServerMessage, SessionState } from "../../src/shared/protocol";

// Actual Snapcast 0.35.0 + two PulseAudio null sinks; see the ignored fixture setup.
const artifacts = resolve(process.env.COUCH_ARTIFACTS ?? ".artifacts/device-independent-playback/snapcast-integration/run");
const container = process.env.COUCH_SNAPCAST_CONTAINER ?? "couch-snapcast-integration";
const controlUrl = "ws://127.0.0.1:1780/jsonrpc";
await mkdir(artifacts, { recursive: true });
const sourceHashes = Object.fromEntries(await Promise.all(["src/server/pcm-producer.ts", "src/server/snapcast.ts", "src/server/hub.ts", "tests/linux/snapcast.ts"].map(async path => [path, new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex")])));
await Bun.write(`${artifacts}/source-hashes.json`, JSON.stringify(sourceHashes, null, 2));
const events: unknown[] = [], started = performance.now();
const event = (name: string, details: unknown = {}) => { events.push({ name, time: (performance.now() - started) / 1000, details }); console.log(`PASS ${name}`); };
async function until(name: string, predicate: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!await predicate()) { assert.ok(performance.now() < deadline, name); await Bun.sleep(100); }
  event(name);
}
async function docker(script: string) {
  const child = Bun.spawn(["docker", "exec", container, "sh", "-c", script], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(code, 0, stderr); return stdout.trim();
}
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(controlUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method} timed out`)); }, 4000);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
    ws.onmessage = message => { const reply = JSON.parse(String(message.data)); if (reply.id !== 1) return; clearTimeout(timer); ws.close(); reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result); };
    ws.onerror = () => { clearTimeout(timer); ws.close(); reject(new Error("Snapcast RPC disconnected")); };
  });
}
const initial = await rpc("Server.GetStatus");
await Bun.write(`${artifacts}/initial-status.json`, JSON.stringify(initial, null, 2));
const groupId = initial.server.groups.find((group: any) => group.clients.some((client: any) => client.id === "room1")).id;
await rpc("Group.SetClients", { id: groupId, clients: ["room1", "room2"] });
await rpc("Group.SetStream", { id: groupId, stream_id: "couch" });
for (const id of ["room1", "room2"]) await rpc("Client.SetVolume", { id, volume: { percent: 100, muted: false } });

const wav = Buffer.alloc(44 + 60 * 48_000 * 4);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(192_000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 60 * 48_000; sample++) {
  const value = Math.round(12000 * Math.sin(2 * Math.PI * (sample < 15 * 48_000 ? 440 : 880) * sample / 48_000));
  wav.writeInt16LE(value, 44 + sample * 4); wav.writeInt16LE(value, 46 + sample * 4);
}
await Bun.write(`${artifacts}/tone.wav`, wav);
const media = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const range = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
  return new Response(wav.subarray(start, end + 1), { status: range ? 206 : 200, headers: { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": String(end - start + 1), ...(range ? { "content-range": `bytes ${start}-${end}/${wav.length}` } : {}) } });
} });
const recordings = ["room1", "room2"].map(room => Bun.spawn(["docker", "exec", container, "parec", `--device=${room}.monitor`, "--format=s16le", "--rate=48000", "--channels=2"], { stdout: Bun.file(`${artifacts}/${room}.pcm`), stderr: Bun.file(`${artifacts}/${room}-capture.log`) }));
async function sample(room: string) {
  const file = Bun.file(`${artifacts}/${room}.pcm`), size = file.size;
  if (size < 38_400) return { rms: 0, frequency: 0 };
  const bytes = Buffer.from(await file.slice(size - 38_400, size).arrayBuffer());
  let sum = 0, crossings = 0, previous = 0;
  for (let index = 0; index + 3 < bytes.length; index += 4) {
    const value = bytes.readInt16LE(index); sum += value * value;
    if (value >= 0 && previous < 0) crossings++; previous = value;
  }
  return { rms: Math.sqrt(sum / (bytes.length / 4)), frequency: crossings / (bytes.length / 192_000) };
}
const both = async (predicate: (value: Awaited<ReturnType<typeof sample>>) => boolean) => (await Promise.all([sample("room1"), sample("room2")])).every(predicate);
const data = await mkdtemp("/tmp/couch-snapcast-integration-");
const hub = createHub({ hostname: "127.0.0.1", port: 0, databasePath: `${data}/couch.sqlite`, hostToken: "snapcast-qualification-host-token-1234567890", pairingCode: "123456", snapcast: { controlUrl, streamId: "couch", idleStreamId: "idle", groupId, name: "Software rooms", pcmHost: "127.0.0.1", pcmPort: 4953, bufferMs: 500, drainMs: 750 } });
let controller: WebSocket | undefined, state: SessionState | undefined;
const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
const command = (action: Action) => new Promise<void>((resolve, reject) => {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${action.type} timed out`)); }, 12_000);
  pending.set(requestId, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
  controller!.send(JSON.stringify({ type: "command", requestId, action }));
});
const target = () => state?.targets?.find(target => target.id === "snapcast-group");
try {
  const response = await fetch(`${hub.origin}/api/pair`, { method: "POST", headers: { origin: hub.origin, "content-type": "application/json" }, body: JSON.stringify({ code: hub.pairingCode, name: "Snapcast integration" }) });
  assert.equal(response.status, 200);
  const { token } = await response.json() as { token: string };
  controller = new (WebSocket as typeof WebSocket & { new(url: string, options: Bun.WebSocketOptions): WebSocket })(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${token}`, { headers: { origin: hub.origin } });
  controller.onmessage = message => {
    const value = JSON.parse(String(message.data)) as ServerMessage;
    if (value.type === "state") {
      state = value.state;
      void Bun.write(`${artifacts}/latest-state.json`, JSON.stringify(state, null, 2));
    }
    if (value.type === "result") { const request = pending.get(value.requestId); pending.delete(value.requestId); value.ok ? request?.resolve() : request?.reject(new Error(value.error)); }
  };
  await until("real Snapcast group connects with two actual clients", () => !!target()?.connected && target()?.members?.filter(member => member.joined && member.connected).length === 2);
  await command({ type: "selectTarget", targetId: "snapcast-group" });
  await command({ type: "enqueue", entry: { id: "tone", title: "Seekable tone", source: `http://127.0.0.1:${media.port}/tone.wav`, duration: 60 } });
  // Catalogs supply trusted duration through this seam; controller metadata is
  // intentionally discarded. The generated fixture has exactly 60 seconds.
  hub.session.enrichEntry("tone", `http://127.0.0.1:${media.port}/tone.wav`, { duration: 60 });
  await command({ type: "play", entryId: "tone", fromStart: true });
  await until("paced Core producer plays 440Hz in both real software outputs", () => both(value => value.rms > 3000 && Math.abs(value.frequency - 440) < 20));
  assert.equal(state?.player.positionEstimated, true);
  await command({ type: "pause", playbackId: state!.player.playbackId!, paused: true });
  await until("Pause drains both actual outputs to silence and publishes paused", async () => state?.player.status === "paused" && await both(value => value.rms < 5));
  await command({ type: "seek", playbackId: state!.player.playbackId!, position: 30 });
  await command({ type: "pause", playbackId: state!.player.playbackId!, paused: false });
  await until("Seek30 and Resume play the880Hz source section on both outputs", () => both(value => value.rms > 3000 && Math.abs(value.frequency - 880) < 20));
  await command({ type: "groupVolume", targetId: "snapcast-group", memberId: "room1", volume: 25, muted: false });
  await until("per-member volume changes only room1 audio", async () => { const [one, two] = await Promise.all([sample("room1"), sample("room2")]); return one.rms > 100 && one.rms < two.rms / 3 && two.rms > 3000; });
  await command({ type: "groupMembers", targetId: "snapcast-group", memberIds: ["room1"] });
  await until("removed room2 is actually silent while room1 continues", async () => (await sample("room2")).rms < 5 && (await sample("room1")).rms > 100);
  await command({ type: "groupMembers", targetId: "snapcast-group", memberIds: ["room1", "room2"] });
  await until("rejoined room2 receives the current880Hz playback", async () => { const value = await sample("room2"); return value.rms > 3000 && Math.abs(value.frequency - 880) < 20; });
  await command({ type: "stop" });
  await until("Stop drains both actual outputs to silence", () => both(value => value.rms < 5));
  await command({ type: "play", entryId: "tone", fromStart: true });
  await until("explicit new Play restores both outputs", () => both(value => value.rms > 100 && Math.abs(value.frequency - 440) < 20));
  await docker("kill $(cat /evidence/client1.pid) $(cat /evidence/client2.pid)");
  await until("losing all actual members makes the group unavailable", () => !target()?.connected);
  await docker("snapclient --host 127.0.0.1 --hostID room1 --player pulse --soundcard room1 >> /evidence/client1.log 2>&1 & echo $! > /evidence/client1.pid; snapclient --host 127.0.0.1 --hostID room2 --player pulse --soundcard room2 >> /evidence/client2.log 2>&1 & echo $! > /evidence/client2.pid");
  await until("actual members reconnect to Snapcast", async () => (await rpc("Server.GetStatus")).server.groups.flatMap((group: any) => group.clients).filter((client: any) => client.connected).length === 2);
  await command({ type: "groupReconnect", targetId: "snapcast-group" });
  await until("reconnected members restore availability", () => !!target()?.connected);
  await Bun.sleep(1500);
  assert.notEqual(state!.player.status, "playing");
  assert.ok(await both(value => value.rms < 5), "member reconnect cannot autoplay");
  await command({ type: "selectTarget", targetId: "snapcast-group" });
  await command({ type: "play", entryId: "tone", fromStart: true });
  await until("explicit Play after member recovery restores output", () => both(value => value.rms > 100));
  await docker("kill $(cat /evidence/server.pid)");
  await until("backend loss makes the configured group unavailable", () => !target()?.connected);
  await until("backend loss drains actual outputs to silence", () => both(value => value.rms < 5));
  await docker("snapserver -c /evidence/snapserver.conf >> /evidence/server.log 2>&1 & echo $! > /evidence/server.pid");
  await until("restarted backend accepts its actual clients", async () => {
    try { return (await rpc("Server.GetStatus")).server.groups.flatMap((group: any) => group.clients).filter((client: any) => client.connected).length === 2; }
    catch { return false; }
  }, 25_000);
  await command({ type: "groupReconnect", targetId: "snapcast-group" });
  await until("backend reconnect restores availability without playback", () => !!target()?.connected, 25_000);
  await Bun.sleep(1500);
  assert.notEqual(state!.player.status, "playing");
  assert.ok(await both(value => value.rms < 5), "backend recovery cannot autoplay");
  event("backend and member recovery require explicit playback");
  await Bun.write(`${artifacts}/results.json`, JSON.stringify({ passed: true, events, git: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(), dirty: !!Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim(), limitations: "Two actual Snapcast clients/PulseAudio software monitors. No physical speaker synchronization or long-run drift qualification. Known generated WAV duration enters through the trusted catalog enrichment seam; unknown-duration direct HTTP seeking is not qualified. PCM producer is the actual Core adapter, not the earlier standalone ffmpeg TCP baseline." }, null, 2));
} catch (error) {
  console.error(error);
  await Bun.write(`${artifacts}/failure.json`, JSON.stringify({ error: String(error), state }, null, 2));
  throw error;
} finally {
  await Bun.write(`${artifacts}/events.json`, JSON.stringify(events, null, 2));
  controller?.close(); await hub.close(); await media.stop(true);
  await docker('for p in /proc/[0-9]*; do read comm < "$p/comm"; if [ "$comm" = parec ]; then kill "${p##*/}"; fi; done');
  await Promise.all(recordings.map(recorder => recorder.exited));
}
