import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { liveFixture, until } from "./live-input.fixture";

// Core's first FFmpeg lookup may download the helper within its own network
// bounds. This file's process makes that lookup wait on a gate instead.
test("Publish and direct playback need no encoder; a slow first FFmpeg lookup delays only buffered delivery, which ending the source cancels", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  const directory = dirname(f.databasePath), gate = join(directory, "gate"), spawns = join(directory, "spawns");
  const slow = join(directory, "slow");
  mkdirSync(slow);
  writeFileSync(join(slow, "ffmpeg"), `#!/bin/sh
case " $* " in *" -version "*) while [ ! -e '${gate}' ]; do sleep 0.02; done; echo 'ffmpeg version 7.0'; exit 0;; esac
for couch_arg do couch_last="$couch_arg"; done
echo "$couch_last" >> '${spawns}'
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
    writeFileSync(gate, "");
    await until(() => f.receiver.load()?.hls === true);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(readFileSync(spawns, "utf8").trim().split("\n").length, 1, "the ended input never starts an encoder");
  } finally { writeFileSync(gate, ""); await f.close(); }
});
