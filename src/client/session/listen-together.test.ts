import { expect, test } from "bun:test";
import type { Action, PlaybackTarget, SessionState } from "../../shared/protocol";
import { listenTogether } from "./listen-together";

function fixture() {
  const group: PlaybackTarget = { id: "sendspin-group", name: "Together", backend: "sendspin", kind: "group", connected: true, members: [{ id: "listener", name: "Laptop", connected: true, joined: false, volume: 25, muted: false }] };
  let state: SessionState | null = { sessionId: "private", targetId: "browser", currentEntryId: "song", queue: [{ id: "song", title: "Song", source: "https://example.com/song.mp3" }], activeProfile: { id: "default", name: "Default" }, player: { playbackId: "load", status: "playing", position: 12, duration: 90, seekable: true, volume: 25, error: null }, targets: [group] };
  const actions: Action[] = [];
  return { group, read: () => state, set: (next: SessionState | null) => { state = next; }, actions, command: async (action: Action) => { actions.push(action); } };
}

test("joining direct local audio preserves the queue and uses the verified move", async () => {
  const f = fixture(), before = structuredClone(f.read());
  await listenTogether("listener", "browser", f.read, f.command);
  expect(f.actions).toEqual([{ type: "groupMembers", targetId: "sendspin-group", memberIds: ["listener"] }, { type: "selectTarget", targetId: "sendspin-group" }]);
  expect(f.read()).toEqual(before);
});

test("joining an existing timeline only changes membership", async () => {
  const f = fixture(); f.read()!.targetId = "sendspin-group";
  await listenTogether("listener", "browser", f.read, f.command);
  expect(f.actions).toHaveLength(1);
});

test("occupied private playback and a remote source without shared capability stay untouched", async () => {
  const f = fixture(); f.group.occupied = true; f.group.sessionKind = "personal";
  await expect(listenTogether("listener", "browser", f.read, f.command)).rejects.toThrow("owner can add");
  f.group.occupied = false; f.read()!.targetId = "remote-tv";
  await expect(listenTogether("listener", "browser", f.read, f.command)).rejects.toThrow("currently playing first");
  expect(f.actions).toEqual([]);
});

test("failed destination preparation restores previous membership", async () => {
  const f = fixture();
  await expect(listenTogether("listener", "browser", f.read, async action => { await f.command(action); if (action.type === "selectTarget") throw new Error("decode failed"); })).rejects.toThrow("decode failed");
  expect(f.actions.at(-1)).toEqual({ type: "groupMembers", targetId: "sendspin-group", memberIds: [] });
});

test("view changes during membership do not move the newly viewed playback", async () => {
  const f = fixture();
  await expect(listenTogether("listener", "browser", f.read, async action => { await f.command(action); f.set(null); })).rejects.toThrow("selection changed");
  expect(f.actions.some(action => action.type === "selectTarget")).toBe(false);
});
