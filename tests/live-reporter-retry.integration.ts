import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { liveFixture, until } from "./live-input.fixture";
import { executableName } from "./executable.fixture";

type Receiver = Awaited<ReturnType<typeof liveFixture>>["receiver"];
const loads = (receiver: Receiver) => receiver.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
const failPeer = (receiver: Receiver) => receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: receiver.load()!.livePeerId, error: "Unreachable." }));
const output = (receiver: Receiver) => receiver.state.outputs?.find(output => output.deviceId === receiver.id);

// Exercise real hub routing and reports. Only capture encoding is the fixture's fake FFmpeg.
test("retrying a shared buffer keeps other independent playbacks failed until their own retry", { timeout: 20_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const other = await f.connect(2, "&audio=1&video=1");
    const healthy = await f.connect(3, "&audio=1&video=1"), secondHealthy = await f.connect(-1, "&audio=1&video=1");
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    assert.equal((await f.publisher.command({ type: "output", deviceId: healthy.id, picture: true, level: 50 })).ok, true);
    // Queue then Play creates an independent playback, rather than joining the first.
    assert.equal((await other.command({ type: "playLive", sourceId: "screen", playNow: false })).ok, true);
    const entry = other.state.queue.find(entry => entry.liveSourceId === "screen")!;
    assert.equal((await other.command({ type: "play", entryId: entry.id })).ok, true);
    assert.equal((await other.command({ type: "output", deviceId: other.id, picture: true, level: 50 })).ok, true);
    assert.equal((await other.command({ type: "output", deviceId: secondHealthy.id, picture: false, level: 0 })).ok, true);
    assert.equal((await other.command({ type: "output", deviceId: secondHealthy.id, picture: true, level: 50 })).ok, true);
    await until(() => !!healthy.load() && !!secondHealthy.load() && !!other.load());
    const ids = [f.receiver, other].map(receiver => receiver.load()!.playbackId);
    assert.notEqual(f.receiver.state.playback, other.state.playback);
    assert.notEqual(ids[0], ids[1]);
    for (const receiver of [f.receiver, other]) {
      receiver.report();
      await until(() => receiver.state.player.status === "playing");
      failPeer(receiver);
      await until(() => !!receiver.load()?.hls);
    }
    // One source upload feeds both playbacks; disconnecting it fails both relays.
    assert.equal(f.uploads.size, 1);
    f.uploads.get("screen")!.terminate();
    await until(() => !!output(f.receiver)?.error && !!output(other)?.error);
    for (const receiver of [f.receiver, other]) {
      const last = receiver.messages.findLast(message => message.type === "player");
      assert.equal(last?.type === "player" && last.command.type, "stop", "both failed relays are stopped");
    }
    healthy.report(); secondHealthy.report();
    await until(() => f.receiver.state.player.status === "playing" && other.state.player.status === "playing");
    const before = [f.receiver, other, healthy, secondHealthy].map(receiver => loads(receiver).length);
    const failed = output(other)!.error;
    for (const [index, receiver] of [f.receiver, other].entries()) {
      assert.equal((await receiver.command({ type: "pause", playbackId: ids[index]!, paused: true })).ok, true);
    }
    healthy.report({ status: "paused" }); secondHealthy.report({ status: "paused" });
    await until(() => f.receiver.state.player.status === "paused" && other.state.player.status === "paused");
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => loads(f.receiver).length > before[0]!);
    assert.equal(f.receiver.load()!.paused, true);
    assert.equal(f.receiver.load()!.playbackId, ids[0]);
    assert.equal((await fetch(f.receiver.load()!.source)).status, 200, "retried receiver has a working media URL");
    f.receiver.report({ status: "paused" });
    await f.receiver.command({ type: "volume", deviceId: f.receiver.id, volume: 37 });
    await until(() => other.state.devices?.find(device => device.id === f.receiver.id)?.volume === 37);
    assert.equal(output(f.receiver)?.buffered, true);
    assert.equal(loads(other).length, before[1], "the other receiver remains stopped");
    assert.equal(output(other)?.error, failed, "source availability must not erase another playback's failure");
    assert.equal(output(other)?.buffered, undefined);
    assert.equal(other.state.player.playbackId, ids[1]);
    assert.equal(other.state.player.status, "paused");
    // Its explicit retry uses the already-ready shared stream and the current pause state.
    assert.equal((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).ok, true);
    await until(() => loads(other).length > before[1]!);
    assert.equal(other.load()!.playbackId, ids[1]);
    assert.equal(other.load()!.paused, true);
    assert.equal((await fetch(other.load()!.source)).status, 200);
    other.report({ status: "paused" });
    await until(() => output(other)?.buffered === true && !output(other)?.error);
    for (const [index, receiver] of [healthy, secondHealthy].entries()) assert.equal(loads(receiver).length, before[index + 2], "healthy peers never reload");
    // Resume reaches the reloaded receivers and their reports drive each playback again.
    for (const [index, receiver] of [f.receiver, other].entries()) {
      assert.equal((await receiver.command({ type: "pause", playbackId: ids[index]!, paused: false })).ok, true);
      await until(() => receiver.messages.some(message => message.type === "player" && message.command.type === "pause" && !message.command.paused));
      receiver.report();
      await until(() => receiver.state.player.status === "playing");
    }
  } finally { await f.close(); }
});

test("a healthy second receiver reports and controls playback while the first waits for provisioning", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  const directory = dirname(f.databasePath), gate = join(directory, "gate"), held = join(directory, "held"), slow = join(directory, "slow");
  mkdirSync(slow);
  writeFileSync(join(slow, executableName("ffmpeg")), `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('-version')) {
  fs.writeFileSync(${JSON.stringify(held)}, String(process.pid));
  const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(gate)})) { clearInterval(timer); console.log('ffmpeg version 7.0'); } }, 20);
} else {
  ${readFileSync(f.executable, "utf8").replace(/^#![^\n]*\n/, "")}
}
`, { mode: 0o755 });
  process.env.PATH = `${slow}${delimiter}${process.env.PATH}`;
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 })).ok, true);
    await until(() => !!other.load());
    const firstId = f.receiver.load()!.playbackId, peerId = other.load()!.livePeerId, before = loads(other).length;
    failPeer(f.receiver);
    await until(() => existsSync(held));
    await f.receiver.command({ type: "volume", deviceId: f.receiver.id, volume: 37 });
    await until(() => other.state.devices?.find(device => device.id === f.receiver.id)?.volume === 37);
    assert.equal(output(f.receiver)?.buffered, true);
    other.report();
    // Same-socket command and ensuing state update form a barrier for its report.
    await other.command({ type: "volume", deviceId: other.id, volume: 38 });
    await until(() => other.state.devices?.find(device => device.id === other.id)?.volume === 38);
    assert.equal(other.state.player.status, "playing", "the healthy peer must report while provisioning waits");
    assert.equal(f.receiver.load()!.hls, undefined);
    assert.equal((await f.publisher.command({ type: "pause", playbackId: firstId, paused: true })).ok, true);
    await until(() => other.messages.some(message => message.type === "player" && message.command.type === "pause" && message.command.paused));
    other.report({ status: "paused" });
    await until(() => f.publisher.state.player.status === "paused");
    writeFileSync(gate, "");
    await until(() => !!f.receiver.load()?.hls);
    assert.equal(f.receiver.load()!.paused, true);
    assert.equal(f.receiver.load()!.playbackId, firstId);
    assert.equal(other.load()!.livePeerId, peerId);
    assert.equal(loads(other).length, before);
    // Original output ordering resumes once the first receiver actually has a route.
    const audio = { id: "audio", index: 0, kind: "audio" as const, label: "First receiver", language: "", selected: true };
    f.receiver.report({ status: "paused", tracks: [audio] });
    await until(() => f.publisher.state.player.tracks?.[0]?.label === audio.label);
    other.report({ status: "paused", tracks: [{ ...audio, label: "Second receiver" }] });
    await other.command({ type: "volume", deviceId: other.id, volume: 39 });
    await until(() => other.state.devices?.find(device => device.id === other.id)?.volume === 39);
    assert.deepEqual(other.state.player.tracks, [audio]);
  } finally {
    writeFileSync(gate, "");
    const pid = existsSync(held) ? Number(readFileSync(held, "utf8")) : undefined;
    assert.deepEqual(await f.close(), { children: [], workers: [] }, "helper children and workers must stop before forced cleanup");
    if (pid) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the held helper child must stop");
  }
});
