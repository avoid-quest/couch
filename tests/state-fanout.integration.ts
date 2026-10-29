import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatementSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { openStore } from "../src/server/store";
import { liveFixture, until } from "./live-input.fixture";

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-state-fanout-")), cwd = process.cwd();
  const previous = { COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, COUCH_PORT: process.env.COUCH_PORT };
  process.chdir(directory);
  process.env.COUCH_DATA_DIR = directory;
  process.env.COUCH_PORT = "0";
  let f: Awaited<ReturnType<typeof liveFixture>> | undefined;
  t.after(async () => {
    try { await f?.close(); } finally {
      process.chdir(cwd);
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  f = await liveFixture();
  const first = f.receiver, second = await f.connect(2, "&audio=1&video=1");
  assert.equal((await first.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  await f.publish("event", "microphone");
  for (const receiver of [first, second]) assert.equal((await receiver.command({ type: "playLive", sourceId: "event" })).ok, true);
  await until(() => [first, second].every(receiver => !!receiver.load()?.livePeerId && receiver.state.outputs?.length === 2));
  const saved = openStore(f.databasePath);
  t.after(() => saved.close());
  return { ...f, first, second, saved };
}

test("one flush reads each playback level and decorated output once across recipients", { timeout: 10_000 }, async t => {
  const { first, second, saved } = await fixture(t);
  const delays: unknown[] = [], volumes: unknown[] = [], get = StatementSync.prototype.get;
  t.mock.method(StatementSync.prototype, "get", function(this: StatementSync, ...params: Parameters<typeof get>) {
    if (this.sourceSQL === "SELECT delay FROM device_sync_delay WHERE id = ?") delays.push(params[0]);
    if (this.sourceSQL === "SELECT volume, muted FROM devices WHERE id = ?") volumes.push(params[0]);
    return get.apply(this, params);
  });
  saved.saveDeviceSyncDelay(second.id, 19);
  assert.equal((await first.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  await until(() => second.state.outputs?.some(output => output.delay === 19) === true);
  assert.deepEqual(delays.sort(), [first.id, second.id].sort());
  for (const receiver of [first, second]) assert.equal(volumes.filter(id => id === receiver.id).length, 2, "one device-list read and one playback-level read, independent of viewers");
  assert.deepEqual(first.state.outputs, second.state.outputs);
});

test("later flushes preserve private controls, zero volume, fresh delays and state-before-result order", { timeout: 10_000 }, async t => {
  const { first, second, saved } = await fixture(t);
  saved.saveDeviceSyncDelay(first.id, 13);
  saved.saveDeviceSyncDelay(second.id, 29);
  assert.equal((await first.command({ type: "volume", deviceId: first.id, volume: 40 })).ok, true);
  assert.equal((await second.command({ type: "volume", deviceId: second.id, volume: 80 })).ok, true);
  await until(() => [first, second].every(receiver => receiver.state.player.volume === 80));
  for (const receiver of [first, second]) assert.deepEqual(receiver.state.outputs?.map(output => output.delay), [13, 29]);
  const before = second.messages.length;
  assert.equal((await second.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
  const messages = second.messages.slice(before), result = messages.findIndex(message => message.type === "result");
  assert.ok(result >= 0 && messages.slice(0, result).some(message => message.type === "state" && message.state.devices?.find(device => device.id === second.id)?.sharing.audio === false));
  await until(() => first.state.player.volume === 40);
  assert.equal(second.state.player.volume, 80);
  assert.equal((await first.command({ type: "volume", deviceId: second.id, volume: 10 })).ok, false);
  saved.saveDeviceSyncDelay(second.id, 47);
  assert.equal((await second.command({ type: "volume", deviceId: second.id, volume: 0 })).ok, true);
  await until(() => [first, second].every(receiver => receiver.state.outputs?.find(output => output.deviceId === second.id)?.delay === 47));
  assert.equal((await first.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
  await until(() => second.state.player.volume === 0);
  assert.equal(first.state.player.volume, 40);
  for (const receiver of [first, second]) {
    assert.equal(receiver.state.controlling, receiver.id);
    assert.equal(receiver.state.controls?.programme, true);
  }
  assert.deepEqual(first.state.outputs, second.state.outputs);
});
