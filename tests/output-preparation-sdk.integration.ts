import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { AudioCodec, Roles, SendspinClient } from "@sonn-audio/node-sendspin";
import { SendspinPlayer } from "@sendspin/sendspin-js";
import { Identity, SENTINEL_RESOLVED, SendspinCore, type OutputPreparation, type SendspinSession } from "@sonn-audio/node-sendspin";

const until = async (check: () => boolean) => {
  const end = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < end, "SDK state did not arrive"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("public preparation setter is atomic and reconnect withdraws ready before initial state", { timeout: 10000 }, async t => {
  const core = new SendspinCore(), server = createServer(), websocket = new WebSocketServer({ server });
  core.configureServer({ name: "Preparation fixture" });
  const reports: { session: SendspinSession; preparation?: OutputPreparation; lead?: number; min?: number }[] = [];
  const snapshot = (session: SendspinSession) => reports.push({ session, preparation: session.getOutputPreparation(), lead: session.getPlayerTiming().requiredLeadTimeMs, min: session.getPlayerTiming().minBufferMs });
  core.enableEncryption(Identity.generate(), id => { core.registerHooks(id, { onIdentified: snapshot, onPlayerState: snapshot }); return SENTINEL_RESOLVED; });
  websocket.on("connection", (socket, request) => {
    core.handleConnection(socket, request);
    core.getSessionBySocket(socket)!.setHooks({ onIdentified: snapshot, onPlayerState: snapshot });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const receiverId = randomUUID(), connections: boolean[] = []; let epoch = 0;
  const player = new SendspinPlayer({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, storage: null, suite: "aesgcm", outputMode: "direct", reconnect: { maxAttempts: 0 },
    requiredLeadTimeMs: 1000, minBufferMs: 250,
    onConnectionChange(connected) {
      connections.push(connected);
      if (!connected) assert.equal(player.timeSyncInfo.synced, false, "a modern receiver must reacquire the transport clock");
      player.setOutputPreparation({ receiverId, epoch: ++epoch, state: "preparing" });
    },
  });
  t.after(async () => { t.diagnostic(JSON.stringify({ connections, reports: reports.map(({ session, ...report }) => report), sessions: [...core.getSessions()].map(session => ({ info: session.getInfo(), preparation: session.getOutputPreparation(), timing: session.getPlayerTiming(), hooks: session.hasHooksAttached() })) })); player.disconnect("user_request"); for (const socket of websocket.clients) socket.terminate(); websocket.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await player.connect(); await until(() => reports.some(report => report.preparation?.state === "preparing"));
  const firstSession = reports.at(-1)!.session;
  player.setOutputPreparation({ receiverId, epoch, state: "ready" }, { requiredLeadTimeMs: 25, minBufferMs: 25 });
  await until(() => reports.some(report => report.preparation?.state === "ready"));
  for (const report of reports.filter(report => report.preparation?.state === "ready")) { assert.equal(report.lead, 25); assert.equal(report.min, 25); }
  assert.throws(() => player.setOutputPreparation({ receiverId, epoch, state: "ready" }), /atomic timing/);
  assert.throws(() => player.setOutputPreparation({ receiverId, epoch, state: "ready" }, { requiredLeadTimeMs: NaN, minBufferMs: 25 }), /timing/);
  await until(() => player.timeSyncInfo.synced);
  for (const socket of websocket.clients) socket.terminate(); // Actual unexpected transport loss.
  await until(() => connections.includes(false));
  await player.connect(); await until(() => reports.some(report => report.session !== firstSession && report.preparation));
  const replacement = reports.filter(report => report.session !== firstSession);
  assert.ok(replacement.every(report => report.preparation?.state === "preparing"), "old ready cannot be replayed on the new transport");
  assert.ok(replacement.every(report => report.preparation!.epoch > 1));
  assert.deepEqual(connections.slice(0, 3), [true, false, true]);
  player.setOutputPreparation({ receiverId, epoch, state: "ready" }, { requiredLeadTimeMs: 25, minBufferMs: 25 });
  await until(() => reports.some(report => report.session !== firstSession && report.preparation?.state === "ready"));
});

test("server retains same-session preparation across deltas and rejects stale epoch timing atomically", { timeout: 10000 }, async t => {
  const core = new SendspinCore(), server = createServer(), websocket = new WebSocketServer({ server });
  core.configureServer({ name: "Epoch fixture" });
  const reports: { preparation?: OutputPreparation; lead?: number; min?: number }[] = [];
  let session: SendspinSession | undefined;
  const snapshot = (current: SendspinSession) => { session = current; reports.push({ preparation: current.getOutputPreparation(), lead: current.getPlayerTiming().requiredLeadTimeMs, min: current.getPlayerTiming().minBufferMs }); };
  core.enableEncryption(Identity.generate(), id => { core.registerHooks(id, { onIdentified: snapshot, onPlayerState: snapshot }); return SENTINEL_RESOLVED; });
  websocket.on("connection", (socket, request) => { core.handleConnection(socket, request); core.getSessionBySocket(socket)!.setHooks({ onIdentified: snapshot, onPlayerState: snapshot }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const identity = Identity.generate(), receiverId = randomUUID();
  const client = new SendspinClient(identity.peerId, "Epoch receiver", [Roles.PLAYER], { encryption: { identity }, playerSupport: { supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 4096, supported_commands: [] } });
  t.after(async () => { await client.disconnect(); for (const socket of websocket.clients) socket.terminate(); websocket.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}`);
  await client.sendPlayerState({ required_lead_time_ms: 1000, min_buffer_ms: 250, couch_preparation: { receiverId, epoch: 2, state: "preparing" } });
  await until(() => session?.getOutputPreparation()?.epoch === 2);
  await client.sendPlayerState({ volume: 42 });
  await client.sendPlayerState({ required_lead_time_ms: 25, min_buffer_ms: 25, couch_preparation: { receiverId, epoch: 2, state: "ready" } });
  await until(() => session?.getOutputPreparation()?.state === "ready");
  const before = reports.length;
  await client.sendPlayerState({ required_lead_time_ms: 1000, min_buffer_ms: 250, couch_preparation: { receiverId, epoch: 1, state: "failed", error: "obsolete" } });
  await client.sendPlayerState({ volume: 43 }); // Ordered same-socket barrier after stale report.
  await until(() => reports.length > before);
  assert.deepEqual(reports.at(-1), { preparation: { receiverId, epoch: 2, state: "ready" }, lead: 25, min: 25 });
  for (const report of reports.filter(report => report.preparation?.state === "ready")) { assert.equal(report.lead, 25); assert.equal(report.min, 25); }
  const exposed = session!.getOutputPreparation()!; exposed.epoch = 100;
  assert.equal(session!.getOutputPreparation()!.epoch, 2, "public accessor cannot mutate retained session state");
});
