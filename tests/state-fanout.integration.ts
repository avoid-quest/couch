import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { openStore } from "../src/server/store";
import { liveFixture, until } from "./live-input.fixture";

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-state-fanout-")),
    cwd = process.cwd();
  const previous = {
    COUCH_DATA_DIR: process.env.COUCH_DATA_DIR,
    COUCH_PORT: process.env.COUCH_PORT,
  };
  process.chdir(directory);
  process.env.COUCH_DATA_DIR = directory;
  process.env.COUCH_PORT = "0";
  let f: Awaited<ReturnType<typeof liveFixture>> | undefined,
    saved: ReturnType<typeof openStore> | undefined;
  t.after(async () => {
    try {
      saved?.close();
      await f?.close();
    } finally {
      process.chdir(cwd);
      for (const [key, value] of Object.entries(previous))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  f = await liveFixture();
  const first = f.receiver,
    second = await f.connect(2, "&audio=1&video=1");
  assert.equal(
    (await first.command({ type: "sharing", sharing: { audio: true, video: true } })).ok,
    true,
  );
  await f.publish("event", "microphone");
  for (const receiver of [first, second])
    assert.equal((await receiver.command({ type: "playLive", sourceId: "event" })).ok, true);
  await until(() =>
    [first, second].every(
      (receiver) => !!receiver.load()?.livePeerId && receiver.state.outputs?.length === 2,
    ),
  );
  saved = openStore(f.databasePath);
  return { ...f, first, second, saved };
}

test(
  "later flushes preserve private controls, zero volume and fresh delays",
  { timeout: 10_000 },
  async (t) => {
    const { first, second, saved } = await fixture(t);
    saved.saveDeviceSyncDelay(first.id, 13);
    saved.saveDeviceSyncDelay(second.id, 29);
    assert.equal(
      (await first.command({ type: "volume", deviceId: first.id, volume: 40 })).ok,
      true,
    );
    assert.equal(
      (await second.command({ type: "volume", deviceId: second.id, volume: 80 })).ok,
      true,
    );
    await until(() => [first, second].every((receiver) => receiver.state.player.volume === 80));
    for (const receiver of [first, second])
      assert.deepEqual(
        receiver.state.outputs?.map((output) => output.delay),
        [13, 29],
      );
    assert.equal(
      (await second.command({ type: "sharing", sharing: { audio: false, video: false } })).ok,
      true,
    );
    await until(() => first.state.player.volume === 40);
    assert.equal(second.state.player.volume, 80);
    assert.equal(
      (await first.command({ type: "volume", deviceId: second.id, volume: 10 })).ok,
      false,
    );
    saved.saveDeviceSyncDelay(second.id, 47);
    assert.equal(
      (await second.command({ type: "volume", deviceId: second.id, volume: 0 })).ok,
      true,
    );
    await until(() =>
      [first, second].every(
        (receiver) =>
          receiver.state.outputs?.find((output) => output.deviceId === second.id)?.delay === 47,
      ),
    );
    assert.equal(
      (await first.command({ type: "sharing", sharing: { audio: false, video: false } })).ok,
      true,
    );
    await until(() => second.state.player.volume === 0);
    assert.equal(first.state.player.volume, 40);
    for (const receiver of [first, second]) {
      assert.equal(receiver.state.controlling, receiver.id);
      assert.equal(receiver.state.controls?.programme, true);
    }
    assert.deepEqual(first.state.outputs, second.state.outputs);
  },
);
