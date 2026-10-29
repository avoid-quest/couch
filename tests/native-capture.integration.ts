import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { WebSocketServer } from "ws";
import { serverNowUs } from "@sonn-audio/node-sendspin";
import { prepareNativeCapture } from "../app/native-capture";
import { nativeAudioInput } from "../app/native-audio-input";
import { acceptCaptureUpload } from "../src/server/capture-ingest";
import type { CaptureAudioPacket } from "../src/server/capture-audio";
import { liveFixture, until } from "./live-input.fixture";
import { helper as mediaHelper, startHelpers } from "../src/server/helpers";

const requested = { sampleRate: 48000, requestedCallbackFrames: 128 } as const;
const helper = (mode: string) => spawn(process.execPath, [resolve("tests/fixtures/native-capture-helper.mjs"), mode], { stdio: ["pipe", "pipe", "pipe"] });
const waitFor = async (predicate: () => boolean) => {
  const deadline = performance.now() + 1500;
  while (!predicate()) { assert.ok(performance.now() < deadline, "bounded condition wait"); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("native upload passes the real Hub origin and publication checks", { timeout: 15_000 }, async t => {
  const f = await liveFixture();
  t.after(() => f.close());
  startHelpers(join(dirname(f.databasePath), "helpers"));
  await Promise.allSettled([mediaHelper("ffmpeg"), mediaHelper("qjs"), mediaHelper("yt-dlp")]);
  const host = await f.connect(-1);
  assert.equal((await host.command({ type: "publishLive", sourceId: "native-input", uploadToken: f.uploadToken,
    kind: "microphone", audio: true, video: false, intent: "live", audioDelivery: "pcm" })).ok, true);
  await until(() => host.messages.some(message => message.type === "livePeers" && message.upload));
  const demand = host.messages.findLast(message => message.type === "livePeers" && message.upload);
  assert.ok(demand?.type === "livePeers" && demand.uploadId);
  const url = `${f.uploadUrl("native-input", f.uploadToken, -1)}&uploadId=${demand.uploadId}`;
  const events: Record<string, unknown>[] = [], errors: Error[] = [];
  const capture = await prepareNativeCapture(helper("ordered"), requested, error => errors.push(error), event => events.push(event));
  t.after(() => capture.stop());
  await capture.upload(url);
  assert.ok(events.some(event => event.event === "started"), "Hub accepts origin, owner and upload generation before capture starts");
  assert.ok(events.some(event => event.event === "upload-clock"));
  assert.deepEqual(errors, []);
  await capture.stop();
  assert.equal((await host.command({ type: "endLive", sourceId: "native-input" })).ok, true);
  const revokedEvents: Record<string, unknown>[] = [];
  const revoked = await prepareNativeCapture(helper("ordered"), requested, () => {}, event => revokedEvents.push(event));
  t.after(() => revoked.stop());
  await assert.rejects(revoked.upload(url));
  await revoked.closed;
  assert.equal(revokedEvents.some(event => event.event === "started"), false, "an origin header does not bypass publication authorization");
});

for (const mode of ["ordered", "mono", "duplicate", "revoked"] as const) {
  test(`native PCM reaches the real Core ingest: ${mode}`, { timeout: 6000 }, async t => {
    const server = createServer(), sockets = new WebSocketServer({ server });
    const packets: CaptureAudioPacket[] = [], errors: Error[] = [], ingestErrors: string[] = [];
    sockets.on("connection", socket => acceptCaptureUpload(socket, packet => {
      if (mode === "revoked") return false;
      packets.push(packet); return true;
    }, error => ingestErrors.push(error)));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(async () => { for (const socket of sockets.clients) socket.terminate(); await new Promise<void>(resolve => sockets.close(() => server.close(() => resolve()))); });
    const child = helper(mode), events: Record<string, unknown>[] = [];
    const capture = await prepareNativeCapture(child, { ...requested, channelMap: mode === "mono" ? [1] : [0, 1] }, error => errors.push(error), event => events.push(event));
    t.after(() => capture.stop());
    assert.equal(capture.format.ownerHalBufferFrames, 256, "actual readback stays distinct from requested128");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const clock = await capture.upload(`ws://127.0.0.1:${address.port}/api/live/upload`);
    assert.ok(clock.rttUs >= 0 && clock.rttUs < 100_000);
    assert.ok(clock.offsetUs < -900_000_000_000, "native epoch is mapped explicitly, never assumed to be JS time");
    if (mode === "ordered" || mode === "mono") {
      await waitFor(() => packets.length === 6);
      assert.deepEqual(packets.map(p => p.sequence), [0, 1, 2, 3, 4, 5]);
      assert.deepEqual(packets.map(p => p.samplePosition), [0, 128, 256, 384, 512, 640]);
      for (const [i, packet] of packets.entries()) {
        assert.ok(Math.abs(serverNowUs() - packet.capturedAtUs) < 100_000);
        assert.equal(packet.channels, mode === "mono" ? 1 : 2);
        for (let f = 0; f < 128; f++) {
          if (mode === "mono") assert.equal(packet.pcm[f], -(i + 1) / 32);
          else { assert.equal(packet.pcm[f * 2], (i + 1) / 16); assert.equal(packet.pcm[f * 2 + 1], -(i + 1) / 32); }
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(ingestErrors, []);
      await capture.stop();
      assert.ok(events.some(event => event.event === "end"), "retain final helper status during requested cleanup");
    } else {
      await waitFor(() => errors.length > 0); await capture.closed;
      if (mode === "duplicate") {
        assert.match(errors[0]!.message, /sample order/);
        assert.ok(packets.every(packet => packet.sequence < 2), "duplicate and later packets never uploaded");
      } else assert.ok(ingestErrors.some(error => error.includes("no longer available")));
      assert.notEqual(child.exitCode, null, "failed upload stops its native producer");
    }
  });
}

test("owner cancellation during native preparation stops the helper", { timeout: 4000 }, async () => {
  const child = helper("preparing"), owner = new AbortController(), errors: Error[] = [];
  const preparation = prepareNativeCapture(child, requested, error => errors.push(error), undefined, owner.signal);
  owner.abort();
  await assert.rejects(preparation, /stopped/);
  assert.notEqual(child.exitCode, null); assert.deepEqual(errors, []);
});

test("Main rejects a helper that opens a different channel map", async () => {
  const child = helper("wrong-map");
  await assert.rejects(prepareNativeCapture(child, requested, () => {}), /requested channels/);
  assert.notEqual(child.exitCode, null);
});

test("a native publication restarts uploads at sample zero and applies only explicit mute", { timeout: 6000 }, async t => {
  const directory = mkdtempSync(resolve(tmpdir(), "couch-native-fixture-")), executable = resolve(directory, "capture");
  writeFileSync(executable, `#!${process.execPath}\n` + readFileSync(resolve("tests/fixtures/native-capture-helper.mjs"), "utf8"), { mode: 0o700 });
  const server = createServer(), sockets = new WebSocketServer({ server });
  const packets: CaptureAudioPacket[][] = [], errors: string[] = [];
  sockets.on("connection", socket => { const current: CaptureAudioPacket[] = []; packets.push(current); acceptCaptureUpload(socket, packet => { current.push(packet); return true; }, error => errors.push(error)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const source = nativeAudioInput(executable, { uid: "test", name: "ordered", channels: 4, nominalRate: 48000, ownerHalBufferFrames: 256 }, 48000, 128, error => errors.push(error), new AbortController().signal);
  t.after(async () => { await source.stop(); for (const socket of sockets.clients) socket.terminate(); await new Promise<void>(resolve => sockets.close(() => server.close(() => resolve()))); rmSync(directory, { recursive: true }); });
  await source.prepare();
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/api/live/upload`;
  await source.command({ op: "mute", id: "source", muted: true });
  await source.command({ op: "upload", id: "source", uploadId: "first", url });
  await waitFor(() => packets[0]?.length === 6);
  assert.ok(packets[0]!.every(packet => packet.pcm.every(sample => sample === 0)));
  await source.command({ op: "stop-upload", id: "source", uploadId: "first" });
  await source.command({ op: "mute", id: "source", muted: false });
  await source.command({ op: "upload", id: "source", uploadId: "second", url });
  await source.command({ op: "stop-upload", id: "source", uploadId: "first" }); // Stale audience teardown cannot stop the replacement.
  await waitFor(() => packets[1]?.length === 6);
  assert.equal(packets[1]![0]!.sequence, 0); assert.equal(packets[1]![0]!.samplePosition, 0);
  assert.notEqual(packets[0]![0]!.generation, packets[1]![0]!.generation);
  assert.equal(packets[1]![0]!.pcm[0], 1 / 16); assert.equal(packets[1]![0]!.pcm[1], -1 / 32);
  const mono = await source.command({ op: "channels", id: "source", channelMap: [1] });
  assert.equal(mono?.channels, 1); assert.deepEqual(mono?.native?.channelMap, [1]);
  await waitFor(() => packets[2]?.length === 6);
  assert.equal(packets[2]![0]!.sequence, 0); assert.equal(packets[2]![0]!.samplePosition, 0);
  assert.notEqual(packets[2]![0]!.generation, packets[1]![0]!.generation);
  assert.equal(packets[2]![0]!.pcm.length, 128); assert.equal(packets[2]![0]!.pcm[0], -1 / 32);
  await assert.rejects(source.command({ op: "channels", id: "source", channelMap: [4] }), /available channel/);
  await source.command({ op: "mute", id: "source", muted: true });
  const stereo = await source.command({ op: "channels", id: "source", channelMap: [2, 3] });
  assert.equal(stereo?.channels, 2); assert.deepEqual(stereo?.native?.channelMap, [2, 3]);
  await waitFor(() => packets[3]?.length === 6);
  assert.ok(packets[3]!.every(packet => packet.pcm.every(sample => sample === 0)), "mute survives a channel change");
  const buffered = await source.command({ op: "buffer", id: "source", bufferFrames: 512 });
  assert.deepEqual(buffered?.native?.channelMap, [2, 3]); assert.equal(buffered?.native?.requestedFrames, 512);
  await waitFor(() => packets[4]?.length === 6);
  assert.notEqual(packets[4]![0]!.generation, packets[3]![0]!.generation);
  assert.deepEqual(errors, []); await source.stop();
});
