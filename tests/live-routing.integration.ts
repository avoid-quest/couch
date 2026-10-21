import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerMessage } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

test("receiver tab churn keeps an unchanged live output connected without resending its level", { timeout: 15000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("audio", "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "audio", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.livePeerId);
    f.receiver.report();
    const peer = f.receiver.load()!.livePeerId, before = f.receiver.messages.length;
    let closed: { code: number; reason: string } | undefined;
    f.receiver.socket.on("close", (code, reason) => { closed = { code, reason: String(reason) }; });
    // The production renderer reports PlayerState after every player command.
    f.receiver.socket.on("message", data => {
      const message = JSON.parse(String(data)) as ServerMessage;
      if (message.type === "player") f.receiver.report();
    });
    let other = await f.connect(2, "&audio=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50 })).ok, true);
    for (let index = 0; index < 65; index++) {
      const previous = other;
      other = await f.connect(2, "&audio=1");
      await until(() => !!other.load()?.livePeerId);
      previous.socket.terminate();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(closed, undefined, "Routing other receivers must not flood the healthy renderer's command budget.");
    assert.equal(f.receiver.load()!.livePeerId, peer);
    assert.deepEqual(f.receiver.messages.slice(before).filter(message => message.type === "player"), [], "An unchanged receiver needs neither a reload nor a repeated volume command.");

    for (const volume of [37, 0, 62]) {
      const after = f.receiver.messages.length;
      assert.equal((await f.publisher.command({ type: "volume", deviceId: f.receiver.id, volume })).ok, true);
      await until(() => f.receiver.messages.slice(after).some(message => message.type === "player" && message.command.type === "volume" && message.command.volume === volume));
      assert.equal(f.receiver.load()!.livePeerId, peer, "Changing level preserves the peer.");
    }
  } finally { await f.close(); }
});
