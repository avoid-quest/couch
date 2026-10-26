import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";
import { openStore } from "../src/server/store";

// Real-time capture on every registered source: budgets are measured, not configured.
async function fixture(t: TestContext) {
  const key = Identity.generate();
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Source budget", admit: id => id === key.peerId, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => core.upgrade(request, socket as import("node:net").Socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER], { encryption: { identity: key }, playerSupport: {
    supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [],
  } });
  const group = core.group("programme", () => {});
  const sources = new Map<string, { origin: number; sequence: number }>();
  const capturing = { add: (id: string) => sources.set(id, { origin: serverNowUs(), sequence: 0 }) };
  const timer = setInterval(() => {
    for (const [id, source] of sources) {
      const sequence = source.sequence++;
      core.writeSource(id, { generation: id, sequence, samplePosition: sequence * 480, capturedAtUs: source.origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
    }
  }, 10);
  t.after(async () => { clearInterval(timer); group.close(); core.close(); await client.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const until = async (predicate: () => boolean) => { const deadline = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < deadline, "Receiver admission did not settle"); await new Promise(resolve => setTimeout(resolve, 10)); } };
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}/sendspin`, { timeoutMs: 3000 });
  group.members([{ deviceId: key.peerId, level: 100 }]);
  const load = (liveSourceId: string) => group.send({ type: "load", playbackId: liveSourceId, source: "", live: true, intent: "live", liveSourceId });
  const allowed = () => Number(/allows (\d+) ms/.exec(core.receiverError(key.peerId) ?? "")?.[1]);
  return { key, core, client, until, load, capturing, allowed };
}

test("the worker admits each Live receiver against the headroom its publication's frozen lead leaves", { timeout: 8000 }, async t => {
  const { key, core, client, until, load, capturing, allowed } = await fixture(t);
  await client.sendPlayerState({ required_lead_time_ms: 110, min_buffer_ms: 110, static_delay_ms: 0 });
  const policy = { intent: "live" as const, liveAudioLeadMs: 150 };
  core.registerSource("longer", policy);
  policy.liveAudioLeadMs = 100;
  core.registerSource("default", { intent: "live" });
  capturing.add("longer"); capturing.add("default");
  load("longer");
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  assert.equal(core.receiverError(key.peerId), undefined);
  load("default");
  await until(() => core.receiverAdmission(key.peerId)?.state === "failed");
  assert.ok(allowed() < 100 && allowed() >= 50, `measured ${allowed()} ms of the default 100 ms lead`);
  load("longer");
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  assert.equal(core.receiverError(key.peerId), undefined, "A rejected source must not poison another source's budget");
});

test("a 45 ms publication keeps its frozen lead's measured headroom after settings and policy changes", { timeout: 8000 }, async t => {
  const { key, core, client, until, load, capturing, allowed } = await fixture(t);
  const store = openStore(":memory:");
  t.after(() => store.close());
  assert.throws(() => core.registerSource("unsupported", { intent: "live", liveAudioLeadMs: 44 }), /supported live audio scheduling lead/);
  assert.equal(core.hasSource("unsupported"), false);
  store.saveLiveAudioLeadMs(45);
  const policy = { intent: "live" as const, liveAudioLeadMs: store.liveAudioLeadMs() };
  core.registerSource("short", policy);
  policy.liveAudioLeadMs = 250;
  store.saveLiveAudioLeadMs(100);
  core.registerSource("short", { intent: "live", liveAudioLeadMs: store.liveAudioLeadMs() });
  core.registerSource("next", { intent: "live", liveAudioLeadMs: store.liveAudioLeadMs() });
  capturing.add("short"); capturing.add("next");
  await client.sendPlayerState({ required_lead_time_ms: 45, min_buffer_ms: 20, static_delay_ms: 0 });
  load("short");
  await until(() => core.receiverAdmission(key.peerId)?.state === "failed");
  const measured = allowed();
  assert.ok(measured < 45 && measured > 10, `measured ${measured} ms of the frozen 45 ms lead`);
  load("next");
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  load("short");
  await until(() => core.receiverAdmission(key.peerId)?.state === "failed");
  assert.ok(allowed() < 45, "Later settings must not lengthen the frozen publication's deadline");
  await client.sendPlayerState({ required_lead_time_ms: measured - 8, min_buffer_ms: 1, static_delay_ms: 0 });
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  assert.equal(core.receiverError(key.peerId), undefined);
  await until(() => { try { core.validateDelay(key.peerId, 2, "live"); return true; } catch { return false; } });
  assert.throws(() => core.validateDelay(key.peerId, 20, "live"), /exceeds the remaining live audio deadline/);
});
