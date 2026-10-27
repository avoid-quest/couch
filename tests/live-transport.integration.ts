import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import WebSocket from "ws";
import { prepareNativeCapture } from "../app/native-capture";
import { readLivePacket } from "../src/server/live-packet";
import { helper as mediaHelper, startHelpers } from "../src/server/helpers";
import { liveFixture, until } from "./live-input.fixture";
import type { Output } from "../src/shared/protocol";

// Real Core: Hub authorization, the audio worker's transport and Main's native upload of the fixture helper.
const requested = { sampleRate: 48000, requestedCallbackFrames: 128 } as const;
const publication = { type: "publishLive", sourceId: "concert", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" } as const;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (check: () => boolean, ms = 5000) => { const deadline = Date.now() + ms; while (!check()) { assert.ok(Date.now() < deadline, "bounded wait"); await sleep(10); } };

async function setup(t: { after: (fn: () => unknown) => void }, settings: Record<string, unknown>) {
  const f = await liveFixture();
  t.after(() => f.close());
  startHelpers(join(dirname(f.databasePath), "helpers"));
  await Promise.allSettled([mediaHelper("ffmpeg"), mediaHelper("qjs"), mediaHelper("yt-dlp")]);
  const host = await f.connect(-1), hostToken = "h".repeat(64);
  const saved = await fetch(`${f.hub.origin}/api/settings/live-audio`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
  assert.equal(saved.status, 200);
  assert.equal((await host.command(publication)).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id, picture: false, sound: true })).ok, true);
  await until(() => host.messages.some(message => message.type === "livePeers" && message.upload));
  const demand = host.messages.findLast(message => message.type === "livePeers" && message.upload);
  assert.ok(demand?.type === "livePeers" && demand.uploadId);
  const uploadUrl = `${f.uploadUrl("concert", f.uploadToken, -1)}&uploadId=${demand.uploadId}`;
  const capture = async () => {
    const child = spawn(process.execPath, [resolve("tests/fixtures/native-capture-helper.mjs"), "stream"], { stdio: ["pipe", "pipe", "pipe"] });
    const errors: Error[] = [], source = await prepareNativeCapture(child, requested, error => errors.push(error));
    t.after(() => source.stop());
    await source.upload(uploadUrl);
    return { stop: () => source.stop(), errors };
  };
  const url = (token: string, sourceId = "concert") => `${f.hub.origin.replace("http:", "ws:")}/api/live/listen?${new URLSearchParams({ token, sourceId })}`;
  const listen = (token = f.identities[1]!.token) => {
    const socket = new WebSocket(url(token), { headers: { Origin: f.hub.origin } });
    const messages: Record<string, unknown>[] = [], packets: (ReturnType<typeof readLivePacket> & { at: number })[] = [];
    const closed = new Promise<{ code: number; reason: string }>(resolve => socket.once("close", (code, reason) => resolve({ code, reason: String(reason) })));
    socket.on("message", (data, binary) => { if (binary) packets.push({ ...readLivePacket(data as Buffer), at: performance.now() }); else messages.push(JSON.parse(String(data))); });
    socket.on("error", () => {});
    return { socket, messages, packets, closed, opened: new Promise(resolve => socket.once("open", resolve)), send: (message: unknown) => socket.send(JSON.stringify(message)) };
  };
  const refused = (token: string) => new Promise<number>(resolve => {
    const socket = new WebSocket(url(token), { headers: { Origin: f.hub.origin } });
    socket.on("unexpected-response", (_request, response) => { resolve(response.statusCode!); socket.terminate(); });
    socket.on("open", () => { resolve(101); socket.close(); }); socket.on("error", () => {});
  });
  // Host time for a local instant, from the quickest of a few pings.
  const hostClock = async (listener: ReturnType<typeof listen>) => {
    let best = { rtt: Infinity, offsetUs: 0 };
    for (let i = 0; i < 5; i++) {
      const t = performance.now(), before = listener.messages.length;
      listener.send({ type: "ping", t });
      await waitFor(() => listener.messages.slice(before).some(message => message.type === "pong" && message.t === t));
      const back = performance.now(), pong = listener.messages.slice(before).find(message => message.type === "pong" && message.t === t)!;
      if (back - t < best.rtt) best = { rtt: back - t, offsetUs: (pong.s as number) - (t + back) / 2 * 1000 };
    }
    return (local: number) => local * 1000 + best.offsetUs;
  };
  return { f, host, capture, listen, refused, hostClock };
}
const outputOf = (state: { playbacks?: { outputs: Output[]; liveLeadMs?: number }[] }, deviceId: string) => state.playbacks?.flatMap(playback => playback.outputs.map(output => ({ ...output, leadMs: playback.liveLeadMs }))).find(output => output.deviceId === deviceId);

test("Core streams timestamped Live PCM to an authorized listener and keeps its shared lead", { timeout: 90_000 }, async t => {
  const { f, host, capture, listen, refused, hostClock } = await setup(t, { codec: "pcm", lead: "automatic", leadMs: 40, minLeadMs: 0, maxLeadMs: 100, raiseForSlowest: true });
  const first = await capture();
  const a = listen();
  await a.opened;
  await waitFor(() => a.messages.some(message => message.type === "hello"));
  const hello = a.messages.find(message => message.type === "hello")!;
  assert.deepEqual({ ...hello, session: typeof hello.session }, { type: "hello", leadMs: 40, codec: 1, opusFrames: 120, session: "string" });
  assert.ok(a.messages.some(message => message.type === "lead-status" && message.status === "warming"));

  // Pong on the host clock: the same clock the packets' capture times use.
  const hostNow = await hostClock(a);
  await waitFor(() => a.packets.length > 200);
  const sessionPackets = a.packets.filter(packet => packet.position >= 0);
  for (const [i, packet] of sessionPackets.entries()) {
    assert.equal(packet.codec, 1); assert.equal(packet.channels, 2); assert.equal(packet.frames, 128); assert.equal(packet.payload.length, 512);
    if (i) { assert.equal(packet.position, sessionPackets[i - 1]!.position + 128, "monotonic positions"); assert.equal(packet.seq, sessionPackets[i - 1]!.seq + 1); }
    const age = hostNow(packet.at) - packet.captureUs;
    assert.ok(age > -2000 && age < 40_000, `capture → arrival ${(age / 1000).toFixed(2)} ms stays within the 40 ms lead`);
  }

  // Refused before upgrade: unpaired, and paired but not playing this source.
  assert.equal(await refused("x".repeat(64)), 401);
  assert.equal(await refused(f.identities[2]!.token), 403);

  // Stats: after warming, two reports above the lead raise it for everyone, and Hub publishes the listener.
  const stats = setInterval(() => a.send({ type: "stats", needMs: 60, marginMinMs: -20, missing: 1, concealEvents: 2 }), 600);
  t.after(() => clearInterval(stats));
  await waitFor(() => a.messages.some(message => message.type === "lead"), 30_000);
  const command = a.messages.find(message => message.type === "lead")!;
  assert.equal(command.leadMs, 63);
  assert.ok((command.atServerUs as number) > hostNow(performance.now()) - 1_000_000);
  await waitFor(() => a.messages.some(message => message.type === "lead-status" && message.status === "limiting"));
  await until(() => outputOf(f.receiver.state, f.receiver.id)?.liveListener?.status === "limiting");
  const published = outputOf(f.receiver.state, f.receiver.id)!;
  assert.equal(published.leadMs, 63);
  assert.deepEqual({ ...published.liveListener, gaps: published.liveListener!.gaps > 20, concealments: published.liveListener!.concealments > 40 },
    { codec: "pcm", status: "limiting", latencyMs: 60, marginMs: -20, gaps: true, concealments: true, behindMs: 0 });
  clearInterval(stats);

  // A reconnect within one capture keeps the session; a capture restart gives listeners a new one.
  const session = a.messages.findLast(message => message.type === "hello")!.session;
  a.socket.close();
  await a.closed;
  const b = listen();
  await waitFor(() => b.messages.some(message => message.type === "hello"));
  assert.equal(b.messages.find(message => message.type === "hello")!.session, session);
  await first.stop();
  const second = await capture();
  await waitFor(() => b.messages.filter(message => message.type === "hello").length === 2);
  const restarted = b.messages.filter(message => message.type === "hello")[1]!;
  assert.notEqual(restarted.session, session);
  await waitFor(() => b.packets.some(packet => packet.seq === 0 && packet.position === 0));
  assert.deepEqual(second.errors, []);

  // A listener that stops reading is not queued stale audio: Core skips its packets, then closes it with a reason.
  const bClock = await hostClock(b);
  (b.socket as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
  const pausedAt = performance.now();
  await sleep(3000);
  (b.socket as unknown as { _socket: { resume(): void } })._socket.resume();
  const backlog = await b.closed;
  assert.deepEqual(backlog, { code: 4002, reason: "This connection fell behind the live audio." });
  const newest = Math.max(...b.packets.filter(packet => packet.at >= pausedAt).map(packet => packet.captureUs));
  assert.ok(newest - bClock(pausedAt) < 1_000_000, `audio stops within a second of the stall; the last packet queued was captured ${((newest - bClock(pausedAt)) / 1000).toFixed(0)} ms after it`);

  // Revoking a listening device closes its stream.
  const other = await f.connect(2);
  assert.equal((await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id, picture: false, sound: true })).ok, true);
  const o = listen(f.identities[2]!.token);
  await waitFor(() => o.packets.length > 10);
  assert.equal((await fetch(`${f.hub.origin}/api/devices/${other.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } })).status, 200);
  assert.deepEqual(await o.closed, { code: 4001, reason: "This device was removed. Pair again." });

  // The host removes a listener: 4001 with a reason, and the device no longer plays it.
  const c = listen();
  await waitFor(() => c.packets.length > 10);
  const playbackId = f.receiver.state.player.playbackId!;
  assert.equal((await f.receiver.command({ type: "removeLiveListener", playbackId, deviceId: f.receiver.id })).ok, false, "a listener cannot remove others");
  const removal = await host.command({ type: "removeLiveListener", playbackId, deviceId: f.receiver.id });
  assert.equal(removal.ok, true, removal.error);
  assert.deepEqual(await c.closed, { code: 4001, reason: "Removed by the host." });
  assert.equal(await refused(f.identities[1]!.token), 403);
  await second.stop();
});

test("Opus listeners get 2.5 ms packets from the bundled encoder, moved back by its lookahead", { timeout: 30_000 }, async t => {
  const { capture, listen, hostClock } = await setup(t, { codec: "opus", opusBitrate: 192000, lead: "fixed", leadMs: 60 });
  const a = listen();
  await waitFor(() => a.messages.some(message => message.type === "hello"));
  const source = await capture();
  assert.equal(a.messages.find(message => message.type === "hello")!.codec, 2);
  const hostNow = await hostClock(a);
  await waitFor(() => a.packets.length > 400);
  const first = a.packets.findIndex(packet => packet.position === -120);
  assert.ok(first >= 0, "the first frame starts one lookahead before the capture");
  for (const [i, packet] of a.packets.slice(first).entries()) {
    assert.equal(packet.codec, 2); assert.equal(packet.frames, 120); assert.equal(packet.seq, a.packets[first]!.seq + i);
    assert.equal(packet.position, -120 + i * 120);
    const age = hostNow(packet.at) - packet.captureUs;
    assert.ok(age > -2000 && age < 60_000, `capture → arrival ${(age / 1000).toFixed(2)} ms`);
  }
  await source.stop();
});
