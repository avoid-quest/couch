import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFixture, until } from "./live-input.fixture";

async function grouped() {
  const f = await liveFixture();
  await f.publish("screen");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
  await until(() => !!f.receiver.load());
  // Live inputs play in sync only when chosen (docs/adr/0001).
  assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
  const delays = await f.speaker(1);
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal(
    (await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true }))
      .ok,
    true,
  );
  await until(() => !!other.load());
  return { ...f, delays, receivers: [f.receiver, other] };
}

test(
  "a live input uses the same speaker delay setting as other grouped playback",
  { timeout: 15_000 },
  async () => {
    const f = await grouped();
    try {
      const result = await f.publisher.command({
        type: "output",
        deviceId: f.receiver.id,
        delay: 80,
      });
      assert.equal(result.ok, true, result.error ?? "");
      await until(() => f.delays.includes(80));
      await until(
        () =>
          f.publisher.state.outputs?.find((output) => output.deviceId === f.receiver.id)?.delay ===
          80,
      );
      await until(() => f.publisher.state.player.status === "playing");
      assert.equal((await f.publisher.command({ type: "solo", deviceId: f.receiver.id })).ok, true);
      await until(() => !!f.receiver.load() && "livePeerId" in f.receiver.load()!);
      assert.equal(
        (
          await f.publisher.command({
            type: "output",
            deviceId: f.receivers[1]!.id,
            level: 50,
            picture: true,
          })
        ).ok,
        true,
      );
      await until(() => !!f.receiver.load()?.follow);
      assert.equal(
        f.publisher.state.outputs?.find((output) => output.deviceId === f.receiver.id)?.delay,
        80,
        "the speaker's existing delay survives transport changes",
      );
    } finally {
      await f.close();
    }
  },
);
