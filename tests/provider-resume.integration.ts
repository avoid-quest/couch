import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/server/validation";
import { createSession } from "../src/server/session";
import { playbackMediaId } from "../src/server/progress";
import { openStore } from "../src/server/store";
import { createCatalog, type Viewing } from "../src/server/catalog";
import { createContinuationResolver } from "../src/server/continuation";
import { ControllerError } from "../src/server/devices";
import type { PlaybackCommand, QueueEntry, SessionState } from "../src/shared/protocol";

const url = "https://www.youtube.com/watch?v=abcdefghijk";
const collection = { title: "Selected list", url: "https://www.youtube.com/playlist?list=PLselected123", index: 2 };
const action = { type: "enqueueProvider", provider: "youtube", url, shape: "atom", title: "Video", playNow: true, quality: "720p", collection, deviceId: "tv" };
const parse = (fields: Record<string, unknown> = {}) => parseCommand(JSON.stringify({ type: "command", requestId: "resume", action: { ...action, ...fields } }));

test("provider playback retains explicit resume/start intent with occurrence, quality and destination", () => {
  for (const fromStart of [false, true]) {
    const command = parse({ fromStart });
    assert.equal(command.type, "command");
    assert.deepEqual(command.action, { ...action, fromStart });
  }
  assert.deepEqual(parse().action, action, "ordinary Play must not gain restart intent");
});

// Public history deliberately canonicalizes aliases without changing their stored ID.
// Resume must round-trip that ID, then apply the selected occurrence to the saved source.
for (const source of [url, "https://youtu.be/abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk"])
for (const fromStart of [false, true]) test(`history ${source} ${fromStart ? "restarts" : "resumes"} in a new occurrence`, async () => {
  const store = openStore(":memory:"), commands: PlaybackCommand[] = [];
  const previous: QueueEntry = { id: "previous", source: `web:${source}`, title: "Video", quality: "480p", collection: { ...collection, index: 0 } };
  const mediaId = playbackMediaId(previous)!;
  store.saveProgress(store.activeProfile().id, { mediaId, title: previous.title, position: 45, duration: 100, watched: false, lastPlayedAt: 1 }, previous);
  store.playback("history").saveQueue([previous]);
  const session = createSession({ ...store, ...store.playback("history") }, command => commands.push(command), () => {}, {
    resolveSource: entry => ({ source: entry.source.slice(4) }),
  });
  const catalog = createCatalog({ radio: {} as Parameters<typeof createCatalog>[0]["radio"], viewing: { store, session: session as unknown as Viewing } });
  try {
    const response = await catalog.handle(new Request("http://couch.local/api/progress/history"), false);
    const history = (await response.json()).items[0];
    assert.equal(history.url, url);
    assert.equal(history.mediaId, mediaId);
    assert.equal(history.source, undefined);
    const played = await catalog.handle(new Request(`http://couch.local/api/progress/${encodeURIComponent(history.mediaId)}/play`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: store.activeProfile().id, fromStart, selection: { collection, quality: "720p" } }),
    }), false);
    assert.equal(played.status, 200, JSON.stringify(await played.json()));
    await new Promise<void>(resolve => setImmediate(resolve));
    const load = commands.find(command => command.type === "load");
    assert.ok(load, "Session must issue a player load");
    assert.equal(load.startPosition ?? 0, fromStart ? 0 : 45);
    const current = session.state.queue.find(entry => entry.id === session.state.currentEntryId)!;
    assert.equal(current.source, previous.source);
    assert.equal(playbackMediaId(current), mediaId);
    assert.deepEqual(current.collection, collection);
    assert.equal(current.quality, "720p");
    assert.notEqual(current.id, previous.id);
    assert.deepEqual(session.state.queue.find(entry => entry.id === previous.id), previous, "A selected occurrence must not rewrite its earlier queue occurrence");
    assert.deepEqual(store.historySource(mediaId), previous, "Playback must not rewrite saved history before a player report");
    session.observe({ ...session.state.player, status: "paused", position: 52, duration: 100, seekable: true });
    assert.equal(store.sharedProgress(mediaId)?.position, 52, "Reports must continue saving against the historical media ID");
    assert.equal(store.sharedHistory().length, 1, "Resume must not split history into an alias and canonical row");
  } finally { session.close(); store.close(); }
});

test("alias history continues after the selected duplicate in its canonical playlist", async () => {
  const items = [url, "https://www.youtube.com/watch?v=other000001", url, "https://www.youtube.com/watch?v=other000002"]
    .map((url, index) => ({ id: String(index), provider: "youtube" as const, kind: "media" as const, title: `Occurrence ${index}`, url }));
  const resolve = createContinuationResolver(async () => ({ title: collection.title, items }));
  for (const source of [url, "https://youtu.be/abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk"]) {
    const next = await resolve({ id: "selected", source: `web:${source}`, title: "Video", collection }, new AbortController().signal);
    assert.deepEqual(next?.entries.map(entry => entry.source), [`web:${items[3]!.url}`], source);
    assert.equal(next?.entries[0]?.collection?.index, 3);
  }
});

test("history selection validates context and preserves profile, authorization and queue guards", async () => {
  const store = openStore(":memory:"), commands: PlaybackCommand[] = [];
  const previous: QueueEntry = { id: "previous", source: "web:https://youtu.be/abcdefghijk", title: "Video", collection: { ...collection, index: 0 } };
  const mediaId = playbackMediaId(previous)!;
  store.saveProgress(store.activeProfile().id, { mediaId, title: previous.title, position: 45, duration: 100, watched: false, lastPlayedAt: 1 }, previous);
  const queue = [previous, ...Array.from({ length: 499 }, (_, index) => ({ id: `waiting-${index}`, source: `https://example.com/${index}.mp4`, title: `Waiting ${index}` }))];
  store.playback("guards").saveQueue(queue);
  const session = createSession({ ...store, ...store.playback("guards") }, command => commands.push(command), () => {}, {
    resolveSource: entry => ({ source: entry.source.slice(4) }),
  });
  const catalog = createCatalog({ radio: {} as Parameters<typeof createCatalog>[0]["radio"], viewing: { store, session: session as unknown as Viewing } });
  const request = (changes: Record<string, unknown>, authorize?: () => void) => catalog.handle(new Request(`http://couch.local/api/progress/${encodeURIComponent(mediaId)}/play`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: store.activeProfile().id, ...changes }),
  }), false, authorize);
  try {
    for (const selection of [null, [], {}, { collection: { ...collection, index: -1 } }, { collection: { ...collection, index: 2.5 } }, { collection: { ...collection, index: 5000 } },
      { collection: { ...collection, title: "" } }, { collection: { ...collection, url: "https://soundcloud.com/artist/set" } },
      { collection: { ...collection, parent: { title: "Other source", url: "https://soundcloud.com/artist" } } },
      { collection, quality: "invalid" }, { collection, source: url }]) {
      assert.equal((await request({ selection })).status, 400, JSON.stringify(selection));
    }
    assert.equal((await request({ selection: { collection }, profileId: "old-profile" })).status, 409);
    let checks = 0;
    const denied = await request({ selection: { collection } }, () => { checks++; throw new ControllerError("Controller no longer available", 403); });
    assert.equal(denied.status, 403);
    assert.equal(checks, 1);
    assert.equal((await request({ selection: { collection } })).status, 409, "A new occurrence still needs queue capacity");
    assert.deepEqual(session.state.queue, queue, "Rejected context must leave existing occurrences and waiting entries intact");
    assert.equal(commands.length, 0);
    assert.equal((await request({})).status, 200, "Ordinary history may reuse its existing occurrence in a full queue");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(session.state.currentEntryId, previous.id);
    assert.equal(session.state.queue.length, 500);
    assert.deepEqual(session.state.queue[0]?.collection, previous.collection);
    assert.equal(commands.find(command => command.type === "load")?.startPosition, 45);
  } finally { session.close(); store.close(); }
});

test("provider restart intent requires a boolean on immediate playback", () => {
  for (const fields of [{ fromStart: "true" }, { fromStart: 1 }, { fromStart: null }, { fromStart: true, playNow: false }, { fromStart: false, playNow: undefined }]) {
    assert.throws(() => parse(fields), /Invalid command/);
  }
});

// Session is the resume-position authority. Use its real store, media identity
// and intake, replacing only stream resolution; no Core/helpers or network.
for (const fromStart of [false, true]) test(`selected occurrence ${fromStart ? "starts over" : "resumes the same media"} in Session`, async () => {
  const store = openStore(":memory:"), commands: PlaybackCommand[] = [];
  const previous: QueueEntry = { id: "previous", source: `web:${url}`, title: "Video", collection: { ...collection, index: 0 } };
  const mediaId = playbackMediaId(previous)!;
  store.saveProgress(store.activeProfile().id, { mediaId, title: previous.title, position: 45, duration: 100, watched: false, lastPlayedAt: 1 }, previous);
  let state: SessionState | undefined;
  const session = createSession({ ...store, ...store.playback("selected") }, command => commands.push(command), next => { state = structuredClone(next); }, {
    resolveSource: entry => ({ source: entry.source.slice(4) }),
  });
  try {
    const command = parse({ fromStart });
    assert.equal(command.action.type, "enqueueProvider");
    if (command.action.type !== "enqueueProvider") throw new Error("Expected provider intake");
    const selected = command.action;
    session.playNewEntries([{ id: "selected", title: selected.title!, source: `web:${selected.url}`, collection: selected.collection, quality: selected.quality }], { fromStart: selected.fromStart });
    await new Promise<void>(resolve => setImmediate(resolve));
    const load = commands.find(command => command.type === "load");
    assert.ok(load, "Session must issue a player load");
    assert.equal(load.startPosition ?? 0, fromStart ? 0 : 45);
    assert.deepEqual(state?.queue.find(entry => entry.id === state!.currentEntryId)?.collection, collection);
    assert.equal(playbackMediaId(state!.queue.at(-1)!), mediaId, "selected occurrence must retain canonical media identity");
  } finally { session.close(); store.close(); }
});
