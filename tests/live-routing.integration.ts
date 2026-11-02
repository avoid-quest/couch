import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLiveInputs } from "../src/server/live-input";
import type { ServerMessage } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

test(
  "receiver churn preserves a healthy live peer without repeating its volume",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "couch-live-routing-")),
      cwd = process.cwd();
    const previous = {
      COUCH_DATA_DIR: process.env.COUCH_DATA_DIR,
      COUCH_PORT: process.env.COUCH_PORT,
    };
    process.chdir(directory);
    process.env.COUCH_DATA_DIR = directory;
    process.env.COUCH_PORT = "0";
    let fixture: Awaited<ReturnType<typeof liveFixture>> | undefined;
    try {
      const f = (fixture = await liveFixture());
      await f.publish("event", "microphone");
      await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
      assert.equal((await f.receiver.command({ type: "playLive", sourceId: "event" })).ok, true);
      await until(() => !!f.receiver.load()?.livePeerId);
      const before = f.receiver.messages.length,
        original = f.receiver.load()!.livePeerId;
      const other = await f.connect(2, "&audio=1&video=1");
      assert.equal((await other.command({ type: "playLive", sourceId: "event" })).ok, true);
      await until(() => f.receiver.state.outputs?.length === 2);
      assert.equal(f.receiver.load()!.livePeerId, original);
      assert.deepEqual(
        f.receiver.messages.slice(before).filter((message) => message.type === "player"),
        [],
      );
      for (const volume of [37, 0, 62]) {
        const after = f.receiver.messages.length;
        assert.equal(
          (await f.publisher.command({ type: "volume", deviceId: f.receiver.id, volume })).ok,
          true,
        );
        await until(() =>
          f.receiver.messages
            .slice(after)
            .some(
              (message) =>
                message.type === "player" &&
                message.command.type === "volume" &&
                message.command.volume === volume,
            ),
        );
        assert.equal(f.receiver.load()!.livePeerId, original);
      }
    } finally {
      try {
        await fixture?.close();
      } finally {
        process.chdir(cwd);
        for (const [key, value] of Object.entries(previous))
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
);

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const receiver = (socket: string) => ({
  socket,
  deviceId: socket,
  picture: false,
  sound: true,
  volume: 50,
});
const load = { type: "load", playbackId: "item", source: "" } as const;
function routing() {
  const messages: { socket: string; message: ServerMessage }[] = [];
  const live = createLiveInputs<string>({
    deviceOf: (id) => id,
    nameOf: (id) => id,
    send: (socket, message) => messages.push({ socket, message }),
    ended() {},
    changed() {},
  });
  const publish = (owner = "publisher", key = "a".repeat(64)) =>
    live.publish(owner, {
      type: "publishLive",
      sourceId: "event",
      uploadToken: key,
      kind: "microphone",
      audio: true,
      video: false,
      audioDelivery: "pcm",
      intent: "live",
    });
  const notices = () =>
    messages
      .filter((item) => item.message.type === "livePeers")
      .map((item) => ({
        socket: item.socket,
        ...(item.message as Extract<ServerMessage, { type: "livePeers" }>),
      }));
  return { live, messages, publish, notices };
}

test("ending or replacing a publication cancels queued lists and keeps current upload and peer authority", async () => {
  const { live, messages, publish, notices } = routing();
  try {
    publish();
    live.route("programme", "event", load, [receiver("one")]);
    live.upload("event", true);
    assert.throws(() => live.end("stranger", "event"), /Only the capturing window/);
    live.end("publisher", "event");
    assert.deepEqual(
      notices().map((message) => ({
        owner: message.socket,
        peers: message.peers,
        upload: message.upload,
      })),
      [{ owner: "publisher", peers: [], upload: false }],
    );
    messages.length = 0;
    publish("replacement", "b".repeat(64));
    live.route("programme", "event", { ...load, playbackId: "replacement-item" }, [
      receiver("new"),
    ]);
    live.upload("event", true);
    await turn();
    assert.equal(notices().length, 1);
    const current = notices()[0]!;
    assert.equal(current.socket, "replacement");
    assert.deepEqual(
      current.peers.map((peer) => peer.deviceId),
      ["new"],
    );
    assert.ok(current.uploadId);
    assert.equal(live.acceptsUpload("event", "publisher", "a".repeat(64), current.uploadId), false);
    assert.equal(
      live.acceptsUpload("event", "replacement", "b".repeat(64), current.uploadId),
      true,
    );
    const candidate = {
      type: "liveSignal",
      peerId: current.peers[0]!.peerId,
      signal: { candidate: null },
    } as const;
    assert.throws(() => live.receive("publisher", candidate), /no live peer permission/);
    messages.length = 0;
    live.upload("event", false);
    live.close();
    await turn();
    assert.deepEqual(
      notices().map((message) => ({ peers: message.peers, upload: message.upload })),
      [{ peers: [], upload: false }],
      "close cannot leave a stale announcement",
    );
  } finally {
    live.close();
  }
});
