import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const entry = (id: string) => ({ id, title: id, source: `web:https://media.example/${id}.mp4` });

test("playing an Autoplay pick keeps queued items and continues after the chosen pick", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("autoplay");
  const loads: string[] = [];
  const session = createSession(
    { ...store, ...playback },
    (command) => {
      if (command.type === "load") loads.push(command.source);
    },
    () => {},
    {
      resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }),
      resolveContinuation: () => ({
        title: "Series",
        entries: [entry("one"), entry("two"), entry("three")],
      }),
    },
  );
  try {
    session.command({ type: "enqueue", entry: entry("pilot"), playNow: true });
    await flush();
    session.command({ type: "enqueue", entry: entry("manually-queued") });
    const before = session.state;
    assert.throws(
      () =>
        session.command({ type: "play", entryId: "two" }, () => {
          throw new Error("Not authorized");
        }),
      /Not authorized/,
    );
    assert.deepEqual(session.state, before);
    session.command({
      type: "preferences",
      profileId: session.state.activeProfile.id,
      preferences: { autoplay: false },
    });
    assert.throws(() => session.command({ type: "play", entryId: "two" }), /no longer exists/);
    session.command({
      type: "preferences",
      profileId: session.state.activeProfile.id,
      preferences: { autoplay: true },
    });
    session.command({ type: "play", entryId: "two" });
    assert.equal(session.state.currentEntryId, "two");
    assert.deepEqual(
      session.state.queue.map((item) => item.id),
      ["pilot", "two", "manually-queued"],
    );
    assert.deepEqual(
      session.state.autoplay?.upcoming.map((item) => item.id),
      ["three"],
    );
    assert.deepEqual(
      playback.playbackContinuation()?.entries.map((item) => item.id),
      ["three"],
    );
    assert.equal(loads.at(-1), "https://media.example/two.mp4");

    // Manual entries still play before the rest of the collection.
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    assert.equal(session.state.currentEntryId, "manually-queued");
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    assert.equal(session.state.currentEntryId, "three");
    assert.equal(loads.at(-1), "https://media.example/three.mp4");
    assert.equal(session.state.queue.filter((item) => item.id === "two").length, 1);
    assert.throws(() => session.command({ type: "play", entryId: "one" }), /no longer exists/);
  } finally {
    session.close();
    store.close();
  }
});

test("playing an Autoplay pick cannot evict a waiting entry from a full queue", async () => {
  const store = openStore(":memory:");
  const session = createSession(
    { ...store, ...store.playback("autoplay") },
    () => {},
    () => {},
    {
      resolveSource: (item) => ({ source: item.source }),
      resolveContinuation: () => ({ title: "Series", entries: [entry("suggestion")] }),
    },
  );
  try {
    session.command({ type: "enqueue", entry: entry("pilot"), playNow: true });
    await flush();
    session.loadQueue(
      Array.from({ length: 499 }, (_, index) => entry(`waiting-${index}`)),
      "append",
    );
    const before = session.state;
    assert.throws(
      () => session.command({ type: "play", entryId: "suggestion" }),
      /Up next is full/,
    );
    assert.deepEqual(session.state, before);
  } finally {
    session.close();
    store.close();
  }
});

test("playing an Autoplay pick makes room in a full queue by retiring only played history", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("autoplay");
  const session = createSession(
    { ...store, ...playback },
    () => {},
    () => {},
    {
      resolveSource: (item) => ({ source: item.source }),
      resolveContinuation: () => ({
        title: "Series",
        entries: [entry("suggestion"), entry("following")],
      }),
    },
  );
  try {
    session.loadQueue(
      Array.from({ length: 500 }, (_, index) => entry(`episode-${index}`)),
      "replace",
    );
    const queue = session.state.queue;
    session.command({ type: "play", entryId: queue[0]!.id });
    session.command({ type: "next", playbackId: session.state.player.playbackId! });
    await flush();
    session.command({ type: "play", entryId: "suggestion" });
    assert.equal(session.state.currentEntryId, "suggestion");
    assert.equal(session.state.queue.length, 500);
    assert.deepEqual(
      session.state.queue.map((item) => item.id),
      [queue[1]!.id, "suggestion", ...queue.slice(2).map((item) => item.id)],
    );
    assert.deepEqual(
      store.playback("autoplay").queue.map((item) => item.id),
      session.state.queue.map((item) => item.id),
    );
    assert.deepEqual(
      session.state.autoplay?.upcoming.map((item) => item.id),
      ["following"],
    );
  } finally {
    session.close();
    store.close();
  }
});

test("Up next pages through the whole Autoplay list, and any of it plays", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("whole");
  const session = createSession(
    { ...store, ...playback },
    () => {},
    () => {},
    {
      resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }),
      resolveContinuation: () => ({
        title: "Playlist",
        entries: Array.from({ length: 60 }, (_, index) => entry(`track-${index}`)),
      }),
    },
  );
  try {
    session.command({ type: "enqueue", entry: entry("opening"), playNow: true });
    await flush();
    assert.equal(session.state.autoplay?.upcoming.length, 10);
    assert.equal(session.state.autoplay?.total, 60);
    const page = session.autoplayPage(50);
    assert.deepEqual(
      page.entries.map((item) => item.id),
      Array.from({ length: 10 }, (_, index) => `track-${50 + index}`),
    );
    assert.equal(page.total, 60);
    session.command({ type: "play", entryId: "track-55" });
    assert.equal(session.state.currentEntryId, "track-55");
    assert.equal(session.state.autoplay?.total, 4);
  } finally {
    session.close();
    store.close();
  }
});

test("a Play waiting for its list outlasts Autoplay moving on, and Stop or Next cancels it", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("reserved");
  let state = undefined as ReturnType<typeof createSession>["state"] | undefined;
  const session = createSession(
    { ...store, ...playback },
    () => {},
    (next) => (state = next),
    {
      resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }),
      resolveContinuation: () => ({ title: "Collection", entries: [entry("following")] }),
    },
  );
  const ended = () =>
    session.observe({ ...state!.player, status: "ended", position: 100, duration: 100 });
  try {
    session.command({ type: "enqueue", entry: entry("playing"), playNow: true });
    await flush();
    const intent = session.reservePlay();
    ended();
    assert.equal(state!.currentEntryId, "following");
    session.playNewEntries([entry("wishlist")], { intent });
    assert.equal(state!.currentEntryId, "wishlist");

    const stopped = session.reservePlay();
    session.command({ type: "stop" });
    assert.throws(() => session.playNewEntries([entry("late")], { intent: stopped }), /canceled/);
    const reset = session.reservePlay();
    session.viewing(state!.activeProfile, state!.preferences, true);
    assert.throws(() => session.playNewEntries([entry("late")], { intent: reset }), /canceled/);
    session.command({ type: "enqueue", entry: entry("again"), playNow: true });
    const skipped = session.reservePlay();
    session.command({ type: "next", playbackId: state!.player.playbackId! });
    assert.throws(() => session.playNewEntries([entry("late")], { intent: skipped }), /canceled/);
  } finally {
    session.close();
    store.close();
  }
});

test("a list read in parts extends the Autoplay it started, and nothing that replaced it", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("parts");
  const session = createSession(
    { ...store, ...playback },
    () => {},
    () => {},
    { resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }) },
  );
  try {
    session.playNewEntries([entry("first")], {
      continuation: { title: "Collection", entries: [entry("second")] },
    });
    assert.equal(
      await session.extendContinuation("second", Promise.resolve([entry("third")])),
      true,
    );
    assert.deepEqual(
      playback.playbackContinuation()?.entries.map((item) => item.id),
      ["second", "third"],
    );
    session.playNewEntries([entry("other")], {
      continuation: { title: "Other", entries: [entry("after")] },
    });
    assert.equal(
      await session.extendContinuation("third", Promise.resolve([entry("late")])),
      false,
    );
    assert.deepEqual(
      session.state.autoplay?.upcoming.map((item) => item.id),
      ["after"],
    );
  } finally {
    session.close();
    store.close();
  }
});

test("a list whose first part ends, or is skipped past, before its later part comes plays on with it", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("late-part");
  let state = undefined as ReturnType<typeof createSession>["state"] | undefined;
  const session = createSession(
    { ...store, ...playback },
    () => {},
    (next) => (state = next),
    { resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }) },
  );
  const ended = () =>
    session.observe({
      ...state!.player,
      status: "ended",
      position: 100,
      duration: 100,
    });
  const part = () => {
    let deliver!: (entries: ReturnType<typeof entry>[]) => void;
    return {
      later: new Promise<ReturnType<typeof entry>[]>((done) => (deliver = done)),
      deliver,
    };
  };
  try {
    session.playNewEntries([entry("first")], {
      continuation: { title: "Collection", entries: [entry("second")] },
    });
    await flush();
    const rest = part();
    const extended = session.extendContinuation("second", rest.later);
    ended();
    assert.equal(state!.currentEntryId, "second");
    ended();
    assert.equal(state!.player.status, "ended");
    assert.equal(state!.autoplay?.pending, true);
    rest.deliver([entry("third"), entry("fourth")]);
    assert.equal(await extended, true);
    assert.equal(state!.currentEntryId, "third");

    const more = part();
    const skipped = session.extendContinuation("fourth", more.later);
    session.command({ type: "next", playbackId: state!.player.playbackId! });
    session.command({ type: "next", playbackId: state!.player.playbackId! });
    assert.equal(state!.currentEntryId, "fourth");
    more.deliver([entry("fifth")]);
    assert.equal(await skipped, true);
    assert.equal(state!.currentEntryId, "fifth");
  } finally {
    session.close();
    store.close();
  }
});

test("a queued item played after a list's last loaded item keeps the list's later part", async () => {
  const store = openStore(":memory:");
  const playback = store.playback("queued-part");
  let state = undefined as ReturnType<typeof createSession>["state"] | undefined;
  const session = createSession(
    { ...store, ...playback },
    () => {},
    (next) => (state = next),
    { resolveSource: (item) => ({ source: item.source.replace(/^web:/, "") }) },
  );
  const ended = () =>
    session.observe({ ...state!.player, status: "ended", position: 100, duration: 100 });
  try {
    session.playNewEntries([entry("first")], {
      continuation: { title: "Collection", entries: [entry("second")] },
    });
    await flush();
    let deliver!: (entries: ReturnType<typeof entry>[]) => void;
    const extended = session.extendContinuation("second", new Promise((done) => (deliver = done)));
    ended();
    assert.equal(state!.currentEntryId, "second");
    session.command({ type: "enqueue", entry: entry("queued") });
    ended();
    assert.equal(state!.currentEntryId, "queued");
    deliver([entry("third")]);
    assert.equal(await extended, true);
    assert.deepEqual(
      state!.autoplay?.upcoming.map((item) => item.id),
      ["third"],
    );
    ended();
    assert.equal(state!.currentEntryId, "third");
  } finally {
    session.close();
    store.close();
  }
});
