import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatementSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { openStore } from "../src/server/store";
import { liveFixture, until } from "./live-input.fixture";

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-state-fanout-"));
  const cwd = process.cwd(), previous = { COUCH_DATA_DIR: process.env.COUCH_DATA_DIR, COUCH_PORT: process.env.COUCH_PORT };
  process.chdir(directory);
  process.env.COUCH_DATA_DIR = directory;
  process.env.COUCH_PORT = "0";
  let f: Awaited<ReturnType<typeof liveFixture>> | undefined;
  t.after(async () => {
    try { await f?.close(); }
    finally {
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
  return { ...f, first, second };
}

test("one state broadcast reads each playback's output projections once for both receivers", { timeout: 10_000 }, async t => {
  const { first, second } = await fixture(t);
  const delays: unknown[] = [], volumes: unknown[] = [], get = StatementSync.prototype.get;
  // Observe actual SQLite reads without replacing their results or the hub's routing.
  t.mock.method(StatementSync.prototype, "get", function(this: StatementSync, ...params: Parameters<typeof get>) {
    if (this.sourceSQL === "SELECT delay FROM device_sync_delay WHERE id = ?") delays.push(params[0]);
    if (this.sourceSQL === "SELECT volume, muted FROM devices WHERE id = ?") volumes.push(params[0]);
    return get.apply(this, params);
  });
  const before = second.state;
  // Unchanged consent publishes state without changing outputs or routing media.
  assert.equal((await first.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
  await until(() => second.state !== before);
  assert.deepEqual(delays.sort(), [first.id, second.id].sort(), "Saved delays are read once per output, not once per recipient.");
  for (const receiver of [first, second]) {
    // One read populates the device list, one computes its level in this playback.
    assert.equal(volumes.filter(id => id === receiver.id).length, 2);
    assert.equal(receiver.state.controlling, receiver.id);
  }
  assert.deepEqual(first.state.outputs, second.state.outputs);
});

test("later broadcasts refresh levels and delays while each receiver keeps its own controls", { timeout: 10_000 }, async t => {
  const { first, second, databasePath } = await fixture(t);
  const saveDelay = (id: string, delay: number) => {
    const store = openStore(databasePath);
    try { store.saveDeviceSyncDelay(id, delay); } finally { store.close(); }
  };
  saveDelay(first.id, 13);
  saveDelay(second.id, 29);
  assert.equal((await first.command({ type: "volume", deviceId: first.id, volume: 40 })).ok, true);
  assert.equal((await second.command({ type: "volume", deviceId: second.id, volume: 80 })).ok, true);
  await until(() => [first, second].every(receiver => receiver.state.player.volume === 80));
  for (const receiver of [first, second]) assert.deepEqual(receiver.state.outputs?.map(output => output.delay), [13, 29]);

  // A private self-joined output remains in the mix, but others cannot move its level.
  const before = second.messages.length;
  assert.equal((await second.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
  const messages = second.messages.slice(before), result = messages.findIndex(message => message.type === "result");
  assert.ok(result >= 0 && messages.slice(0, result).some(message => message.type === "state" && message.state.devices?.find(device => device.id === second.id)?.sharing.audio === false), "Updated consent reaches the requesting window before the command result.");
  await until(() => first.state.player.volume === 40);
  assert.equal(second.state.player.volume, 80);
  assert.equal(first.state.controlling, first.id);
  assert.equal(second.state.controlling, second.id);
  assert.equal((await first.command({ type: "volume", deviceId: second.id, volume: 10 })).ok, false);
  assert.equal(second.state.devices?.find(device => device.id === second.id)?.volume, 80);

  assert.equal((await first.command({ type: "volume", volume: 20 })).ok, true);
  await until(() => second.state.devices?.find(device => device.id === first.id)?.volume === 20);
  assert.equal(first.state.player.volume, 20);
  assert.equal(second.state.player.volume, 80);
  saveDelay(second.id, 47);
  assert.equal((await second.command({ type: "volume", deviceId: second.id, volume: 0 })).ok, true);
  await until(() => [first, second].every(receiver => receiver.state.outputs?.find(output => output.deviceId === second.id)?.delay === 47));
  assert.equal((await first.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
  await until(() => second.state.player.volume === 0);
  assert.equal(first.state.player.volume, 20);
  assert.deepEqual(first.state.outputs, second.state.outputs);
});
