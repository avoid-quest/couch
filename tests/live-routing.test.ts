import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveInputs } from "../src/server/live-input";
import type { ServerMessage } from "../src/shared/protocol";

test("a routing burst publishes only its final peer list, after immediate receiver commands", async () => {
  const messages: { socket: string; message: ServerMessage }[] = [];
  const live = createLiveInputs<string>({ deviceOf: id => id, nameOf: id => id, send: (socket, message) => messages.push({ socket, message }), ended() {}, changed() {} });
  const source = () => live.publish("publisher", { type: "publishLive", sourceId: "source", uploadToken: "a".repeat(64), kind: "microphone", audio: true, video: false });
  const load = { type: "load", playbackId: "item", source: "" } as const;
  const receiver = (socket: string) => ({ socket, deviceId: socket, picture: false, sound: true, volume: 50 });
  const notices = () => messages.filter(item => item.socket === "publisher" && item.message.type === "livePeers").map(item => item.message as Extract<ServerMessage, { type: "livePeers" }>);
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    source();
    live.route("playback", "source", load, [receiver("one")]);
    live.route("playback", "source", load, [receiver("one"), receiver("two")]);
    live.route("playback", "source", load, [receiver("two"), receiver("three")]);
    assert(messages.some(item => item.socket === "one" && item.message.type === "player" && item.message.command.type === "stop"), "A removed receiver stops immediately.");
    assert.equal(notices().length, 0, "Intermediate lists would negotiate peers already removed by the burst.");
    await turn();
    assert.equal(notices().length, 1);
    assert.deepEqual(notices()[0]!.peers.map(peer => peer.deviceId), ["two", "three"]);
    for (const peer of notices()[0]!.peers) assert(messages.some(item => item.socket === peer.deviceId && item.message.type === "player" && item.message.command.type === "load" && item.message.command.livePeerId === peer.peerId));

    messages.length = 0;
    live.upload("source", true);
    live.disconnect("two");
    await turn();
    assert.equal(notices().length, 1);
    assert.equal(notices()[0]!.upload, true);
    assert(notices()[0]!.uploadId);
    assert.deepEqual(notices()[0]!.peers.map(peer => peer.deviceId), ["three"]);

    messages.length = 0;
    live.route("playback", "source", load, [receiver("four")]);
    live.end("publisher", "source");
    assert.deepEqual(notices().map(message => message.peers), [[]], "Ending a source still cancels publication immediately.");
    await turn();
    assert.equal(notices().length, 1, "No stale list follows the end notice.");
  } finally { live.close(); }
});
