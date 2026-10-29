import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createSession } from "../src/server/session";
import { openStore } from "../src/server/store";
import type { PlaybackCommand, SessionState } from "../src/shared/protocol";

function fixture(t: TestContext) {
  const store = openStore(":memory:");
  const commands: PlaybackCommand[] = [];
  let state: SessionState, reject = false;
  const session = createSession({ ...store, ...store.playback("audio-selection") }, command => {
    if (reject && command.type === "track") throw new Error("Disconnected");
    commands.push(command);
  }, next => { state = structuredClone(next); });
  t.after(() => { session.close(); store.close(); });
  session.command({ type: "enqueue", entry: { id: "one", title: "Two languages", source: "https://media.example/master.m3u8" }, playNow: true });
  const tracks = (selected: number) => ["English", "Italian"].map((label, index) => ({ id: `a${index}`, kind: "audio" as const, index, label, language: index ? "it" : "en", selected: index === selected }));
  const report = (selected: number, status: "playing" | "error" = "playing") => session.observe({ ...state!.player, status, tracks: tracks(selected) });
  report(0);
  return { session, commands, report, get state() { return state!; }, reject() { reject = true; }, choose: (index = 1) => session.command({ type: "track", playbackId: state!.player.playbackId!, kind: "audio", index }) };
}

test("stale detailed tracks cannot replace a commanded choice before confirmation or a reload", t => {
  const f = fixture(t);
  f.choose();
  f.report(0);
  f.session.observe({ ...f.state.player, tracks: [{ id: 'audio-0', index: 0, kind: 'audio', label: 'Audio', language: '', selected: true }] });
  assert.equal(f.session.audioSelection()?.language, "it");
  f.session.reload();
  assert.equal(f.commands.findLast(command => command.type === "load")?.audioTrack, 1);
  f.report(0);
  assert.equal(f.session.audioSelection()?.language, "it");
  f.report(1);
  assert.equal(f.session.audioSelection()?.language, "it");
  f.report(0);
  assert.equal(f.session.audioSelection()?.language, "en", "confirmed intent permits later renderer choices");
});

test("rejected or failed audio commands do not pin an unconfirmed selection", t => {
  const f = fixture(t);
  assert.throws(() => f.choose(99), /not available/);
  assert.equal(f.session.audioSelection()?.language, "en");
  f.choose();
  f.report(0, "error");
  assert.equal(f.session.audioSelection()?.language, "en");
  f.report(1);
  assert.equal(f.session.audioSelection()?.language, "it");
  f.reject();
  assert.throws(() => f.choose(0), /Disconnected/);
  assert.equal(f.session.audioSelection()?.language, "it");
});


test("audio intent follows identity across rendition reordering and resets for the next item", t => {
  const f = fixture(t);
  f.choose();
  f.session.observe({ ...f.state.player, tracks: [{ id: "a0", index: 0, kind: "audio", label: "Italian", language: "it", selected: true }] });
  assert.equal(f.session.audioSelection()?.index, 0);
  f.report(0);
  assert.equal(f.session.audioSelection()?.language, "en");
  f.choose();
  f.session.command({ type: "enqueue", entry: { id: "two", title: "Next", source: "https://media.example/next.m3u8" }, playNow: true });
  f.report(0);
  assert.equal(f.session.audioSelection()?.language, "en");
});
