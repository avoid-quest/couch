import { expect, test } from "bun:test";
import type { Action, SessionState } from "../../shared/protocol";
import { applyUndo, undoPlan } from "./undo";

const entry = (id: string) => ({ id, title: id, source: `file:${id}` });
const state = (queue: string[], currentEntryId: string | null, removed?: string): SessionState => ({
  queue: queue.map(entry), currentEntryId,
  ...(removed ? { queueRemoval: { entryId: removed, token: "restore-token" } } : {}),
  activeProfile: { id: "profile", name: "Everyone" },
  player: { playbackId: currentEntryId, status: currentEntryId ? "playing" : "idle", position: 42, duration: 100, volume: 1, seekable: true, error: null },
});

test("removing the playing item retains its queue position and resume point for Undo", () => {
  const plan = undoPlan({ type: "remove", entryId: "b" }, state(["a", "b", "c"], "b"), state(["a", "c"], null, "b"));
  expect(plan?.removed).toEqual({ entryId: "b", token: "restore-token", beforeEntryId: "c" });
  expect(plan?.resume).toMatchObject({ entryId: "b", position: 42 });
  expect(plan?.moved).toBeUndefined();
});

test("replacing playback removes only entries added by that command", () => {
  const plan = undoPlan({ type: "enqueue", entry: entry("new"), playNow: true }, state(["a", "b"], "a"), state(["a", "new", "b"], "new"));
  expect(plan?.addedIds).toEqual(["new"]);
  expect(plan?.resume?.entryId).toBe("a");
});

test("Undo waits for the server to restore the item at its original position", async () => {
  let observed = state(["a", "c"], "a", "b");
  const plan = undoPlan({ type: "remove", entryId: "b" }, state(["a", "b", "c"], "a"), observed)!;
  const sent: Action[] = [];
  await applyUndo(plan, async action => {
    sent.push(action);
    if (action.type === "restoreRemoved") setTimeout(() => { observed = state(["a", "b", "c"], "a"); }, 20);
  }, () => observed);
  expect(sent).toEqual([{ type: "restoreRemoved", token: "restore-token" }]);
  expect(observed.queue.map(item => item.id)).toEqual(["a", "b", "c"]);
});

test("Undo refuses a queue changed by another controller", async () => {
  const plan = undoPlan({ type: "remove", entryId: "b" }, state(["a", "b", "c"], "a"), state(["a", "c"], "a", "b"))!;
  const sent: Action[] = [];
  await expect(applyUndo(plan, async action => { sent.push(action); }, () => state(["a", "c", "other"], "a"))).rejects.toThrow("shared queue or playback changed");
  expect(sent).toEqual([]);
});

test("Undo observes each removed replacement entry before removing the next", async () => {
  const before = state(["a"], "a");
  before.player.position = 0;
  before.player.seekable = false;
  let observed = state(["a", "x", "y"], "x");
  const plan = undoPlan({ type: "enqueueAlbum", albumId: "album", playNow: true }, before, observed)!;
  const sent: Action[] = [];
  await applyUndo(plan, async action => {
    sent.push(action);
    if (action.type === "remove" && action.entryId === "x") setTimeout(() => { observed = state(["a", "y"], null); }, 20);
    if (action.type === "remove" && action.entryId === "y") {
      expect(observed.queue.map(item => item.id)).toEqual(["a", "y"]);
      setTimeout(() => { observed = state(["a"], null); }, 20);
    }
    if (action.type === "play") setTimeout(() => { observed = state(["a"], "a"); }, 20);
  }, () => observed);
  expect(sent.map(action => action.type)).toEqual(["remove", "remove", "play"]);
});
