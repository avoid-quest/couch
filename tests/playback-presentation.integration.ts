import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, type MediaSource } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { PlaybackCommand, SessionState } from "../src/shared/protocol";
import type { WebMediaSource } from "../src/server/web-media";
import { createSubtitles } from "../src/server/subtitles";

test("only explicit starts request a new picture presentation", async () => {
  const store = openStore(":memory:");
  let state: SessionState;
  const session = createSession(
    { ...store, ...store.playback("screen") },
    () => {},
    (next) => {
      state = structuredClone(next);
    },
    {
      resolveSource: (entry) => ({ source: entry.source.replace(/^web:/, "") }),
    },
  );
  const actor = { deviceId: "phone", name: "Phone" };
  const entry = (id: string) => ({ id, title: id, source: `web:https://media.example/${id}.mp4` });
  try {
    session.command({ type: "enqueue", entry: entry("one"), playNow: true }, undefined, actor);
    const first = state!.presentationId;
    assert.ok(first);
    session.command({ type: "enqueue", entry: entry("two"), playNow: false }, undefined, actor);
    session.command({ type: "next", playbackId: state!.player.playbackId! }, undefined, actor);
    assert.equal(state!.currentEntryId, "two");
    assert.equal(state!.presentationId, null, "Next must not pull a screen out of browsing");
    session.command({ type: "play", entryId: "one" }, undefined, actor);
    assert.ok(state!.presentationId);
    assert.notEqual(state!.presentationId, first, "explicit replay opens its picture again");
    session.command({ type: "enqueue", entry: entry("three"), playNow: false }, undefined, actor);
    session.observe({
      ...state!.player,
      status: "playing",
      position: 0,
      duration: 100,
      seekable: true,
    });
    const explicit = state!.presentationId;
    await session.command(
      { type: "videoQuality", playbackId: state!.player.playbackId!, quality: "720p" },
      undefined,
      actor,
    );
    assert.equal(state!.presentationId, explicit, "quality reload keeps the same presentation");
    session.observe({
      ...state!.player,
      status: "ended",
      position: 100,
      duration: 100,
      seekable: true,
    });
    assert.equal(state!.currentEntryId, "three");
    assert.equal(
      state!.presentationId,
      null,
      "automatic advance must not pull a screen out of browsing",
    );
  } finally {
    session.close();
    store.close();
  }
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const replacement: WebMediaSource = {
  source: "https://media.example/fresh.mp3?token=private",
  audioSource: "https://media.example/audio.mp3?token=private",
  publicNetwork: true,
  headers: { authorization: "private" },
  metadata: { title: "Replacement metadata", duration: 240 },
  expiry: { at: Date.now() + 60_000, recover: async () => null },
};

function recoveringSession(
  prepareRecoveredSource: (
    media: WebMediaSource,
    playbackId: string,
    signal: AbortSignal,
  ) => Promise<MediaSource>,
  beforeFailure?: (session: ReturnType<typeof createSession>) => void,
) {
  const store = openStore(":memory:");
  const recovery = Promise.withResolvers<WebMediaSource | null>();
  const commands: PlaybackCommand[] = [];
  let state: SessionState, recoverySignal: AbortSignal | undefined;
  const session = createSession(
    { ...store, ...store.playback("recovery") },
    (command) => commands.push(structuredClone(command)),
    (next) => {
      state = structuredClone(next);
    },
    {
      resolveSource: () => ({
        source: "http://127.0.0.1:3800/api/relay/original",
        expiry: {
          at: 0,
          recover: (signal) => {
            recoverySignal = signal;
            return recovery.promise;
          },
        },
      }),
      prepareRecoveredSource,
    },
  );
  session.command({
    type: "enqueue",
    entry: { id: "track", title: "Track", source: "web:https://artist.bandcamp.com/track/example" },
    playNow: true,
  });
  session.observe({
    ...state!.player,
    status: "paused",
    position: 37,
    duration: 240,
    seekable: true,
    speed: 1.25,
  });
  const originalId = state!.player.playbackId!,
    presentation = state!.presentationId;
  beforeFailure?.(session);
  session.observe({ ...state!.player, status: "error", error: "HTTP 410" });
  return {
    session,
    recovery,
    commands,
    originalId,
    presentation,
    get state() {
      return state!;
    },
    get recoverySignal() {
      return recoverySignal;
    },
    close() {
      session.close();
      store.close();
    },
  };
}

test("expiry recovery prepares public media for the new transport and sends only its protected sources", async () => {
  let prepared: { media: WebMediaSource; playbackId: string; signal: AbortSignal } | undefined;
  const f = recoveringSession(async (media, playbackId, signal) => {
    prepared = { media, playbackId, signal };
    return {
      ...media,
      source: `http://127.0.0.1:3800/api/relay/${playbackId}/video`,
      audioSource: `http://127.0.0.1:3800/api/relay/${playbackId}/audio`,
    };
  });
  try {
    f.recovery.resolve(replacement);
    await flush();
    assert.ok(prepared);
    assert.equal(prepared.media, replacement);
    assert.equal(prepared.media.publicNetwork, true);
    assert.notEqual(prepared.playbackId, f.originalId);
    assert.equal(prepared.playbackId, f.state.player.playbackId);
    assert.equal(prepared.signal, f.recoverySignal);
    assert.equal(prepared.signal.aborted, false);
    const loads = f.commands.filter((command) => command.type === "load");
    assert.equal(loads.length, 2);
    const loaded = loads[1]!;
    assert.equal(loaded.source, `http://127.0.0.1:3800/api/relay/${prepared.playbackId}/video`);
    assert.equal(
      loaded.audioSource,
      `http://127.0.0.1:3800/api/relay/${prepared.playbackId}/audio`,
    );
    assert.equal(loaded.playbackId, prepared.playbackId);
    assert.equal(loaded.startPosition, 37);
    assert.equal(loaded.paused, true);
    assert.equal(loaded.preferences?.speed, 1.25);
    for (const field of ["headers", "metadata", "expiry", "publicNetwork"])
      assert.equal(field in loaded, false);
    assert.equal(f.state.presentationId, f.presentation);
  } finally {
    f.close();
  }
});

test("a quality change while buffering retains the latest seek, pause and audio choice", async () => {
  const store = openStore(":memory:");
  const fresh = Promise.withResolvers<MediaSource>();
  const commands: PlaybackCommand[] = [];
  let resolves = 0;
  const session = createSession(
    { ...store, ...store.playback("buffered-quality") },
    (command) => commands.push(structuredClone(command)),
    () => {},
    {
      resolveSource: () =>
        resolves++ === 0 ? { source: "https://media.example/original.mp4" } : fresh.promise,
    },
  );
  try {
    session.command({
      type: "enqueue",
      entry: { id: "film", title: "Film", source: "web:https://media.example/film" },
      playNow: true,
    });
    session.observe({
      ...session.state.player,
      status: "loading",
      buffering: true,
      seekable: true,
      position: 30,
      duration: 120,
      tracks: [
        { id: "picture", kind: "video", index: 0, label: "Picture", selected: true },
        {
          id: "english",
          kind: "audio",
          index: 0,
          label: "English",
          language: "en",
          selected: true,
        },
        {
          id: "italian",
          kind: "audio",
          index: 1,
          label: "Italian",
          language: "it",
          selected: false,
        },
      ],
    });
    const playbackId = session.state.player.playbackId!;
    const changing = session.command({ type: "videoQuality", playbackId, quality: "480p" });
    session.command({ type: "seek", playbackId, position: 70 });
    session.command({ type: "pause", playbackId, paused: true });
    session.command({ type: "track", playbackId, kind: "audio", index: 1 });
    session.observe({ ...session.state.player, position: 31 });
    fresh.resolve({ source: "https://media.example/lower-quality.mp4" });
    await changing;
    const load = commands.findLast((command) => command.type === "load")!;
    assert.equal(load.source, "https://media.example/lower-quality.mp4");
    assert.equal(load.startPosition, 70);
    assert.equal(load.paused, true);
    assert.equal(load.audioTrack, 1);
    assert.notEqual(load.playbackId, playbackId);
  } finally {
    session.close();
    store.close();
  }
});

for (const newerSeek of ["none", "absolute", "relative"] as const)
  test(`expiry recovery retains seek and tracks with ${newerSeek} seeking during resolution`, async () => {
    const subtitle = { source: "https://media.example/custom.vtt", title: "Custom captions" };
    const f = recoveringSession(
      async (media) => media,
      (session) => {
        session.observe({
          ...session.state.player,
          subtitleDelay: 2,
          tracks: [
            {
              id: "english",
              kind: "audio",
              index: 0,
              label: "English",
              language: "en",
              selected: true,
            },
            {
              id: "italian",
              kind: "audio",
              index: 1,
              label: "Italian",
              language: "it",
              selected: false,
            },
            {
              id: "captions",
              kind: "subtitle",
              index: 2,
              label: "Custom captions",
              selected: true,
            },
          ],
        });
        const playbackId = session.state.player.playbackId!;
        session.addSubtitle(playbackId, subtitle);
        session.command({ type: "seek", playbackId, position: 70 });
        session.command({ type: "track", playbackId, kind: "audio", index: 1 });
      },
    );
    try {
      if (newerSeek !== "none") {
        f.session.command({
          type: "seek",
          playbackId: f.state.player.playbackId!,
          position: newerSeek === "relative" ? 10 : 80,
          relative: newerSeek === "relative",
        });
        f.session.command({ type: "pause", playbackId: f.state.player.playbackId!, paused: false });
      }
      f.recovery.resolve(replacement);
      await flush();
      const load = f.commands.findLast((command) => command.type === "load")!;
      assert.equal(load.startPosition, newerSeek !== "none" ? 80 : 70);
      assert.equal(load.paused, newerSeek === "none");
      assert.equal(load.audioTrack, 1);
      assert.equal(load.subtitleTrack, 2);
      assert.equal(load.subtitleDelay, 2);
      assert.deepEqual(load.subtitles, [subtitle]);
    } finally {
      f.close();
    }
  });

test("uploaded subtitles survive the retired Stop acknowledgement during expiry recovery", async () => {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  const recovery = Promise.withResolvers<WebMediaSource | null>();
  let session: ReturnType<typeof createSession>;
  const subtitles = createSubtitles(
    (id) => (session.state.player.playbackId === id ? session.state.player : undefined),
    (id, subtitle) => session.addSubtitle(id, subtitle),
  );
  session = createSession(
    { ...store, ...store.playback("subtitle-recovery") },
    (command) => commands.push(structuredClone(command)),
    () => {},
    {
      resolveSource: () => ({
        source: "https://media.example/original.mp4",
        expiry: { at: 0, recover: () => recovery.promise },
      }),
      prepareRecoveredSource: async (media) => media,
      observe: (player) => subtitles.observe(player),
      stopped: (id) => subtitles.stopped(id),
      moved: (from, to) => subtitles.moved(from, to),
    },
  );
  try {
    session.command({
      type: "enqueue",
      entry: { id: "film", title: "Film", source: "web:https://media.example/film" },
      playNow: true,
    });
    session.observe({
      ...session.state.player,
      status: "playing",
      position: 30,
      duration: 120,
      seekable: true,
    });
    const uploaded = await subtitles.handle(
      new Request(
        `http://couch/api/subtitles?playbackId=${session.state.player.playbackId}&name=custom.vtt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCaption\n",
        },
      ),
    );
    assert.equal(uploaded.status, 200);
    const added = commands.findLast((command) => command.type === "addSubtitle")!;
    const url = new URL(added.source, "http://couch");
    assert.equal((await subtitles.serve(url)).status, 200);
    session.observe({ ...session.state.player, status: "error", error: "HTTP 410" });
    session.observe({ ...session.state.player, playbackId: null, status: "idle" });
    assert.equal((await subtitles.serve(url)).status, 200);
    recovery.resolve(replacement);
    await flush();
    assert.equal((await subtitles.serve(url)).status, 200);
    const load = commands.findLast((command) => command.type === "load")!;
    assert.deepEqual(load.subtitles, [{ source: added.source, title: "custom.vtt" }]);
  } finally {
    session.close();
    subtitles.close();
    store.close();
  }
});
