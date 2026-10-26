import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { AudioCodec, Identity, Roles, SendspinClient, serverNowUs } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../src/server/sendspin";

test("the worker admits each Live receiver against the headroom its publication's frozen lead leaves", { timeout: 8000 }, async t => {
  const key = Identity.generate();
  const core = createSendspin({ identity: Identity.generate().privateB64u, name: "Source budget", admit: id => id === key.peerId, changed() {}, ffmpeg: async () => process.env.COUCH_TEST_FFMPEG ?? "ffmpeg" });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => core.upgrade(request, socket as import("node:net").Socket, head));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new SendspinClient(key.peerId, "Receiver", [Roles.PLAYER], { encryption: { identity: key }, playerSupport: {
    supported_formats: [{ codec: AudioCodec.OPUS, sample_rate: 48000, channels: 2, bit_depth: 16 }], buffer_capacity: 128 * 1024, supported_commands: [],
  } });
  const group = core.group("programme", () => {});
  let timer: ReturnType<typeof setInterval> | undefined;
  t.after(async () => { clearInterval(timer); group.close(); core.close(); await client.disconnect(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const until = async (predicate: () => boolean) => { const deadline = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < deadline, "Receiver admission did not settle"); await new Promise(resolve => setTimeout(resolve, 10)); } };
  await client.connect(`ws://127.0.0.1:${(server.address() as { port: number }).port}/sendspin`, { timeoutMs: 3000 });
  await client.sendPlayerState({ required_lead_time_ms: 110, min_buffer_ms: 110, static_delay_ms: 0 });
  const policy = { intent: "live" as const, liveAudioLeadMs: 150 };
  core.registerSource("longer", policy);
  policy.liveAudioLeadMs = 100;
  core.registerSource("default", { intent: "live" });
  // Real-time capture on both sources: their budgets are measured, not configured.
  let sequence = 0; const origin = serverNowUs();
  timer = setInterval(() => {
    for (const id of ["longer", "default"]) core.writeSource(id, { generation: id, sequence, samplePosition: sequence * 480, capturedAtUs: origin + sequence * 10000, sampleRate: 48000, channels: 2, pcm: new Float32Array(960) });
    sequence++;
  }, 10);
  group.members([{ deviceId: key.peerId, level: 100 }]);
  const load = (liveSourceId: string) => group.send({ type: "load", playbackId: liveSourceId, source: "", live: true, intent: "live", liveSourceId });
  load("longer");
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  assert.equal(core.receiverError(key.peerId), undefined);
  load("default");
  await until(() => core.receiverAdmission(key.peerId)?.state === "failed");
  const allowed = Number(/allows (\d+) ms/.exec(core.receiverError(key.peerId)!)?.[1]);
  assert.ok(allowed < 100 && allowed >= 50, `measured ${allowed} ms of the default 100 ms lead`);
  load("longer");
  await until(() => core.receiverAdmission(key.peerId)?.state === "ready");
  assert.equal(core.receiverError(key.peerId), undefined, "A rejected source must not poison another source's budget");
});
