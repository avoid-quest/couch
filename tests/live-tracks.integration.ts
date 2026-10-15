import { test } from "node:test";
import assert from "node:assert/strict";
import { showsPicture } from "../src/client/session/device-id";
import type { MediaTrack } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

const audio: MediaTrack = { id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true };
const video: MediaTrack = { id: "video", index: 1, kind: "video", label: "Video", language: "", selected: true };

test("a live picture receiver reports shared video tracks even when a sound-only receiver joined first", { timeout: 10_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.livePeerId);
    assert.equal(f.receiver.load()!.liveOutput!.picture, false);
    f.receiver.report({ tracks: [audio] });
    await until(() => f.receiver.state.player.tracks?.length === 1);

    const picture = await f.connect(3, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: picture.id, level: 50, picture: true })).ok, true);
    await until(() => !!picture.load()?.livePeerId);
    assert.equal(picture.load()!.liveOutput!.picture, true);
    picture.report({ tracks: [audio, video] });
    // Assert the actual state consumed by PlayerPage, not a copy of its audioOnly predicate.
    await until(() => picture.state.player.tracks?.some(track => track.kind === "video" && track.selected) === true);
    assert.equal(picture.state.playbacks?.find(playback => playback.id === picture.state.playback)?.audioOnly, false);
    assert.equal(showsPicture(picture.state), true);

    // A later sound-only report must not remove the shared picture's tracks.
    f.receiver.report({ tracks: [audio], position: 12 });
    await f.receiver.command({ type: "volume", volume: 37 });
    await until(() => picture.state.devices?.find(device => device.id === f.receiver.id)?.volume === 37);
    assert.deepEqual(picture.state.player.tracks, [audio, video]);

    // Removing this device's picture restores its local artwork presentation and
    // lets the remaining sound-only renderer report again.
    assert.equal((await f.publisher.command({ type: "output", deviceId: picture.id, level: 50, picture: false })).ok, true);
    await until(() => picture.load()?.liveOutput?.picture === false && !showsPicture(picture.state));
    f.receiver.report({ tracks: [audio] });
    await until(() => picture.state.player.tracks?.length === 1);
    assert.deepEqual(picture.state.player.tracks, [audio]);
  } finally { await f.close(); }
});
