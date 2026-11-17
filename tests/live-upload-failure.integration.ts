import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveUploadFailed } from "../src/server/validation";
import { liveFixture, until } from "./live-input.fixture";

type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Client = Fixture["publisher"];
const uploadRequest = (client: Client) =>
  client.messages.findLast((message) => message.type === "livePeers");
const uploadRequested = (client: Client) => uploadRequest(client)?.upload === true;
const loads = (client: Client) =>
  client.messages.filter((message) => message.type === "player" && message.command.type === "load")
    .length;
const error = "This browser cannot record a live input for buffered playback.";
const failureMessage = (
  client: Client,
  sourceId = "screen",
  uploadId = uploadRequest(client)?.uploadId ?? "unrequested",
) => JSON.stringify({ type: "liveUploadFailed", sourceId, uploadId, error });
const fail = (client: Client, sourceId = "screen", uploadId?: string) =>
  client.socket.send(failureMessage(client, sourceId, uploadId));
// This publishing window never opens a media socket until a test explicitly enables uploads.
async function start(f: Fixture) {
  const owner = await f.connect(0);
  assert.equal(
    (
      await owner.command({
        type: "publishLive",
        sourceId: "screen",
        uploadToken: f.uploadToken,
        kind: "screen",
        audio: true,
        video: true,
      })
    ).ok,
    true,
  );
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  assert.equal(
    (await owner.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok,
    true,
  );
  await until(() => !!f.receiver.load()?.livePeerId);
  f.receiver.report();
  await until(() => owner.state.player.status === "playing");
  return owner;
}
async function addOther(f: Fixture, owner: Client) {
  const other = await f.connect(2, "&audio=1&video=1");
  assert.equal(
    (await owner.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok,
    true,
  );
  await until(() => !!other.load()?.livePeerId);
  return other;
}
async function fallback(f: Fixture, owner: Client) {
  f.receiver.socket.send(
    JSON.stringify({
      type: "liveFailed",
      peerId: f.receiver.load()!.livePeerId,
      error: "Unreachable.",
    }),
  );
  await until(() => uploadRequested(owner));
  assert.equal(f.uploads.size, 0, "the publisher has no media socket to close");
}
// Await a command on the same connection to prove all preceding notifications were processed.
const barrier = (client: Client) =>
  client.command({ type: "sharing", sharing: { audio: false, video: false } });

test("upload failure validation bounds and redacts errors and discards unvalidated siblings", () => {
  const message = {
    type: "liveUploadFailed",
    sourceId: "screen",
    uploadId: "attempt-1",
    error:
      "Cannot record https://example.test/private?token=secret\nagain\u2028 " + "x".repeat(400),
    extra: "discard",
  };
  assert.deepEqual(parseLiveUploadFailed(JSON.stringify(message)), {
    type: "liveUploadFailed",
    sourceId: "screen",
    uploadId: "attempt-1",
    error: ("Cannot record example.test " + "x".repeat(400)).slice(0, 300),
  });
  for (const invalid of [
    null,
    [],
    {},
    { ...message, type: "liveFailed" },
    ...[undefined, "", "bad/source", "x".repeat(81), 5].flatMap((value) => [
      { ...message, sourceId: value },
      { ...message, uploadId: value },
    ]),
    ...[undefined, null, 7].map((error) => ({ ...message, error })),
  ]) {
    assert.equal(parseLiveUploadFailed(JSON.stringify(invalid)), null);
  }
  assert.equal(parseLiveUploadFailed("invalid JSON"), null);
});

test(
  "a pre-socket buffered failure leaves a healthy direct receiver playing, and Play explicitly retries",
  { timeout: 15_000 },
  async () => {
    const f = await liveFixture();
    try {
      const owner = await start(f),
        other = await addOther(f, owner);
      const peer = other.load()!.livePeerId,
        before = { loads: loads(other), messages: other.messages.length };
      await fallback(f, owner);
      fail(owner);
      await until(
        () =>
          owner.state.outputs?.find((output) => output.deviceId === f.receiver.id)?.error ===
            error && !uploadRequested(owner),
      );
      assert.equal(owner.state.player.status, "playing");
      assert.equal(owner.state.liveSources?.[0]?.id, "screen");
      assert.equal(loads(other), before.loads);
      assert.equal(other.load()!.livePeerId, peer);
      assert.equal(
        other.messages
          .slice(before.messages)
          .some((message) => message.type === "player" && message.command.type === "stop"),
        false,
      );
      const requested = owner.messages.filter(
        (message) => message.type === "livePeers" && message.upload,
      ).length;
      fail(owner); // An already-failed upload cannot retry itself through its failure callback.
      await barrier(owner);
      await barrier(owner);
      assert.equal(
        owner.messages.filter((message) => message.type === "livePeers" && message.upload).length,
        requested,
      );
      f.answerUploads(owner);
      assert.equal(
        (await owner.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok,
        true,
      );
      await until(() => !!f.receiver.load()?.hls && uploadRequested(owner));
      assert.equal((await fetch(f.receiver.load()!.source)).status, 200);
      assert.equal(loads(other), before.loads);
      assert.equal(other.load()!.livePeerId, peer);
      assert.equal(
        owner.state.outputs?.find((output) => output.deviceId === f.receiver.id)?.error,
        undefined,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "only the exact publisher can fail a requested upload; ended and unrequested source notifications are ignored",
  { timeout: 15_000 },
  async () => {
    const f = await liveFixture();
    try {
      const owner = await start(f);
      fail(owner); // There is no requested upload yet.
      await barrier(owner);
      assert.equal(owner.state.player.status, "playing");
      await fallback(f, owner);
      for (const device of [0, 2]) {
        const intruder = await f.connect(device);
        const closed = new Promise<number>((resolve) =>
          intruder.socket.once("close", (code) => resolve(code)),
        );
        fail(intruder, "screen", uploadRequest(owner)!.uploadId);
        assert.equal(
          await closed,
          1008,
          "another tab of the same Device has no publisher permission",
        );
        assert.equal(uploadRequested(owner), true);
        assert.equal(owner.state.liveSources?.[0]?.id, "screen");
      }
      assert.equal((await owner.command({ type: "endLive", sourceId: "screen" })).ok, true);
      assert.equal(
        (
          await owner.command({
            type: "publishLive",
            sourceId: "replacement",
            uploadToken: f.uploadToken,
            kind: "screen",
            audio: true,
            video: true,
          })
        ).ok,
        true,
      );
      assert.equal(
        (
          await owner.command({
            type: "playLive",
            sourceId: "replacement",
            deviceId: f.receiver.id,
          })
        ).ok,
        true,
      );
      await until(() => f.receiver.load()?.liveSourceId === "replacement");
      f.receiver.report();
      await until(() => owner.state.player.status === "playing");
      await fallback(f, owner);
      fail(owner, "screen");
      await barrier(owner);
      assert.equal(
        uploadRequested(owner),
        true,
        "an ended source cannot fail its replacement's pending upload",
      );
      assert.equal(owner.state.liveSources?.[0]?.id, "replacement");
      assert.notEqual(owner.state.player.status, "error");
      fail(owner, "replacement");
      await until(() => owner.state.player.status === "error" && !uploadRequested(owner));
    } finally {
      await f.close();
    }
  },
);

const clock = "The audio input's capture clock was interrupted.";
// A relaxed sound input played on the receiver, and its publishing window.
async function startSound(f: Fixture) {
  const owner = await f.connect(0);
  assert.equal(
    (
      await owner.command({
        type: "publishLive",
        sourceId: "mic",
        uploadToken: f.uploadToken,
        kind: "microphone",
        audio: true,
        video: false,
        audioDelivery: "pcm",
      })
    ).ok,
    true,
  );
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
  assert.equal(
    (await owner.command({ type: "playLive", sourceId: "mic", deviceId: f.receiver.id })).ok,
    true,
  );
  await until(() => uploadRequested(owner));
  return owner;
}
const failSound = (owner: Client) =>
  owner.socket.send(
    JSON.stringify({
      type: "liveUploadFailed",
      sourceId: "mic",
      uploadId: uploadRequest(owner)!.uploadId,
      error: clock,
    }),
  );

test("a sound input's failed upload ends the share while its speakers play it in step", async () => {
  const f = await liveFixture();
  try {
    const owner = await startSound(f);
    await until(() => !!owner.state.outputs?.length);
    failSound(owner);
    await until(() => !owner.state.liveSources?.length);
  } finally {
    await f.close();
  }
});

test(
  "a sound input's failed upload leaves its one speaker playing through the forwarding relay, and a second speaker says why it can't play",
  { timeout: 15_000 },
  async () => {
    const f = await liveFixture({ forwarding: true });
    try {
      const owner = await startSound(f);
      await until(() => !!f.receiver.load()?.livePeerId);
      f.receiver.report();
      await until(() => owner.state.player.status === "playing");
      const stops = () =>
        f.receiver.messages.filter(
          (message) => message.type === "player" && message.command.type === "stop",
        ).length;
      const stopped = stops();
      failSound(owner);
      await until(() => !uploadRequested(owner));
      await barrier(owner);
      assert.equal(owner.state.liveSources?.[0]?.id, "mic");
      assert.equal(owner.state.player.status, "playing");
      assert.equal(owner.state.outputs?.[0]?.error, undefined);
      assert.equal(stops(), stopped);

      const other = await f.connect(2, "&audio=1");
      assert.equal(
        (await owner.command({ type: "output", deviceId: other.id, level: 50 })).ok,
        true,
      );
      await until(
        () =>
          owner.state.outputs?.length === 2 &&
          owner.state.outputs.every((output) => output.error === clock),
      );
      assert.equal(owner.state.liveSources?.[0]?.id, "mic");
      assert.equal(uploadRequested(owner), false, "Core doesn't ask the failed upload again");
    } finally {
      await f.close();
    }
  },
);
