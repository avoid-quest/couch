import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { helper, startHelpers } from "../src/server/helpers";
import { createReceiverAdmission } from "../src/client/session/receiver-admission";
import type { Action, AudioPreparation, Output, ReceiverPreparation, ServerMessage, SessionState } from "../src/shared/protocol";

async function until(check: () => boolean, message = "Expected public admission state", timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// Real Hub, authorization, worker, capture upload/FFmpeg and encrypted SDK traffic.
// Only output preparation is a controllable platform substitute; packets are not DAC proof.
async function fixture({ overflow = false } = {}) {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "output-admission-"));
  const previousPath = process.env.PATH, originalFetch = globalThis.fetch;
  const bin = join(directory, "bin"); mkdirSync(bin);
  const overflowFile = join(directory, "overflow-capture");
  if (overflow) {
    // Fixture-only encoder boundary substitute: trickle framed 10 ms packets,
    // then overproduce on demand to hit the real worker's bounded-queue fail().
    // These bytes test failure provenance, not Opus decoding or capture timing.
    writeFileSync(join(bin, "ffmpeg"), `#!${process.execPath}
if (process.argv.includes('-version')) { console.log('ffmpeg version 9.0.2'); process.exit(0); }
const fs = await import('node:fs');
const page = Buffer.alloc(31); page.write('OggS'); page[26] = 1; page[27] = 3;
page.set([0xf0, 0xff, 0xfe], 28);
let received = -58, frames = 0, overflowed = false;
process.stdin.on('data', data => {
  received += data.length;
  while (frames < Math.floor(received / 3840)) { process.stdout.write(page); frames++; }
});
setInterval(() => {
  if (!overflowed && fs.existsSync(${JSON.stringify(overflowFile)})) {
    overflowed = true; process.stdout.write(Buffer.concat(Array(230).fill(page)));
  }
}, 5);
`, { mode: 0o755 });
  } else if (process.env.COUCH_TEST_FFMPEG) symlinkSync(process.env.COUCH_TEST_FFMPEG, join(bin, "ffmpeg"));
  for (const [name, version] of [["qjs", "QuickJS-ng version 0.15.0"], ["yt-dlp", "2026.10.21"]]) {
    writeFileSync(join(bin, name!), `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
  }
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  globalThis.fetch = ((input, init) => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(String(input))
    ? originalFetch(input, init) : Promise.resolve(new Response("Offline discovery fixture", { status: 503 }))) as typeof fetch;
  startHelpers(join(directory, "helpers"));
  const helpers = await Promise.allSettled([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  assert.equal(helpers[0]!.status, "fulfilled", "a real FFmpeg is required for scheduled packets");
  const databasePath = join(directory, "couch.sqlite"), hostToken = "h".repeat(64);
  const store = openStore(databasePath, true);
  const identities = ["Listener", "Healthy listener"].map(name => {
    const key = Identity.generate(); return { key, id: key.peerId, token: store.pair(key.peerId, name) };
  });
  store.close();
  const hostKey = Identity.generate();
  const hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: 0 });
  const sockets: WebSocket[] = [], speakers: SendspinClient[] = [], timers: ReturnType<typeof setInterval>[] = [];
  const guards: ReturnType<typeof createReceiverAdmission>[] = [];
  async function control(index = 0, capability: string | null = "1") {
    const identity = index === -1 ? { id: hostKey.peerId, token: hostToken } : identities[index]!;
    const url = new URL("/api/ws", hub.origin); url.protocol = "ws:";
    url.searchParams.set("token", identity.token); url.searchParams.set("device", identity.id);
    if (capability !== null) url.searchParams.set("receiverPreparation", capability);
    const socket = new WebSocket(url, { headers: { Origin: hub.origin } }); sockets.push(socket);
    const messages: ServerMessage[] = [], pending = new Map<string, (reply: Extract<ServerMessage, { type: "result" }>) => void>();
    let state: SessionState, sequence = 0;
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.on("message", raw => {
        const message = JSON.parse(String(raw)) as ServerMessage; messages.push(message);
        if (message.type === "state") { state = message.state; resolve(); }
        if (message.type === "result") { pending.get(message.requestId)?.(message); pending.delete(message.requestId); }
      });
    });
    return {
      id: identity.id, socket, messages, get state() { return state; },
      get instruction() { return messages.findLast((message): message is Extract<ServerMessage, { type: "sendspin" }> => message.type === "sendspin"); },
      get output() { return state.outputs?.find(output => output.deviceId === identity.id); },
      command(action: Action) {
        const requestId = String(++sequence);
        return new Promise<Extract<ServerMessage, { type: "result" }>>(resolve => {
          pending.set(requestId, resolve); socket.send(JSON.stringify({ type: "command", requestId, action }));
        });
      },
    };
  }
  const host = await control(-1);
  async function publish(id = "stage", intent: "live" | "relaxed" = "live", publisher = host) {
    const key = "1".repeat(64);
    const reply = await publisher.command({ type: "publishLive", sourceId: id, uploadToken: key, kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent });
    assert.equal(reply.ok, true, reply.error);
    await until(() => publisher.messages.some(message => message.type === "livePeers" && message.sourceId === id && message.upload));
    const demand = publisher.messages.findLast(message => message.type === "livePeers" && message.sourceId === id && message.upload);
    assert.ok(demand?.type === "livePeers" && demand.uploadId);
    const url = new URL("/api/live/upload", hub.origin); url.protocol = "ws:";
    url.search = new URLSearchParams({ token: hostToken, sourceId: id, key, uploadId: demand.uploadId }).toString();
    const upload = new WebSocket(url, { headers: { Origin: hub.origin } }); sockets.push(upload);
    upload.on("error", () => {});
    await new Promise<void>((resolve, reject) => { upload.once("open", resolve); upload.once("error", reject); });
    upload.send(JSON.stringify({ type: "start", generation: `capture-${id}`, offsetUs: 0, rttUs: 0 }));
    const origin = serverNowUs(); let sequence = 0;
    const timer = setInterval(() => {
      if (upload.readyState !== WebSocket.OPEN) return;
      const due = Math.floor((serverNowUs() - origin) / 10_000);
      while (sequence < due) {
        const packet = Buffer.alloc(40 + 960 * 4), position = sequence * 480;
        packet.writeUInt32LE(0x31414343); packet.writeUInt8(2, 4); packet.writeUInt8(1, 5); packet.writeUInt16LE(40, 6);
        packet.writeUInt32LE(48000, 8); packet.writeUInt32LE(sequence, 12); packet.writeBigUInt64LE(BigInt(position), 16);
        packet.writeBigInt64LE(BigInt(origin + sequence * 10_000), 24); packet.writeUInt32LE(480, 32);
        for (let i = 0; i < 960; i++) packet.writeFloatLE(Math.sin((position + Math.floor(i / 2)) * 2 * Math.PI * (i % 2 ? 660 : 440) / 48000) * .2, 40 + i * 4);
        upload.send(packet); sequence++;
      }
    }, 5);
    timers.push(timer);
    return { upload, stop() { clearInterval(timer); upload.terminate(); } };
  }
  async function speaker(index = 0, codec = AudioCodec.OPUS) {
    const identity = identities[index]!;
    const client = new SendspinClient(identity.id, "Admission receiver", [Roles.PLAYER], {
      encryption: { identity: identity.key },
      playerSupport: { supported_formats: [{ codec, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [] },
    });
    speakers.push(client); let frames = 0, starts = 0, clears = 0;
    client.addAudioChunkListener(() => frames++); client.addStreamStartListener(() => starts++); client.addStreamClearListener(() => clears++);
    await client.connect(`${hub.origin.replace("http:", "ws:")}/sendspin`, { timeoutMs: 3000 });
    const report = (preparation?: ReceiverPreparation, lead = 25) => client.sendPlayerState({
      required_lead_time_ms: lead, min_buffer_ms: Math.min(lead, 25), static_delay_ms: 0, ...preparation ? { couch_preparation: preparation } : {},
    });
    return { client, report, get frames() { return frames; }, get starts() { return starts; }, get clears() { return clears; } };
  }
  function preparation(sink: Awaited<ReturnType<typeof speaker>>, receiverId: string) {
    let finish!: () => void, fail!: (error: Error) => void, calls = 0, active = true, epoch = 0;
    const writes: Promise<void>[] = [];
    const receiver = {
      outputReady: false, outputState: "running", timeSyncInfo: { synced: true, error: 0 }, syncInfo: { outputLatencyMs: 10, processingTimeMs: 2 },
      prepareAudio: () => { calls++; return new Promise<void>((resolve, reject) => { finish = () => { receiver.outputReady = true; resolve(); }; fail = reject; }); },
      invalidateAudio() { receiver.outputReady = false; },
    };
    const guard = createReceiverAdmission(receiver, () => active,
      (report: AudioPreparation & { epoch: number }, timing?: { requiredLeadTimeMs: number; minBufferMs: number }) => {
        epoch = report.epoch;
        writes.push(sink.client.sendPlayerState({ couch_preparation: { ...report, receiverId }, required_lead_time_ms: timing?.requiredLeadTimeMs ?? 1000, min_buffer_ms: timing?.minBufferMs ?? 25, static_delay_ms: 0 }));
      });
    guards.push(guard);
    return { guard, receiver, get calls() { return calls; }, get epoch() { return epoch; }, finish: () => finish(), fail: () => fail(new Error("No usable output timestamp")), stop() { active = false; guard.close(); }, async flush() { await Promise.all(writes); } };
  }
  async function joinLive(client: Awaited<ReturnType<typeof control>>, sourceId = "stage") {
    const reply = await client.command({ type: "playLive", sourceId, deviceId: client.id, picture: false, sound: true });
    assert.equal(reply.ok, true, reply.error);
    await until(() => client.instruction?.listen === true);
  }
  return { host, hub, control, publish, speaker, preparation, join: joinLive,
    overflowCapture: () => writeFileSync(overflowFile, "overflow"),
    api: (path: string, method: string, body?: unknown) => fetch(`${hub.origin}${path}`, { method, headers: { Authorization: `Bearer ${hostToken}`, ...body === undefined ? {} : { "Content-Type": "application/json" } }, ...body === undefined ? {} : { body: JSON.stringify(body) } }),
    async close() {
      for (const timer of timers) clearInterval(timer);
      for (const guard of guards) guard.close();
      await Promise.all(speakers.map(speaker => speaker.disconnect()));
      await hub.close();
      for (const socket of sockets) socket.terminate();
      process.env.PATH = previousPath; globalThis.fetch = originalFetch;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

type Control = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["control"]>>;
const token = (client: Control) => { assert.ok(client.instruction?.receiverId); return client.instruction.receiverId; };
const outputIn = (client: Control, id: string): Output | undefined => client.state.playbacks?.flatMap(playback => playback.outputs).find(output => output.deviceId === id);

for (const codec of [AudioCodec.OPUS, AudioCodec.PCM]) test(`45 ms Live ${codec} admits only within its measured headroom through public Join and encrypted worker delivery`, { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.api("/api/settings/audio", "POST", { liveAudioLeadMs: 45 })).status, 200);
    const listener = await f.control(); await f.publish(); await f.join(listener);
    const receiverId = token(listener), sink = await f.speaker(0, codec);
    await sink.report({ receiverId, epoch: 0, state: "preparing" });
    await until(() => listener.output?.audioAdmission?.state === "preparing");
    assert.equal(sink.frames, 0);
    // No measured headroom can reach the whole 45 ms lead.
    await sink.report({ receiverId, epoch: 0, state: "ready" }, 45);
    await until(() => listener.output?.audioAdmission?.state === "failed");
    assert.deepEqual(listener.output?.audioAdmission?.state === "failed" && listener.output.audioAdmission.reason, "required-lead");
    const allowed = Number(/allows (\d+) ms/.exec(listener.output?.error ?? "")?.[1]);
    assert.ok(allowed >= 0 && allowed < 45, `measured ${allowed} ms of the 45 ms lead`);
    assert.equal(sink.frames, 0, "a ready report cannot expand the measured budget");
    await sink.report({ receiverId, epoch: 0, state: "ready" }, 1);
    await until(() => listener.output?.audioAdmission?.state === "ready" && sink.frames > 10);
    assert.equal(token(listener), receiverId, "readiness recovery keeps the current consented receiver");
    assert.equal(listener.output?.error, undefined);
  } finally { await f.close(); }
});

test("public Live Join stays preparing during held output setup, then receives encrypted audio without rejoining", { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    const listener = await f.control(); await f.publish(); await f.join(listener);
    const receiverId = token(listener), sink = await f.speaker(), prep = f.preparation(sink, receiverId);
    const pending = prep.guard.tick(); await prep.flush();
    await until(() => listener.output?.audioAdmission?.state === "preparing");
    assert.equal(listener.output?.error, undefined); assert.equal(sink.starts, 0); assert.equal(sink.frames, 0);
    const membership = listener.state.playback;
    prep.finish(); await pending; await prep.flush();
    await until(() => listener.output?.audioAdmission?.state === "ready" && sink.frames > 10);
    assert.equal(listener.state.playback, membership); assert.equal(token(listener), receiverId);
    assert.equal(prep.calls, 1); assert.equal(sink.starts, 1); assert.equal(listener.output?.error, undefined);
    await sink.report({ receiverId, epoch: prep.epoch, state: "ready" }, 100);
    await until(() => listener.output?.audioAdmission?.state === "failed");
    const refused = listener.output!.audioAdmission!;
    assert.ok(refused.state === "failed"); assert.equal(refused.reason, "required-lead");
    assert.ok(listener.output?.error, "an explicit ready assertion cannot bypass the genuine numeric gate");
    const before = sink.frames; await sink.report({ receiverId, epoch: prep.epoch, state: "ready" });
    await until(() => listener.output?.audioAdmission?.state === "ready" && sink.frames > before + 10);
    assert.equal(listener.state.playback, membership); assert.equal(token(listener), receiverId);
  } finally { await f.close(); }
});

test("new control tab retires an old current Noise session's pending success and failure before replacement connects", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const old = await f.control(), healthy = await f.control(1);
    await f.publish(); await f.join(old); await f.join(healthy);
    const oldSink = await f.speaker(), oldToken = token(old), prep = f.preparation(oldSink, oldToken);
    const pending = prep.guard.tick(); await prep.flush();
    const healthySink = await f.speaker(1); await healthySink.report({ receiverId: token(healthy), epoch: 0, state: "ready" });
    await until(() => healthySink.frames > 10);
    const newer = await f.control(); await until(() => !!newer.instruction?.receiverId && newer.instruction.listen);
    assert.notEqual(token(newer), oldToken);
    prep.finish(); await pending; await prep.flush();
    await oldSink.report({ receiverId: oldToken, epoch: 1, state: "failed", error: "Old tab failed" });
    const before = healthySink.frames; await until(() => healthySink.frames > before + 10);
    assert.equal(oldSink.frames, 0); assert.equal(oldSink.starts, 0);
    assert.equal(newer.output?.audioAdmission?.state, "preparing"); assert.equal(newer.output?.error, undefined);
    const replacement = await f.speaker(); await replacement.report({ receiverId: token(newer), epoch: 0, state: "ready" });
    await until(() => replacement.frames > 10 && newer.output?.audioAdmission?.state === "ready");
  } finally { await f.close(); }
});

test("a late old-token Noise reconnect cannot displace the newest ready tab or poison its errors", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const old = await f.control(); await f.publish(); await f.join(old);
    const retiredToken = token(old), initial = await f.speaker(); await initial.report({ receiverId: retiredToken, epoch: 0, state: "ready" });
    await until(() => initial.frames > 10);
    const newer = await f.control(); await until(() => newer.instruction?.listen === true);
    const current = await f.speaker(); await current.report({ receiverId: token(newer), epoch: 0, state: "ready" });
    await until(() => current.frames > 10 && newer.output?.audioAdmission?.state === "ready");
    const stale = await f.speaker();
    await stale.report({ receiverId: retiredToken, epoch: 1, state: "ready" });
    await stale.report({ receiverId: retiredToken, epoch: 2, state: "failed", error: "Retired receiver failure" });
    const before = current.frames; await until(() => current.frames > before + 10, "the newest matching receiver must keep receiving");
    assert.equal(stale.frames, 0); assert.equal(stale.starts, 0);
    assert.equal(newer.output?.audioAdmission?.state, "ready"); assert.equal(newer.output?.error, undefined);
  } finally { await f.close(); }
});

test("Leave and rejoin rotate only the listening token; a continuously listening output reuses readiness for another Live source", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const listener = await f.control(); await f.publish(); await f.join(listener);
    const firstToken = token(listener), sink = await f.speaker(); await sink.report({ receiverId: firstToken, epoch: 0, state: "ready" });
    await until(() => sink.frames > 10);
    const firstPlayback = listener.state.player.playbackId!;
    const transferStart = listener.messages.length;
    const secondPublisher = await f.control(-1);
    await f.publish("second", "live", secondPublisher);
    assert.ok(listener.state.liveSources?.some(source => source.id === "stage"), "the first publication must remain live during the transfer");
    await f.join(listener, "second");
    assert.ok(token(listener) === firstToken, "Live source transfer must retain the current listening token");
    assert.ok(listener.messages.slice(transferStart).filter(message => message.type === "sendspin").every(message => message.listen && message.intent === "live" && message.receiverId === firstToken), "a source transfer must not briefly retire output preparation");
    const before = sink.frames; await until(() => sink.frames > before + 10 && listener.output?.audioAdmission?.state === "ready");
    assert.equal(token(listener), firstToken, "same format/output/server clock needs no source-scoped re-preparation");
    assert.notEqual(listener.state.player.playbackId, firstPlayback);
    assert.equal((await listener.command({ type: "leave", playbackId: listener.state.player.playbackId! })).ok, true);
    await until(() => listener.instruction?.listen === false);
    assert.equal(listener.instruction?.receiverId, undefined);
    await f.join(listener, "second"); const nextToken = token(listener); assert.notEqual(nextToken, firstToken);
    await sink.report({ receiverId: firstToken, epoch: 10, state: "ready" });
    await until(() => listener.output?.audioAdmission?.state === "preparing");
    await sink.report({ receiverId: nextToken, epoch: 0, state: "ready" });
    await until(() => listener.output?.audioAdmission?.state === "ready");
  } finally { await f.close(); }
});

test("modern explicit membership withholds absent reports while legacy declarations keep numeric admission", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const modern = await f.control(); await f.publish(); await f.join(modern);
    const sink = await f.speaker(); await sink.report();
    await until(() => modern.output?.audioAdmission?.state === "preparing");
    assert.equal(sink.starts, 0); assert.equal(sink.frames, 0); assert.equal(modern.output?.error, undefined);
    // Only exact capability version 1 opts in. Absent and unsupported flags retain old support.
    for (const flag of [null, "true"]) {
      const legacy = await f.control(0, flag); await until(() => legacy.instruction?.listen === true);
      assert.equal(legacy.instruction?.receiverId, undefined);
      const before = sink.frames; await sink.report(); await until(() => sink.frames > before + 10);
      assert.equal(legacy.output?.error, undefined);
      // No measured headroom can reach the whole 100 ms lead.
      await sink.report(undefined, 100);
      await until(() => !!legacy.output?.error);
      assert.match(legacy.output!.error!, /deadline|requires/i, "legacy real numeric incompatibility remains refused");
      await sink.report(); await until(() => !legacy.output?.error);
    }
  } finally { await f.close(); }
});

test("control disconnect and device revocation retire receiver authority without stopping a healthy listener", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const listener = await f.control(), healthy = await f.control(1); await f.publish(); await f.join(listener); await f.join(healthy);
    const sink = await f.speaker(), other = await f.speaker(1), retired = token(listener);
    await sink.report({ receiverId: retired, epoch: 0, state: "ready" }); await other.report({ receiverId: token(healthy), epoch: 0, state: "ready" });
    await until(() => sink.frames > 10 && other.frames > 10);
    listener.socket.terminate(); await until(() => healthy.state.devices?.find(device => device.id === listener.id)?.online === false);
    assert.equal(outputIn(healthy, listener.id)?.sound, true, "disconnect preserves selected output for reconnect");
    const stoppedAt = sink.frames, before = other.frames;
    await sink.report({ receiverId: retired, epoch: 1, state: "ready" }); await until(() => other.frames > before + 10);
    assert.equal(sink.frames, stoppedAt, "a still-open Noise socket cannot restore disconnected control membership");
    const replacement = await f.control(); await until(() => replacement.instruction?.listen === true);
    assert.notEqual(token(replacement), retired);
    await sink.report({ receiverId: token(replacement), epoch: 0, state: "ready" });
    await until(() => replacement.output?.audioAdmission?.state === "ready");
    assert.equal((await f.api(`/api/devices/${listener.id}`, "DELETE")).status, 200);
    await until(() => !healthy.state.devices?.some(device => device.id === listener.id));
    const count = other.frames; await until(() => other.frames > count + 10);
    assert.equal(outputIn(healthy, listener.id), undefined); assert.equal(healthy.output?.audioAdmission?.state, "ready");
  } finally { await f.close(); }
});

test("preparation capability grants no consent and consent withdrawal retires the listening token", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const listener = await f.control(), healthy = await f.control(1); await f.publish(); await f.join(healthy);
    const request = { type: "playLive", sourceId: "stage", deviceId: listener.id, picture: false, sound: true } as const;
    assert.equal((await f.host.command(request)).ok, false, "declaring preparation support grants no private output rights");
    assert.equal(listener.instruction?.receiverId, undefined);
    assert.equal((await listener.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    const admitted = await f.host.command(request); assert.equal(admitted.ok, true, admitted.error);
    await until(() => listener.instruction?.listen === true);
    const retired = token(listener), sink = await f.speaker(), other = await f.speaker(1);
    await sink.report({ receiverId: retired, epoch: 0, state: "ready" }); await other.report({ receiverId: token(healthy), epoch: 0, state: "ready" });
    await until(() => sink.frames > 10 && other.frames > 10);
    assert.equal((await listener.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
    await until(() => listener.instruction?.listen === false);
    const stopped = sink.frames, before = other.frames; await until(() => other.frames > before + 10);
    assert.equal(sink.frames, stopped); assert.equal(listener.instruction?.receiverId, undefined);
    await f.join(listener); assert.notEqual(token(listener), retired, "a private self-join starts a fresh listening lifetime");
    await sink.report({ receiverId: token(listener), epoch: 0, state: "ready" });
    await until(() => listener.output?.audioAdmission?.state === "ready");
  } finally { await f.close(); }
});

test("a current preparation failure is actionable, while real source failure stays visible during preparation", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    const listener = await f.control(); const source = await f.publish(); await f.join(listener);
    const sink = await f.speaker();
    await sink.report({ receiverId: token(listener), epoch: 0, state: "failed", error: "The audio output timestamp is unavailable" });
    await until(() => listener.output?.audioAdmission?.state === "failed");
    assert.match(listener.output?.error ?? "", /timestamp/);
    await sink.report({ receiverId: token(listener), epoch: 1, state: "preparing" }, 1000);
    await until(() => listener.output?.audioAdmission?.state === "preparing" && !listener.output.error);
    source.upload.send(JSON.stringify({ type: "start", generation: "invalid-second-start", offsetUs: 0, rttUs: 0 }));
    await until(() => !!listener.output?.error);
    assert.match(listener.output!.error!, /capture clock/i, "pending output readiness cannot hide the genuine capture failure");
    assert.equal(listener.output?.audioAdmission?.state, "preparing");
    const sourceError = listener.output!.error;
    await sink.report({ receiverId: token(listener), epoch: 2, state: "failed", error: "The replacement output timestamp is unavailable" });
    await until(() => listener.output?.audioAdmission?.state === "failed");
    assert.equal(listener.output?.error, sourceError, "a terminal receiver failure cannot hide the registered capture failure either");
  } finally { await f.close(); }
});


test("a real group failure precedes terminal or pending admission while a current terminal alone stays actionable", { timeout: 15000 }, async () => {
  const f = await fixture({ overflow: true });
  try {
    const listener = await f.control(); await f.publish(); await f.join(listener);
    const sink = await f.speaker(), receiverId = token(listener);
    await sink.report({ receiverId, epoch: 0, state: "failed", error: "The output timestamp is unavailable" });
    await until(() => listener.state.player.status === "playing" && listener.output?.audioAdmission?.state === "failed");
    const terminal = listener.output!.audioAdmission!;
    assert.ok(terminal.state === "failed");
    assert.equal(listener.state.player.error, null);
    assert.equal(listener.output?.error, terminal.error, "a current receiver failure is actionable when the group has no failure");
    const controls = listener.state.controls;

    f.overflowCapture();
    const groupError = "Captured audio exceeded its bounded queue.";
    await until(() => listener.state.player.status === "error" && listener.state.player.error === groupError);
    assert.deepEqual(listener.output?.audioAdmission, terminal, "the genuine group failure must coexist with the current terminal verdict");
    assert.equal(listener.output?.error, groupError, "the source/group failure must precede receiver admission in the actual public output projection");
    assert.equal(outputIn(f.host, listener.id)?.error, groupError, "remote output summaries preserve the same failure provenance");
    assert.deepEqual(listener.state.controls, controls, "error presentation cannot grant programme controls");

    await sink.report({ receiverId, epoch: 1, state: "preparing" }, 1000);
    await until(() => listener.output?.audioAdmission?.state === "preparing");
    assert.equal(listener.output?.error, groupError, "renewed output preparation must not hide a current group failure");
    await sink.report({ receiverId, epoch: 2, state: "failed", error: "The replacement output is unavailable" });
    await until(() => listener.output?.audioAdmission?.state === "failed");
    assert.equal(listener.output?.error, groupError, "a later current terminal verdict must not replace the genuine group failure");
  } finally { await f.close(); }
});
