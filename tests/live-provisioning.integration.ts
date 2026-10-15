import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { liveFixture, until } from "./live-input.fixture";

// Core's first FFmpeg lookup may download the helper within its own network
// bounds. This file's process makes that lookup wait on a gate instead.
test("Publish and direct playback need no encoder; a slow first FFmpeg lookup delays only buffered delivery, which ending the source cancels", { timeout: 50_000 }, async () => {
  const f = await liveFixture({ local: true });
  const directory = dirname(f.databasePath), gate = join(directory, "gate"), spawns = join(directory, "spawns");
  const slow = join(directory, "slow");
  mkdirSync(slow);
  writeFileSync(join(slow, "ffmpeg"), `#!/bin/sh
case " $* " in *" -version "*) while [ ! -e '${gate}' ]; do sleep 0.02; done; echo 'ffmpeg version 7.0'; exit 0;; esac
for couch_arg do couch_last="$couch_arg"; done
case "$couch_last" in */stream.m3u8) echo "$couch_last" >> '${spawns}';; esac
exec '${join(directory, "ffmpeg")}' "$@"
`, { mode: 0o755 });
  process.env.PATH = `${slow}${delimiter}${process.env.PATH}`;
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const relay = async (sourceId: string) => {
      await f.publish(sourceId);
      assert.equal((await f.publisher.command({ type: "playLive", sourceId, deviceId: f.receiver.id })).ok, true);
      await until(() => f.receiver.load()?.liveSourceId === sourceId);
      f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
      await until(() => f.publisher.state.outputs?.some(output => output.buffered) === true);
    };
    // Publish and the direct peer are answered while the lookup waits; the relay waits for it.
    await relay("ended");
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(f.receiver.load()?.hls, undefined, "nothing buffered is ready yet");
    assert.equal((await f.publisher.command({ type: "endLive", sourceId: "ended" })).ok, true);
    await relay("relayed");
    // Another playback chooses In sync while both sources share the pending helper lookup.
    // Keep the first fallback waiting too: every waiter must survive provisioning.
    const other = await f.connect(2, "&audio=1&video=1"), local = await f.connect(3, "&audio=1&video=1");
    const secondPublisher = await f.connect(0);
    f.answerUploads(secondPublisher);
    assert.equal((await secondPublisher.command({ type: "publishLive", sourceId: "synced", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
    assert.equal((await secondPublisher.command({ type: "playLive", sourceId: "synced", deviceId: other.id })).ok, true);
    await until(() => other.load()?.liveSourceId === "synced");
    assert.equal((await secondPublisher.command({ type: "output", deviceId: local.id, level: 50, picture: true })).ok, true);
    await until(() => local.load()?.liveSourceId === "synced");
    assert.equal((await secondPublisher.command({ type: "inSync", inSync: true })).ok, true);
    // AbortSignal.timeout uses Node's internal timers, not node:test's mocked timers.
    // Cross the real 30s readiness deadline while FFmpeg's version check is gated.
    await new Promise(resolve => setTimeout(resolve, 31_000));
    assert.notEqual(other.state.player.status, "error", "In sync must keep waiting for helper provisioning");
    writeFileSync(gate, "");
    await until(() => f.receiver.load()?.hls === true);
    await until(() => other.load()?.hls === true && !!other.load()?.follow && local.load()?.hls === true);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(readFileSync(spawns, "utf8").trim().split("\n").length, 2, "each active source starts one encoder; the ended input starts none");
  } finally { writeFileSync(gate, ""); await f.close(); }
});
