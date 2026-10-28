import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlaylists } from "../src/server/playlists";
import { upcomingQueue } from "../src/shared/queue";
import type { SavedPlaylist } from "../src/shared/playlists";
import type { PlaybackActor, SessionState } from "../src/shared/protocol";

const queue = ["played", "current", "next", "later"].map(id => ({ id, title: id, source: `https://example.com/${id}` }));
const request = (path: string, body?: unknown) => new Request(`http://localhost/api/playlists${path}`, body === undefined ? undefined : {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const ids = (playlist: SavedPlaylist) => playlist.entries.map(entry => entry.id);

test("list creation and replacement capture only the requesting playback's upcoming entries", async () => {
  let state: Pick<SessionState, "queue" | "currentEntryId" | "queueCursorEntryId"> = { queue, currentEntryId: "current", queueCursorEntryId: "played" };
  const actor: PlaybackActor = { deviceId: "remote", name: "Remote" };
  const lists = createPlaylists({ databasePath: ":memory:", onChange() {}, queue: () => queue,
    upNext: playedBy => { assert.deepEqual(playedBy, actor); return upcomingQueue(state); }, loadQueue() {},
  });
  const post = (path: string, body: unknown) => lists.handle(request(path, body), () => {}, actor);
  try {
    const created = await post("", { name: "Upcoming", scope: "upNext" });
    assert.equal(created.status, 201);
    let { playlist } = await created.json() as { playlist: SavedPlaylist };
    assert.deepEqual(ids(playlist), ["next", "later"]);
    state = { ...state, currentEntryId: "next" };
    const replaced = await post(`/${playlist.id}`, { revision: playlist.revision, operation: "saveQueue", scope: "upNext" });
    assert.equal(replaced.status, 200);
    ({ playlist } = await replaced.json() as { playlist: SavedPlaylist });
    assert.deepEqual(ids(playlist), ["later"]);
    // Stop retains the played cursor; saving must not bring played/current entries back.
    state = { ...state, currentEntryId: null, queueCursorEntryId: "next" };
    const stopped = await post("", { name: "Stopped", scope: "upNext" });
    assert.equal(stopped.status, 201);
    assert.deepEqual(ids((await stopped.json() as { playlist: SavedPlaylist }).playlist), ["later"]);
    // A confirmation opened before playback advances must leave the list intact once Up next empties.
    state = { ...state, queueCursorEntryId: "later" };
    assert.equal((await post("", { name: "Empty", scope: "upNext" })).status, 400);
    assert.equal((await post(`/${playlist.id}`, { revision: playlist.revision, operation: "saveQueue", scope: "upNext" })).status, 400);
    assert.equal((await post(`/${playlist.id}`, { revision: playlist.revision, operation: "saveQueue", scope: "invalid" })).status, 400);
    const unchanged = await lists.handle(request(`/${playlist.id}`));
    assert.deepEqual((await unchanged.json() as { playlist: SavedPlaylist }).playlist, playlist);
  } finally { lists.close(); }
});

test("unscoped saves retain the full-queue contract and unsupported Up next never replaces a list", async () => {
  let contents = queue.slice(0, 1);
  const lists = createPlaylists({ databasePath: ":memory:", onChange() {}, queue: () => contents, loadQueue() {} });
  try {
    const created = await lists.handle(request("", { name: "Whole queue" }));
    assert.equal(created.status, 201);
    const { playlist } = await created.json() as { playlist: SavedPlaylist };
    assert.deepEqual(ids(playlist), ["played"]);
    contents = queue;
    const body = { revision: playlist.revision, operation: "saveQueue" };
    const unscoped = await lists.handle(request(`/${playlist.id}`, body));
    assert.equal(unscoped.status, 200);
    const updated = (await unscoped.json() as { playlist: SavedPlaylist }).playlist;
    assert.deepEqual(ids(updated), queue.map(entry => entry.id));
    assert.equal((await lists.handle(request(`/${playlist.id}`, { ...body, revision: updated.revision, scope: "upNext" }))).status, 503);
    const unchanged = await lists.handle(request(`/${playlist.id}`));
    assert.deepEqual((await unchanged.json() as { playlist: SavedPlaylist }).playlist, updated);
  } finally { lists.close(); }
});
