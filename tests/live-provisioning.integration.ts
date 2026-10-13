import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import WebSocket from "ws";
import { liveFixture, until } from "./live-input.fixture";

// Core's first FFmpeg lookup may download the helper within its own network
// bounds. This file's process makes that lookup wait on a gate instead.
test("Publish waits for a slow first FFmpeg lookup, while Cancel and disconnect end it at once without an encoder", { timeout: 20_000 }, async () => {
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
    const answered = new Set<string>();
    const publish = (client: typeof f.publisher, sourceId: string) => client.command({ type: "publishLive", sourceId, uploadToken: f.uploadToken, kind: "screen", audio: true, video: true }).then(result => { answered.add(sourceId); return result; });
    const canceling = await f.connect(0), dropping = await f.connect(0);
    const slowReply = publish(f.publisher, "slow"), canceled = publish(canceling, "canceled");
    void publish(dropping, "dropped");
    await until(() => ["slow", "canceled", "dropped"].every(id => f.publisher.state.liveSources?.some(source => source.id === id)));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(answered.size, 0, "Publish is answered only once the encoder can start");

    assert.equal((await canceling.command({ type: "endLive", sourceId: "canceled" })).ok, true);
    const cancellation = await canceled;
    assert.equal(cancellation.ok, false, "Cancel answers the pending Publish while the lookup continues");
    dropping.socket.close();
    await until(() => !f.publisher.state.liveSources?.some(source => source.id === "dropped"));
    assert.ok(!answered.has("slow") && !existsSync(spawns));

    writeFileSync(gate, "");
    assert.equal((await slowReply).ok, true);
    const upload = new WebSocket(f.uploadUrl("slow", f.uploadToken), { headers: { Origin: f.hub.origin } });
    try {
      await new Promise<void>((resolve, reject) => {
        upload.once("error", reject);
        upload.once("open", () => upload.send(Buffer.from("fixture capture")));
        upload.on("message", data => { if (JSON.parse(String(data)).type === "ready") resolve(); });
      });
    } finally { upload.terminate(); }
    await new Promise(resolve => setTimeout(resolve, 200));
    const encoders = readFileSync(spawns, "utf8").trim().split("\n");
    assert.equal(encoders.length, 1, "Canceled and disconnected inputs never start an encoder");
  } finally { writeFileSync(gate, ""); await f.close(); }
});
