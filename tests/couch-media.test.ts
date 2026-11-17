import { expect, test } from "bun:test";
import type { Action } from "../src/shared/protocol";
import { CouchMedia, type CouchMediaSource } from "../src/client/session/couch-media";

// CouchMedia is what Video.js's controls drive on every device. These lock that every action reaches Core as the
// command Couch's controls always sent, and that the timeline holds a seek until Core's position reaches it.
const source = (patch: Partial<CouchMediaSource> = {}): CouchMediaSource => ({
  playbackId: "playback",
  entryId: "entry",
  status: "playing",
  buffering: false,
  failed: false,
  clock: { playbackId: "playback", position: 30, duration: 100, at: Date.now(), rate: 0 },
  length: 100,
  seekable: true,
  endless: false,
  speed: 1,
  volume: 50,
  muted: false,
  subtitles: [],
  loaded: null,
  local: null,
  ...patch,
});

function harness(initial = source()) {
  const sent: Action[] = [];
  const replies: ((accepted: boolean) => void)[] = [];
  const run = (action: Action) => {
    sent.push(action);
    return new Promise<boolean>((resolve) => replies.push(resolve));
  };
  let current = initial;
  const media = new CouchMedia(current, run);
  const at = (position: number, patch: Partial<CouchMediaSource> = {}) => {
    current = {
      ...current,
      ...patch,
      clock: { ...current.clock, position, at: Date.now() },
    };
    media.update(current, run);
  };
  const reply = async (index: number, accepted = true) => {
    replies[index]!(accepted);
    await Bun.sleep(0);
  };
  const seeks = () => sent.flatMap((action) => (action.type === "seek" ? [action.position] : []));
  return { media, sent, at, reply, seeks };
}

test("Play and Pause send Core's pause command, also while a started item buffers", () => {
  for (const [status, buffering] of [
    ["playing", false],
    ["loading", true],
    ["paused", false],
  ] as const) {
    const { media, sent } = harness(source({ status, buffering }));
    // What Video.js's Play button does on a press.
    if (media.paused) void media.play();
    else media.pause();
    expect(sent).toEqual([{ type: "pause", playbackId: "playback", paused: status !== "paused" }]);
  }
});

test("Play replays an ended item from the start and retries a failed one", () => {
  const ended = harness(source({ status: "ended" }));
  void ended.media.play();
  expect(ended.sent).toEqual([{ type: "play", entryId: "entry", fromStart: true }]);
  const failed = harness(source({ status: "error", failed: true }));
  void failed.media.play();
  expect(failed.sent).toEqual([{ type: "play", entryId: "entry", fromStart: false }]);
});

test("repeated seeks add up from the last target until Core's position reaches it", async () => {
  const { media, at, reply, seeks } = harness();
  media.currentTime = media.currentTime + 10;
  await reply(0);
  at(30);
  expect(media.currentTime).toBe(40);
  media.currentTime = media.currentTime + 10;
  expect(seeks()).toEqual([40, 50]);
  at(40);
  expect(media.currentTime).toBe(50);
  await reply(1);
  at(50.4);
  expect(media.seeking).toBe(false);
  expect(media.currentTime).toBeCloseTo(50.4);
  media.currentTime = 60;
  await reply(2, false);
  expect(media.currentTime).toBeCloseTo(50.4);
});

test("a drag shows its target and sends one seek on release", async () => {
  const { media, seeks } = harness();
  media.scrub(true);
  for (const time of [35, 50, 72]) media.currentTime = time;
  expect(seeks()).toEqual([]);
  expect(media.currentTime).toBe(72);
  media.scrub(false);
  await Bun.sleep(5);
  expect(seeks()).toEqual([72]);
});

test("choosing subtitles sends one track command to Core; Off sends none selected", async () => {
  const { media, sent } = harness(
    source({
      subtitles: [
        { id: "a", index: 0, kind: "subtitle", label: "English", language: "en", selected: true },
        { id: "b", index: 1, kind: "subtitle", label: "", language: "it", selected: false },
      ],
    }),
  );
  const [english, italian] = [...media.textTracks];
  expect(italian!.label).toBe("it");
  // Video.js shows one track and turns the others off in turn.
  italian!.mode = "showing";
  english!.mode = "disabled";
  await Bun.sleep(0);
  expect(sent).toEqual([{ type: "track", playbackId: "playback", kind: "subtitle", index: 1 }]);
  italian!.mode = "disabled";
  await Bun.sleep(0);
  expect(sent.at(-1)).toEqual({
    type: "track",
    playbackId: "playback",
    kind: "subtitle",
    index: -1,
  });
});

test("speed goes to Core, and an endless stream has no timeline to seek", () => {
  const { media, sent } = harness();
  media.playbackRate = 1.5;
  expect(sent).toEqual([{ type: "speed", playbackId: "playback", speed: 1.5 }]);
  const radio = harness(source({ endless: true, seekable: false, length: null }));
  expect(radio.media.duration).toBe(Infinity);
  expect(radio.media.seekable.length).toBe(0);
  expect(radio.media.streamType).toBe("live");
});
