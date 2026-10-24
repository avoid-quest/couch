import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as tcpServer, connect, type Socket } from "node:net";
import { WebSocket } from "ws";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs, beginClientHandshake, type NoiseTransport } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check: () => boolean, message: string) => { const deadline = Date.now() + 5000; while (!check()) { if (Date.now() > deadline) throw new Error(message); await sleep(10); } };
const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";

test("malformed frames before and after admission isolate the socket while healthy Opus continues", { timeout: 25000 }, async t => {
  const identity = Identity.generate(), badIdentity = Identity.generate(), errors: string[] = [];
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Isolation fixture", admit: id => [identity.peerId, badIdentity.peerId].includes(id), changed() {}, ffmpeg: async () => ffmpeg, sourceFailed: (_id, error) => errors.push(error) });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => core.upgrade(request, socket as Socket, head));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port, url = `ws://127.0.0.1:${port}`;
  const clients: SendspinClient[] = [];
  const receiver = async (key: Identity, address = url) => {
    const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER], { encryption: { identity: key }, playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [] } });
    clients.push(client); await client.connect(address, { timeoutMs: 3000 });
    await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 });
    return client;
  };
  const healthy = await receiver(identity), frames: number[] = [];
  healthy.addAudioChunkListener(timestamp => frames.push(timestamp));
  const group = core.group("healthy", () => {});
  core.registerSource("source", { intent: "live" }); group.members([{ deviceId: identity.peerId, level: 100 }]);
  group.send({ type: "load", playbackId: "healthy", source: "", liveSourceId: "source", live: true, intent: "live" });
  let sequence = 0; const origin = serverNowUs();
  const timer = setInterval(() => {
    while (sequence < Math.floor((serverNowUs() - origin) / 10000)) {
      core.writeSource("source", { generation: "capture", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }); sequence++;
    }
  }, 5);
  const proxies: ReturnType<typeof tcpServer>[] = [], sockets: Socket[] = [];
  t.after(async () => {
    clearInterval(timer); group.close(); core.endSource("source"); core.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all(clients.map(client => client.disconnect()));
    await Promise.all(proxies.map(proxy => new Promise<void>(resolve => proxy.close(() => resolve()))));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  await until(() => frames.length >= 10, "healthy receiver did not start");
  const checkHealthy = async (before: number) => {
    await until(() => frames.length >= before + 10 || !!core.sourceError("source"), "healthy packets stopped");
    assert.deepEqual(errors, []); assert.equal(core.sourceError("source"), undefined); assert.ok(healthy.isConnected);
    assert.ok(frames.length >= before + 10);
  };
  for (const malformed of [false, true]) {
    const socket = new WebSocket(url); socket.on("error", () => {}); await once(socket, "open");
    const closed = once(socket, "close"), before = frames.length;
    if (malformed) socket.send("unmasked", { mask: false });
    else socket.send("x".repeat(65537));
    await closed; await checkHealthy(before);
  }
  // A transparent TCP relay injects parser-invalid frames after a real encrypted
  // handshake without reading SDK-private sockets (Noise fragments large sends).
  for (const invalidOpcode of [false, true]) {
    let upstream: Socket | undefined;
    const proxy = tcpServer(socket => {
      const target = upstream = connect(port, "127.0.0.1"); sockets.push(socket, target);
      socket.on("error", () => target.destroy()); target.on("error", () => socket.destroy());
      socket.once("close", () => target.destroy()); target.once("close", () => socket.destroy());
      socket.pipe(target).pipe(socket);
    }); proxies.push(proxy);
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const bad = await receiver(badIdentity, `ws://127.0.0.1:${(proxy.address() as { port: number }).port}`);
    let disconnected = false; bad.addDisconnectListener(() => { disconnected = true; });
    const before = frames.length;
    if (invalidOpcode) upstream!.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
    else {
      const header = Buffer.alloc(14); header[0] = 0x82; header[1] = 0xff; header.writeBigUInt64BE(65537n, 2);
      upstream!.write(Buffer.concat([header, Buffer.alloc(65537)]));
    }
    await until(() => disconnected, "malformed admitted receiver was not disconnected"); await checkHealthy(before);
  }
  // Valid WebSocket frames and valid Noise encryption do not imply valid JSON
  // protocol messages. Exercise the exported handshake, never private SDK fields.
  const hello = { type: "client/hello", payload: { name: "Protocol fixture", supported_roles: ["player@v1"], "player@v1_support": { supported_formats: [{ codec: "opus", sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 131072, supported_commands: [] } } };
  const state = { type: "client/state", payload: { player: { required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 } } };
  const applicationCases: { name: string; text: string; beforeHello?: boolean; valid?: boolean }[] = [
    { name: "null before hello", text: "null", beforeHello: true },
    { name: "missing hello payload", text: '{"type":"client/hello"}', beforeHello: true },
    // Nested SDK validation currently throws on this shape: the connection
    // callback's exception boundary must contain it even beyond envelope checks.
    { name: "throwing hello handler", text: JSON.stringify({ ...hello, payload: { ...hello.payload, "player@v1_support": { supported_formats: [], supported_commands: {} } } }), beforeHello: true },
    { name: "array envelope", text: "[]" },
    { name: "primitive envelope", text: '"invalid"' },
    { name: "invalid JSON", text: "{" },
    { name: "non-string type", text: '{"type":42,"payload":{}}' },
    ...["client/state", "client/time", "client/command", "client/goodbye", "client_stream/start", "stream/request-format"].map(type => ({ name: `${type} missing payload`, text: JSON.stringify({ type }) })),
    ...[null, [], 42, "invalid"].map(payload => ({ name: `state payload ${JSON.stringify(payload)}`, text: JSON.stringify({ type: "client/state", payload }) })),
    { name: "nested state shape", text: '{"type":"client/state","payload":{"player":[]}}' },
    { name: "valid extension and clock", text: '{"type":"future/extension","payload":{}}', valid: true },
  ];
  for (const sample of applicationCases) {
    const socket = new WebSocket(url); socket.on("error", () => {});
    const handshake = beginClientHandshake({ identity: badIdentity, suite: "25519_AESGCM_SHA256" });
    let transport: NoiseTransport | undefined, sent = false, clockReply = false, closed = false;
    socket.once("close", () => { closed = true; });
    const send = (text: string) => { for (const frame of transport!.encodeText(text)) socket.send(frame); };
    socket.on("message", (data, binary) => { void (async () => {
      if (!binary) {
        const message = JSON.parse(String(data));
        if (message.type === "server/init") handshake.onServerInit(String(data));
        else if (message.type === "noise/handshake") { const next = await handshake.onMessage1(String(data)); transport = next.result.transport; socket.send(next.send); }
        return;
      }
      const decoded = transport?.decode(Buffer.from(data as Buffer));
      if (decoded?.kind !== "text") return;
      if (!sent) {
        sent = true;
        if (!sample.beforeHello) { send(JSON.stringify(hello)); send(JSON.stringify(state)); }
        send(sample.text);
        if (sample.valid) { send('{"type":"client_stream/end"}'); send('{"type":"client/time","payload":{"client_transmitted":123}}'); }
      }
      if (JSON.parse(decoded.data).type === "server/time") clockReply = true;
    })().catch(() => socket.terminate()); });
    try {
      await once(socket, "open"); const before = frames.length; socket.send(handshake.clientInit);
      await until(() => sample.valid ? clockReply || closed : closed, sample.name + " did not finish");
      assert.equal(sent, true, sample.name + " reached encrypted application dispatch");
      if (sample.valid) { assert.equal(closed, false); assert.equal(clockReply, true, "valid traffic still answers"); }
      await checkHealthy(before);
    } finally { socket.terminate(); }
  }
  for (const at of frames) assert.equal((at - frames[0]!) % 10000, 0, "unhealthy receiver must not retime the audience");
});

test("live correction validation follows increased and decreased required lead while admitted", { timeout: 8000 }, async t => {
  const identity = Identity.generate(); let changes = 0, saves = 0;
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Timing fixture", admit: id => id === identity.peerId, changed() { changes++; }, saveDelay() { saves++; }, ffmpeg: async () => ffmpeg });
  const server = createServer(); server.on("upgrade", (request, socket, head) => core.upgrade(request, socket as Socket, head));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new SendspinClient(identity.peerId, "Receiver", [Roles.PLAYER], { encryption: { identity }, playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [] } });
  const group = core.group("timing", () => {});
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); core.close(); await client.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`, { timeoutMs: 3000 });
  await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 });
  const permits40 = () => { try { core.validateDelay(identity.peerId, 40, "live"); return true; } catch { return false; } };
  await until(permits40, "initial timing not reported");
  core.registerSource("timing", { intent: "live" }); group.members([{ deviceId: identity.peerId, level: 100 }]);
  group.send({ type: "load", playbackId: "timing", source: "", live: true, liveSourceId: "timing", intent: "live" });
  let received = 0, sequence = 0; const origin = serverNowUs();
  client.addAudioChunkListener(() => received++);
  timer = setInterval(() => {
    core.writeSource("timing", { generation: "timing", sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) }); sequence++;
  }, 10);
  await until(() => received >= 10, "receiver was not playing before timing update");
  const saved = saves, previous = changes;
  await client.sendPlayerState({ required_lead_time_ms: 60, min_buffer_ms: 25, static_delay_ms: 0 });
  await until(() => !permits40(), "increased lead did not withdraw invalid correction");
  assert.ok(changes > previous); assert.equal(saves, saved, "timing-only updates must not persist unchanged delay");
  assert.doesNotThrow(() => core.validateDelay(identity.peerId, 10, "live"));
  await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, static_delay_ms: 0 });
  await until(permits40, "decreased lead did not restore valid correction");
});
