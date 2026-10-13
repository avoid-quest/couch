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
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
  await until(() => !!other.load());
  return { ...f, receivers: [f.receiver, other] };
}

test("a live input on multiple devices uses the normal shared sound and picture clock", { timeout: 15_000 }, async () => {
  const f = await grouped(true);
  try {
    for (const receiver of f.receivers) {
      await until(() => receiver.messages.some(message => message.type === "sendspin" && message.listen && message.watch));
      const follow = receiver.messages.findLast(message => message.type === "player" && (message.command.type === "follow" || message.command.type === "load") && message.command.follow);
      assert.ok(follow?.type === "player" && "follow" in follow.command && follow.command.follow);
      assert.deepEqual(follow.command.follow, { group: f.publisher.state.playback, pts: true });
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
    const delays = await f.speaker(1);
    const result = await f.publisher.command({ type: "output", deviceId: f.receiver.id, delay: 80 });
    assert.equal(result.ok, true, result.error);
    await until(() => delays.includes(80));
  } finally { await f.close(); }
});
