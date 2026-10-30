import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFixture, until } from "./live-input.fixture";

async function grouped(withHost = false) {
  const f = await liveFixture();
  if (withHost) await f.connect(-1, "&tv=1");
  await f.publish("screen");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
  await until(() => !!f.receiver.load());
  // Live inputs play in sync only when chosen (docs/adr/0001).
  assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
  const delays = await f.speaker(1);
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
  await until(() => !!other.load());
  return { ...f, delays, receivers: [f.receiver, other] };
}

test("a live input In sync on multiple devices uses the normal shared sound and picture clock", { timeout: 15_000 }, async () => {
  const f = await grouped(true);
  try {
    for (const receiver of f.receivers) {
      await until(() => receiver.messages.some(message => message.type === "sendspin" && message.listen && message.watch));
      const follow = receiver.messages.findLast(message => message.type === "player" && (message.command.type === "follow" || message.command.type === "load") && message.command.follow);
      assert.ok(follow?.type === "player" && "follow" in follow.command && follow.command.follow);
      assert.deepEqual(follow.command.follow, { group: f.publisher.state.playback, pts: true, timeline: { kind: "source-pts", generation: follow.command.playbackId, mapping: "hls" } });
      assert.equal(receiver.state.controlling, receiver.id, "a receiving device with no explicit selection must show its own playback");
      assert.equal(receiver.state.playback, f.publisher.state.playback);
      assert.equal(receiver.state.currentEntryId, f.publisher.state.currentEntryId);
      assert.deepEqual(receiver.state.outputs, f.publisher.state.outputs);
    }
  } finally { await f.close(); }
});

test("a live input uses the same speaker delay setting as other grouped playback", { timeout: 15_000 }, async () => {
  const f = await grouped();
  try {
    const result = await f.publisher.command({ type: "output", deviceId: f.receiver.id, delay: 80 });
    assert.equal(result.ok, true, result.error ?? "");
    await until(() => f.delays.includes(80));
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay === 80);
    await until(() => f.publisher.state.player.status === "playing");
    assert.equal((await f.publisher.command({ type: "solo", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load() && "livePeerId" in f.receiver.load()!);
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receivers[1]!.id, level: 50, picture: true })).ok, true);
    await until(() => !!f.receiver.load()?.follow);
    assert.equal(f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay, 80, "the speaker's existing delay survives transport changes");
  } finally { await f.close(); }
});
