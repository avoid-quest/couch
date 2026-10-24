import { describe, expect, test } from "bun:test";
import { playbackActionAllowed, playbackControls, playbackDelivery } from "../src/shared/playback-policy";
import { parseCommand, parsePlayer } from "../src/server/validation";
import type { Action } from "../src/shared/protocol";
import type { LiveSource } from "../src/shared/live-input";

const source: LiveSource = { id: "input", deviceId: "publisher", name: "Mix", kind: "microphone", audio: true, video: false };
const speaker = { deviceId: "speaker", picture: false, sound: true };

describe("Core playback policy", () => {
  test("split picture/sound shares a clock, independent Direct playback does not", () => {
    expect(playbackDelivery({ outputs: [speaker] })).toBe("direct");
    expect(playbackDelivery({ outputs: [speaker, { deviceId: "tv", picture: true, sound: false }] })).toBe("scheduled");
    expect(playbackDelivery({ outputs: [{ ...speaker, picture: true }] })).toBe("direct");
    expect(playbackDelivery({ outputs: [{ ...speaker, sound: false }] })).toBe("direct");
  });

  test("timestamped inputs keep fixed delivery at one or zero audience devices", () => {
    for (const outputs of [[speaker], []]) {
      expect(playbackDelivery({ source: { ...source, intent: "live", audioDelivery: "pcm" }, outputs })).toBe("scheduled");
      expect(playbackDelivery({ source: { ...source, audioDelivery: "pcm" }, outputs })).toBe("scheduled");
    }
    expect(playbackDelivery({ source, outputs: [speaker] })).toBe("webrtc");
    expect(playbackDelivery({ source: { ...source, video: true }, outputs: [speaker, { ...speaker, deviceId: "tv" }], inSync: true })).toBe("scheduled");
  });

  test("audience reception never grants programme rights, including legacy actions", () => {
    const listener = playbackControls({ intent: "live", authorized: true, receiving: true, seekable: true, scheduled: true });
    const mutations: Action[] = [
      { type: "pause", playbackId: "p", paused: true }, { type: "stop" }, { type: "next", playbackId: "p" },
      { type: "seek", playbackId: "p", position: 10 }, { type: "speed", playbackId: "p", speed: 2 },
      { type: "audioDelay", playbackId: "p", delay: 0.1 }, { type: "subtitleDelay", playbackId: "p", delay: 0.1 },
      { type: "inSync", inSync: false }, { type: "allSpeakers", level: 0 }, { type: "solo", deviceId: "me" },
      { type: "volume", volume: 0 }, { type: "mute", muted: true }, { type: "remove", entryId: "e" },
      { type: "enqueue", entry: { id: "e", title: "New programme", source: "https://example.com/a.mp3" } },
    ];
    for (const action of mutations) expect(playbackActionAllowed(action, listener)).toBe(false);
    expect(playbackActionAllowed({ type: "leave", playbackId: "p" }, listener)).toBe(true);
    expect(playbackActionAllowed({ type: "volume", deviceId: "me", volume: 0 }, listener)).toBe(true);
    expect(playbackActionAllowed({ type: "mute", deviceId: "me", muted: true }, listener)).toBe(true);
    expect(playbackControls({ intent: "live", authorized: true, receiving: false }).leave).toBe(false);
  });

  test("relaxed collaboration retains queue and supported transport controls", () => {
    const direct = playbackControls({ authorized: true, receiving: false, seekable: true, audioDelay: 0 });
    expect(direct).toMatchObject({ programme: true, queue: true, seek: true, speed: true, audioDelay: true, leave: false });
    expect(playbackControls({ authorized: true, receiving: true, scheduled: true, seekable: true }).audioDelay).toBe(false);
    expect(playbackControls({ authorized: true, receiving: true }).audioDelay).toBe(false);
    expect(playbackControls({ authorized: false, receiving: true }).programme).toBe(false);
    expect(playbackControls({ authorized: true, receiving: true, mpv: true }).subtitleDelay).toBe(false);
  });
});

test("wire validation rejects live video/legacy ingestion and carries runtime intent", () => {
  const envelope = (action: unknown) => JSON.stringify({ type: "command", requestId: "r", action });
  const publication = { type: "publishLive", sourceId: "input", uploadToken: "a".repeat(64), kind: "microphone", audio: true, video: false, intent: "live", audioDelivery: "pcm" };
  expect(parseCommand(envelope(publication)).action).toMatchObject({ intent: "live", audioDelivery: "pcm" });
  for (const patch of [{ video: true }, { audio: false }, { audioDelivery: "recorder" }, { intent: "instant" }]) expect(() => parseCommand(envelope({ ...publication, ...patch }))).toThrow();
  expect(parseCommand(envelope({ type: "playLive", sourceId: "input", picture: false, sound: true })).action).toMatchObject({ picture: false, sound: true });
  expect(parseCommand(envelope({ type: "leave", playbackId: "p" })).action.type).toBe("leave");
  expect(() => parseCommand(envelope({ type: "leave" }))).toThrow();
});

test("picture mapping limitations are bounded runtime reports", () => {
  const report = { type: "player", state: { playbackId: "p", status: "playing", buffering: false, position: 1, duration: null, volume: 50, seekable: false, speed: 1, error: null, timeline: { mapping: "unavailable", error: "Native HLS has no PTS mapping." } } };
  expect(parsePlayer(JSON.stringify(report))?.timeline).toEqual(report.state.timeline);
  expect(parsePlayer(JSON.stringify({ ...report, state: { ...report.state, timeline: { mapping: "invented" } } }))).toBeNull();
});
