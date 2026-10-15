import { test } from "node:test";
import assert from "node:assert/strict";
import { showsPicture } from "../src/client/session/device-id";
import { isAudioOnly } from "../src/client/sections/now/player-presentation";
import type { MediaTrack, SessionState } from "../src/shared/protocol";
import { liveFixture, until } from "./live-input.fixture";

const audio: MediaTrack = { id: "audio", index: 0, kind: "audio", label: "Audio", language: "", selected: true };
const video: MediaTrack = { id: "video", index: 1, kind: "video", label: "Video", language: "", selected: true };
const audioOnly = (state: SessionState) => isAudioOnly(
  state.playbacks?.find(playback => playback.id === state.playback),
  state.queue.find(entry => entry.id === state.currentEntryId),
  state.player.tracks,
);

for (const sound of [true, false]) {
  test(`sound-only first, then ${sound ? "AV" : "picture-only"}: keep audio reports and show the live picture`, { timeout: 10_000 }, async () => {
    const f = await liveFixture({ local: true });
    try {
      await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
      await f.publish("screen");
      assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
      await until(() => !!f.receiver.load()?.livePeerId);
      assert.equal(f.receiver.load()!.liveOutput!.picture, false);
      f.receiver.report({ tracks: [audio] });
      await until(() => f.receiver.state.player.tracks?.length === 1);

      const picture = await f.connect(3, `&audio=${sound ? 1 : 0}&video=1`);
      assert.equal((await f.publisher.command({ type: "output", deviceId: picture.id, level: sound ? 50 : undefined, picture: true })).ok, true);
      await until(() => !!picture.load()?.livePeerId);
      assert.equal(picture.load()!.liveOutput!.picture, true);
      assert.equal(picture.load()!.liveOutput!.sound, sound);
      picture.report({ tracks: sound ? [audio, video] : [video] });
      // A command on the same socket is a barrier after its report.
      await picture.command({ type: "volume", deviceId: picture.id, volume: 38 });
      await until(() => picture.state.devices?.find(device => device.id === picture.id)?.volume === 38);
      assert.deepEqual(picture.state.player.tracks, [audio], "the original renderer still describes the playing sound");
      assert.equal(showsPicture(picture.state), true);
      assert.equal(audioOnly(picture.state), false, "PlayerPage must use the source's picture, not the sound-only renderer's tracks");

      const updatedAudio = { ...audio, label: "Receiver audio" };
      f.receiver.report({ tracks: [updatedAudio] });
      await until(() => picture.state.player.tracks?.[0]?.label === updatedAudio.label);
      assert.deepEqual(picture.state.player.tracks, [updatedAudio]);
      assert.equal(audioOnly(picture.state), false);

      // Losing the local picture still selects artwork via showsPicture.
      assert.equal((await f.publisher.command({ type: "output", deviceId: picture.id, level: sound ? 50 : undefined, picture: false })).ok, true);
      await until(() => !showsPicture(picture.state));
    } finally { await f.close(); }
  });
}

test("a genuinely audio-only live source keeps PlayerPage's audio presentation", { timeout: 10_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await f.publish("microphone", "microphone");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "microphone", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.livePeerId);
    assert.equal(audioOnly(f.receiver.state), true, "source metadata works before tracks arrive");
    f.receiver.report({ tracks: [audio] });
    await until(() => f.receiver.state.player.tracks?.length === 1);
    assert.equal(audioOnly(f.receiver.state), true);
  } finally { await f.close(); }
});

test("ordinary playback preserves radio, source and selected-track inference", () => {
  const film = { id: "film", title: "Film", source: "web:https://media.example/film.mp4" };
  assert.equal(isAudioOnly(undefined, undefined, undefined), false);
  assert.equal(isAudioOnly(undefined, film, undefined), false);
  assert.equal(isAudioOnly(undefined, film, [audio]), true);
  assert.equal(isAudioOnly(undefined, film, [audio, video]), false);
  assert.equal(isAudioOnly(undefined, film, [audio, { ...video, selected: false }]), true);
  assert.equal(isAudioOnly(undefined, { ...film, live: true }, [audio]), true, "ordinary live TV retains track inference");
  assert.equal(isAudioOnly(undefined, { ...film, source: "radio:station" }, undefined), true);
  assert.equal(isAudioOnly(undefined, { ...film, kind: "radio" }, [audio, video]), true);
  assert.equal(isAudioOnly({ id: "p", title: null, status: "playing", outputs: [], audioOnly: true }, film, [audio, video]), true);
  assert.equal(isAudioOnly({ id: "p", title: null, status: "playing", outputs: [], audioOnly: false }, film, [audio]), true);
});
