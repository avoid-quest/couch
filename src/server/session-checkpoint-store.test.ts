import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type PlaybackCheckpoint, type Store } from "./store";

const directories: string[] = [];
const stores = new Set<Store>();
const open = (path: string) => { const store = openStore(path); stores.add(store); return store; };
const close = (store: Store) => { store.close(); stores.delete(store); };
const path = () => { const directory = mkdtempSync(join(tmpdir(), "couch-checkpoint-")); directories.push(directory); return join(directory, "state.sqlite"); };
const checkpoint: PlaybackCheckpoint = {
  entryId: "entry", source: "jellyfin:account:item", position: 42, duration: 300, speed: 1.5, seekable: true,
  tracks: [{ id: "audio-eng", index: 2, kind: "audio", label: "English", language: "eng", selected: true }],
  audioTracksKnown: true, playedBy: { deviceId: "remote", name: "Living room" }, presentationId: "presentation",
};
afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("checkpoint persists across reopen and clears without retaining runtime authority", () => {
  const file = path();
  const initial = open(file);
  expect(initial.playbackCheckpoint()).toBeNull();
  initial.savePlaybackCheckpoint({ ...checkpoint, playbackId: "old-attempt", targetId: "old-target", headers: { Authorization: "secret" } } as PlaybackCheckpoint);
  close(initial);
  const resumed = open(file);
  expect(resumed.playbackCheckpoint()).toEqual(checkpoint);
  const db = new Database(file, { readonly: true });
  const raw = db.query<{ checkpoint: string }, []>("SELECT checkpoint FROM playback_checkpoint").get()!.checkpoint;
  db.close();
  expect(raw).not.toContain("old-attempt");
  expect(raw).not.toContain("old-target");
  expect(raw).not.toContain("secret");
  resumed.savePlaybackCheckpoint(null);
  close(resumed);
  expect(open(file).playbackCheckpoint()).toBeNull();
});

test("malformed persisted checkpoints are ignored instead of crashing startup", () => {
  const file = path();
  const store = open(file);
  const db = new Database(file);
  try {
    const corrupt = ["{broken", "null", "[]", "true", "{}", ...[
      { position: -1 }, { position: "42" }, { duration: -1 }, { duration: "300" }, { speed: 0 }, { speed: 5 },
      { entryId: "" }, { entryId: "e".repeat(81) }, { source: "s".repeat(4097) }, { seekable: 1 },
      { audioTracksKnown: "yes" }, { presentationId: 123 }, { playedBy: { deviceId: 4, name: "X" } },
      { tracks: [null] }, { tracks: [{ ...checkpoint.tracks![0], index: -1 }] },
      { tracks: [{ ...checkpoint.tracks![0], kind: "secret" }] }, { tracks: Array(51).fill(checkpoint.tracks![0]) },
    ].map(patch => JSON.stringify({ ...checkpoint, ...patch })), JSON.stringify(checkpoint).replace('"position":42', '"position":1e999')];
    for (const json of corrupt) {
      db.query("UPDATE playback_checkpoint SET checkpoint = ?").run(json);
      expect(store.playbackCheckpoint()).toBeNull();
    }
  } finally { db.close(); }
});

test("adding checkpoint storage preserves an existing queue, cursor, volume and identity", () => {
  const file = path();
  const original = open(file);
  const queue = [{ id: "entry", source: "radio:station", title: "Station" }];
  original.saveQueue(queue);
  original.saveQueueCursor("entry");
  original.saveVolume(27);
  const identity = original.installationId();
  close(original);
  const legacy = new Database(file);
  legacy.run("DROP TABLE playback_checkpoint");
  legacy.close();
  const migrated = open(file);
  expect(migrated.playbackCheckpoint()).toBeNull();
  expect(migrated.queue).toEqual(queue);
  expect(migrated.queueCursorEntryId()).toBe("entry");
  expect(migrated.volume).toBe(27);
  expect(migrated.installationId()).toBe(identity);
  migrated.savePlaybackCheckpoint({ ...checkpoint, duration: null, presentationId: null });
  expect(migrated.playbackCheckpoint()).toMatchObject({ duration: null, presentationId: null });
});
