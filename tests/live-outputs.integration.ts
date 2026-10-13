import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";
import type { PlaybackCommand } from "../src/shared/protocol";
import { chooserRequest, outputStatus, reopens, WhereItPlays } from "../src/client/sections/shell/Outputs";
import { liveFixture, until } from "./live-input.fixture";

type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Client = Fixture["receiver"];
type Load = Extract<PlaybackCommand, { type: "load" }>;
const loads = (client: Client) => client.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
const direct = (load: Load | undefined) => !!load && "livePeerId" in load && load.follow === undefined;
const receivers = (client: Client) => client.state.outputs?.map(output => output.deviceId);
const sharedPlaybacks = (client: Client, sourceId = "screen") => client.state.playbacks?.filter(playback => playback.liveSourceId === sourceId) ?? [];
const consent = (client: Client, id: string) => client.state.devices?.find(device => device.id === id)?.sharing;
const sound = (client: Client, id: string) => { const device = client.state.devices?.find(device => device.id === id); return { volume: device?.volume, muted: device?.muted }; };
const lastCommand = (client: Client) => client.messages.flatMap(message => message.type === "player" && message.command.type !== "volume" ? [message.command.type] : []).at(-1);
// The production Where it plays rows, inspected without a DOM (as in output-controls).
type ControlProps = { label?: string; "aria-label"?: string; children?: ReactNode; disabled?: boolean };
function control(node: ReactNode, label: string): ControlProps | undefined {
  if (Array.isArray(node)) return node.map(child => control(child, label)).find(Boolean);
  if (!isValidElement<ControlProps>(node)) return;
  if (node.props.label === label || node.props["aria-label"] === label) return node.props;
  return control(node.props.children, label);
}
const ordinary = (f: Fixture, id: string) => ({ id, title: id, source: `${f.hub.origin}/api/health` });
const titles = (client: Client) => client.state.queue.map(entry => entry.title);
const playingNow = (client: Client) => client.state.queue.find(entry => entry.id === client.state.currentEntryId)?.title;
// Where it plays opens as the mounted Sheet would: on each new request to choose, never on an unchanged one.
function chooser(client: Client) {
  let seen = chooserRequest(client.state), opened = 0;
  return { observe: () => { const request = chooserRequest(client.state); if (reopens(seen, request)) opened++; seen = request; return opened; } };
}

test("Play on the publisher waits in Where it plays, opens it on each request, and both receiver entry points join one playback", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    // The publisher's Where it plays is already mounted for its ordinary item when Play on itself makes the source wait.
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    const sheet = chooser(f.publisher);
    assert.equal(sheet.observe(), 0);
    const self = await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id });
    assert.equal(self.ok, true, self.error);
    await until(() => f.publisher.state.player.error === "Publisher is sharing this source. Choose where it plays.");
    assert.equal(sheet.observe(), 1, "the transition to waiting opens Where it plays");
    assert.equal(f.publisher.state.player.status, "paused");
    assert.deepEqual(f.publisher.state.outputs, []);
    assert.equal(loads(f.publisher).some(load => "livePeerId" in load || load.source.includes("/api/live/")), false, "the publisher never loads its own capture");
    const waiting = f.publisher.state.playback;
    // Dismissed, it stays closed through unrelated broadcasts; a repeated Play reopens the same playback.
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    await until(() => consent(f.publisher, f.receiver.id)?.audio === true);
    assert.equal(sheet.observe(), 1);
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => sheet.observe() === 2);
    assert.equal(f.publisher.state.playback, waiting);
    assert.equal(sharedPlaybacks(f.publisher).length, 1, "a repeated request does not start another playback");
    // Now Playing: a device viewing the waiting playback adds This device in Where it plays, which starts it.
    const other = await f.connect(2, "&audio=1&video=1");
    await until(() => other.state.playback === waiting);
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 40, picture: true })).ok, true);
    await until(() => direct(other.load()));
    assert.equal(other.load()!.paused, false);
    other.report();
    await until(() => other.state.player.status === "playing" && !other.state.player.error);
    assert.equal(chooserRequest(f.publisher.state), null);
    // Find: Play on This device joins the same playback and its clock.
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.follow);
    assert.equal(f.receiver.state.playback, waiting);
    assert.equal(sharedPlaybacks(other).length, 1);
    assert.deepEqual(receivers(other)?.sort(), [f.receiver.id, other.id].sort());
    assert.equal(loads(f.publisher).some(load => "livePeerId" in load || load.source.includes("/api/live/")), false);
    assert.deepEqual(titles(f.publisher), ["movie", "Publisher · Screen"], "joining adds nothing to the queue");
  } finally { await f.close(); }
});

test("Play on the publisher leads to the one playback of its source that it may view", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const load = f.receiver.load();
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    assert.equal(f.publisher.state.playback, f.receiver.state.playback);
    assert.equal(f.publisher.state.controlling, f.receiver.id);
    assert.equal(sharedPlaybacks(f.publisher).length, 1);
    assert.equal(f.receiver.load(), load, "viewing it does not reload the receiver");
  } finally { await f.close(); }
});

test("two devices using Play on This device share one playback and a repeat does not restart it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const first = f.receiver.state.playback, load = f.receiver.load();
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    assert.equal(f.receiver.load(), load, "Play on a device already receiving the source keeps its transport");
    const other = await f.connect(2);
    assert.equal((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).ok, true);
    await until(() => other.state.playback === first && !!other.load());
    assert.equal(sharedPlaybacks(other).length, 1);
    assert.deepEqual(receivers(other)?.sort(), [f.receiver.id, other.id].sort());
    for (const client of [f.receiver, other]) assert.deepEqual(consent(other, client.id), client === other ? { audio: false, video: false } : { audio: true, video: true }, "joining grants nothing");
    // Other's own output stays private to it.
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 0 })).ok, false);
    assert.equal((await f.receiver.command({ type: "volume", deviceId: other.id, volume: 90 })).ok, false);
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 20 })).ok, true, "a receiver adjusts its own output");
    assert.equal(f.receiver.state.outputs?.find(output => output.deviceId === other.id)?.local, true);
  } finally { await f.close(); }
});

test("Primary Play on a device busy with an ordinary item joins the source's playback and keeps that item's queue", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const first = f.receiver.state.playback, load = f.receiver.load();
    const other = await f.connect(2);
    await other.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: other.id });
    await until(() => !!other.load());
    const movie = other.state.playback;
    const play = await other.command({ type: "playLive", sourceId: "screen" });
    assert.equal(play.ok, true, play.error);
    await until(() => other.state.playback === first && !!other.load()?.follow);
    assert.equal(sharedPlaybacks(other).length, 1, "Play and Play on reach the same playback");
    assert.deepEqual(receivers(other)?.sort(), [f.receiver.id, other.id].sort());
    assert.equal(f.receiver.load()?.playbackId, load?.playbackId, "the receiver keeps playing the same item");
    // The ordinary item's playback keeps its own queue, waiting for a device.
    const left = other.state.playbacks?.find(playback => playback.id === movie);
    assert.equal(left?.title, "movie");
    assert.deepEqual(left?.outputs, []);
  } finally { await f.close(); }
});

test("Queue and Play next add an active source to the queue without joining or interrupting it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const load = f.receiver.load(), commands = f.receiver.messages.length;
    assert.equal((await f.receiver.command({ type: "enqueue", entry: ordinary(f, "after") })).ok, true);
    const queued = await f.receiver.command({ type: "playLive", sourceId: "screen", playNow: false });
    assert.equal(queued.ok, true, queued.error);
    await until(() => f.receiver.state.queue.length === 3);
    const next = await f.receiver.command({ type: "playLive", sourceId: "screen", playNow: false, placement: "next" });
    assert.equal(next.ok, true, next.error);
    await until(() => f.receiver.state.queue.length === 4);
    assert.deepEqual(titles(f.receiver), ["Publisher · Screen", "Publisher · Screen", "after", "Publisher · Screen"]);
    assert.equal(playingNow(f.receiver), "Publisher · Screen");
    assert.equal(f.receiver.state.currentEntryId, f.receiver.state.queue[0]!.id);
    assert.equal(f.receiver.load(), load, "queueing never reloads the playing source");
    assert.equal(f.receiver.messages.slice(commands).some(message => message.type === "player"), false);
    assert.equal(sharedPlaybacks(f.receiver).length, 1);
  } finally { await f.close(); }
});

test("joining a private playback is refused and changes nothing, so it gives no control of it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    const other = await f.connect(2);
    const { playbackId } = f.receiver.state.player;
    const before = { outputs: f.receiver.state.outputs, queue: f.receiver.state.queue, current: f.receiver.state.currentEntryId, load: f.receiver.load(), messages: f.receiver.messages.length };
    assert.equal((await other.command({ type: "stop", playbackId: playbackId! })).ok, false);
    for (const action of [{ type: "playLive", sourceId: "screen", deviceId: other.id }, { type: "playLive", sourceId: "screen" }] as const) {
      const join = await other.command(action);
      assert.equal(join.ok, false, "deviceId" in action ? "Play on" : "Play");
      assert.equal(join.error, "Publisher · Screen is playing privately on Receiver. It can join when they let other devices use their speakers or screen.");
    }
    assert.equal((await other.command({ type: "stop", playbackId: playbackId! })).ok, false, "a refused join leaves Stop refused");
    assert.equal((await other.command({ type: "next", playbackId: playbackId! })).ok, false);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual({ outputs: f.receiver.state.outputs, queue: f.receiver.state.queue, current: f.receiver.state.currentEntryId, load: f.receiver.load(), messages: f.receiver.messages.filter(message => message.type === "player").length },
      { ...before, messages: f.receiver.messages.slice(0, before.messages).filter(message => message.type === "player").length });
    assert.equal(f.receiver.state.player.status, "playing");
    assert.equal(sharedPlaybacks(other).length, 1);
    assert.equal(other.state.playback, null, "Other has nothing of Receiver's to view");
    assert.deepEqual(consent(other, f.receiver.id), { audio: false, video: false });
    // An outputless request to choose is not another place it plays: the refusal is about privacy, not ambiguity.
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => sharedPlaybacks(other).length === 2);
    assert.match((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).error!, /playing privately on Receiver/);
    // The publisher has no consent to use the receiver either.
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, false);
  } finally { await f.close(); }
});

test("an outputless request to choose never makes the one receiving playback ambiguous", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const first = f.receiver.state.playback;
    // The publisher's own queue reaches its source, so that playback waits with no outputs.
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => f.publisher.load()?.source === `${f.hub.origin}/api/health`);
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    f.publisher.report();
    await until(() => f.publisher.state.player.status === "playing");
    await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! });
    await until(() => sharedPlaybacks(f.publisher).some(playback => !playback.outputs.length && !!playback.choosing));
    const other = await f.connect(2);
    const join = await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id });
    assert.equal(join.ok, true, join.error);
    await until(() => other.state.playback === first && !!other.load()?.follow);
    assert.deepEqual(receivers(other)?.sort(), [f.receiver.id, other.id].sort());
  } finally { await f.close(); }
});

test("joining is refused rather than guessed when the source plays in several independent playbacks", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const other = await f.connect(2);
    await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id });
    await until(() => !!other.load()?.follow);
    // Receiver forks its own playback with ordinary Play on, then plays the source from its Up next.
    await f.receiver.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.receiver.id });
    await until(() => f.receiver.load()?.source === `${f.hub.origin}/api/health`);
    await f.receiver.command({ type: "playLive", sourceId: "screen", playNow: false });
    const queued = f.receiver.state.queue.find(entry => entry.liveSourceId === "screen")!;
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    await f.receiver.command({ type: "play", entryId: queued.id });
    await until(() => sharedPlaybacks(f.receiver).length === 2);
    const third = await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id });
    assert.equal(third.ok, true, "the publisher's own Play waits; it never joins a receiving playback");
    const ambiguous = await f.connect(-1);
    const result = await ambiguous.command({ type: "playLive", sourceId: "screen", deviceId: ambiguous.id });
    assert.equal(result.ok, false);
    assert.match(result.error!, /playing in several places/);
  } finally { await f.close(); }
});

test("Play inherits the publisher's mix without it, and the publisher keeps controlling that playback", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 50, picture: true });
    const playback = f.publisher.state.playback;
    await f.publish("screen");
    const play = await f.publisher.command({ type: "playLive", sourceId: "screen" });
    assert.equal(play.ok, true, play.error);
    await until(() => direct(f.receiver.load()));
    assert.equal(f.publisher.state.playback, playback);
    assert.deepEqual(receivers(f.publisher), [f.receiver.id], "one receiver stays direct");
    assert.equal(f.publisher.state.controlling, f.receiver.id);
    assert.equal(lastCommand(f.publisher), "stop", "the publisher's ordinary item stops where the source replaces it");
    // Picture, a level or Only here on the publisher are refused before anything changes.
    const volume = sound(f.publisher, f.publisher.id).volume;
    for (const action of [
      { type: "output", deviceId: f.publisher.id, picture: true },
      { type: "output", deviceId: f.publisher.id, level: 70 },
      { type: "solo", deviceId: f.publisher.id },
    ] as const) {
      const result = await f.publisher.command(action);
      assert.equal(result.ok, false, action.type);
      assert.match(result.error!, /Publisher is sharing this source/);
    }
    assert.equal(sound(f.publisher, f.publisher.id).volume, volume);
    assert.deepEqual(receivers(f.publisher), [f.receiver.id]);
    // Where it plays lists the publisher with its status, and offers nothing that would make it receive.
    const rows = WhereItPlays({ state: f.publisher.state, run: async () => true });
    assert.equal(outputStatus(f.publisher.state, f.publisher.state.devices!.find(device => device.id === f.publisher.id)!, f.publisher.state.playback), "Sharing this source");
    for (const label of ["Publisher picture", "Publisher volume", "Only on Publisher"]) assert.equal(control(rows, label)?.disabled, true, label);
    assert.equal(control(rows, "Receiver volume")?.disabled, false);
  } finally { await f.close(); }
});

test("a queued source leaves its publisher out at Next, and waits when the publisher was the only output", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    f.publisher.report();
    await until(() => f.publisher.state.player.status === "playing");
    const playback = f.publisher.state.playback;
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    await until(() => f.publisher.state.player.error === "Publisher is sharing this source. Choose where it plays.");
    assert.deepEqual(f.publisher.state.outputs, []);
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(loads(f.publisher).some(load => "livePeerId" in load || load.source.includes("/api/live/")), false);
    // Where it plays picks the receiver; the queue is kept and the source starts there.
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 50, picture: true })).ok, true);
    await until(() => direct(f.receiver.load()));
    assert.equal(f.receiver.load()!.paused, false);
    assert.deepEqual(f.publisher.state.queue.map(entry => entry.title), ["movie", "Publisher · Screen", "after"]);
    assert.equal(f.publisher.state.playback, playback);
  } finally { await f.close(); }
});

test("after a queued own source, the next ordinary item returns to the publisher unless it moved elsewhere", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "last") });
    f.publisher.report();
    await until(() => f.publisher.state.player.status === "playing");
    const playback = f.publisher.state.playback, sheet = chooser(f.publisher);
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    await until(() => f.publisher.state.player.status === "paused" && !f.publisher.state.outputs?.length);
    assert.equal(sheet.observe(), 1, "Next into its own source opens Where it plays");
    const next = await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! });
    assert.equal(next.ok, true, next.error);
    await until(() => playingNow(f.publisher) === "after" && receivers(f.publisher)?.join() === f.publisher.id);
    await until(() => f.publisher.load()?.source === `${f.hub.origin}/api/health` && f.publisher.state.player.status !== "unavailable");
    assert.equal(f.publisher.state.player.error ?? null, null);
    assert.equal(f.publisher.state.playback, playback);
    // Back on the source, the publisher then plays something else: the queue no longer reclaims it.
    await f.publisher.command({ type: "play", entryId: f.publisher.state.queue[1]!.id });
    await until(() => playingNow(f.publisher) === "Publisher · Screen" && !f.publisher.state.outputs?.length && f.publisher.state.player.status === "paused");
    const waiting = f.publisher.state.player.playbackId!;
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "elsewhere"), playNow: true, deviceId: f.publisher.id });
    await until(() => playingNow(f.publisher) === "elsewhere");
    const elsewhere = f.publisher.state.playback;
    assert.notEqual(elsewhere, playback);
    assert.equal((await f.publisher.command({ type: "next", playbackId: waiting })).ok, true);
    await until(() => f.publisher.state.playbacks?.find(item => item.id === playback)?.status === "unavailable");
    const left = f.publisher.state.playbacks!.find(item => item.id === playback)!;
    assert.deepEqual(left.outputs, []);
    assert.equal(left.choosing, undefined, "an ordinary item is no request to choose for the source");
    assert.equal(f.publisher.state.playback, elsewhere);
    assert.deepEqual(receivers(f.publisher), [f.publisher.id]);
  } finally { await f.close(); }
});

test("in a publisher-and-receiver mix, the next ordinary item plays on both again unless Only here moved it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 50, picture: true });
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "last") });
    await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! });
    await until(() => direct(f.receiver.load()) && receivers(f.publisher)?.join() === f.receiver.id);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    await until(() => playingNow(f.publisher) === "after" && receivers(f.publisher)?.length === 2);
    assert.deepEqual(receivers(f.publisher)?.sort(), [f.publisher.id, f.receiver.id].sort(), "the ordinary mix returns");
    await until(() => !!f.receiver.load()?.follow && f.receiver.load()?.source !== undefined && !("livePeerId" in f.receiver.load()!));
    // Only here during the source is an explicit exclusive move: the publisher does not come back.
    assert.equal((await f.publisher.command({ type: "play", entryId: f.publisher.state.queue[1]!.id })).ok, true);
    await until(() => playingNow(f.publisher) === "Publisher · Screen" && receivers(f.publisher)?.join() === f.receiver.id);
    await until(() => direct(f.receiver.load()) && f.receiver.load()!.playbackId === f.publisher.state.player.playbackId && f.receiver.state.player.playbackId === f.receiver.load()!.playbackId);
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    assert.equal((await f.publisher.command({ type: "solo", deviceId: f.receiver.id })).ok, true);
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    // Playing an entry moves it after the current one, so the next ordinary item is now "last".
    await until(() => playingNow(f.publisher) === "last" && f.receiver.load()?.playbackId === f.publisher.state.player.playbackId);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(receivers(f.publisher), [f.receiver.id]);
    assert.equal(direct(f.receiver.load()) || f.receiver.load()?.follow === undefined, true, "it stays Direct on the receiver");
  } finally { await f.close(); }
});

test("a queued source in a publisher-and-receiver mix plays directly on the receiver", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 50, picture: true });
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    const next = await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! });
    assert.equal(next.ok, true, next.error);
    await until(() => direct(f.receiver.load()));
    assert.deepEqual(receivers(f.publisher), [f.receiver.id]);
    // A second tab of the publisher (reconnection) still receives nothing.
    const again = await f.connect(0);
    await until(() => again.state.playback === f.publisher.state.playback);
    assert.equal(loads(again).length, 0);
    assert.deepEqual(receivers(again), [f.receiver.id]);
  } finally { await f.close(); }
});

test("This device joins from Where it plays without sharing, and Only here refuses while another device plays privately", { timeout: 15_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    await f.speaker(1);
    // Local is this process's own client device and shares nothing. Play on Receiver shows the playback already there.
    const local = await f.connect(3);
    assert.equal((await local.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => local.state.playback === f.receiver.state.playback);
    assert.equal(local.state.controlling, f.receiver.id);
    const rows = WhereItPlays({ state: local.state, run: async () => true });
    for (const label of ["Local picture", "Local volume"]) assert.equal(control(rows, label)?.disabled, false, label);
    assert.equal(outputStatus(local.state, local.state.devices!.find(device => device.id === local.id)!, local.state.playback), "Not playing here");
    assert.equal((await local.command({ type: "output", deviceId: local.id, level: 30, picture: true })).ok, true);
    await until(() => !!local.load()?.follow);
    assert.deepEqual(receivers(local)?.sort(), [f.receiver.id, local.id].sort());
    assert.deepEqual(consent(local, local.id), { audio: false, video: false }, "receiving grants nothing");
    // Other joins privately too. Only here would leave Other's private output behind, so it is refused and nothing moves.
    const other = await f.connect(2);
    assert.equal((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).ok, true);
    await until(() => receivers(local)?.length === 3);
    const outputs = local.state.outputs, load = f.receiver.load(), localLoad = local.load();
    for (const deviceId of [local.id, f.receiver.id]) {
      const only = await local.command({ type: "solo", deviceId });
      assert.equal(only.ok, false);
      assert.equal(only.error, "Only here is unavailable while Other plays this privately.");
    }
    assert.deepEqual(local.state.outputs, outputs);
    assert.equal(f.receiver.load(), load);
    assert.equal(local.load(), localLoad);
    const blocked = WhereItPlays({ state: local.state, run: async () => true });
    for (const label of ["Only on Local", "Only on Receiver", "Only on Other"]) assert.equal(control(blocked, label)?.disabled, true, `${label} is not offered while it cannot be exclusive`);
    // Once Other leaves, Local's Only here is exclusive: Receiver shares, so it leaves too.
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 0, picture: false })).ok, true);
    await until(() => receivers(local)?.length === 2);
    assert.equal(control(WhereItPlays({ state: local.state, run: async () => true }), "Only on Local")?.disabled, false);
    f.receiver.report(); local.report();
    await until(() => local.state.player.status === "playing" && local.state.player.position > 0);
    const mine = await local.command({ type: "solo", deviceId: local.id });
    assert.equal(mine.ok, true, mine.error);
    await until(() => receivers(local)?.join() === local.id && direct(local.load()));
  } finally { await f.close(); }
});

test("Only here goes direct, and sync adjustment keeps its value but applies only in a group", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const delays = await f.speaker(1);
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => !!other.load()?.follow);
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delayActive === true);
    const set = await f.publisher.command({ type: "output", deviceId: f.receiver.id, delay: 80 });
    assert.equal(set.ok, true, set.error);
    await until(() => delays.includes(80) && f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay === 80);
    const preferences = f.publisher.state.preferences, volumes = [sound(f.publisher, f.receiver.id), sound(f.publisher, other.id)];
    f.receiver.report(); other.report();
    await until(() => f.publisher.state.player.status === "playing" && f.publisher.state.player.position > 0);
    // Only here moves the playback exclusively; each single receiver plays directly over WebRTC.
    const only = await f.publisher.command({ type: "solo", deviceId: other.id });
    assert.equal(only.ok, true, only.error);
    await until(() => direct(other.load()));
    assert.deepEqual(receivers(f.publisher), [other.id]);
    other.report();
    await until(() => f.publisher.state.player.status === "playing");
    const back = await f.publisher.command({ type: "solo", deviceId: f.receiver.id });
    assert.equal(back.ok, true, back.error);
    await until(() => direct(f.receiver.load()) && receivers(f.publisher)?.join() === f.receiver.id);
    // The saved delay still shows, without an operative control.
    const output = f.publisher.state.outputs![0]!;
    assert.equal(output.delay, 80);
    assert.equal(output.delayActive, undefined);
    const refused = await f.publisher.command({ type: "output", deviceId: f.receiver.id, delay: 120 });
    assert.equal(refused.ok, false);
    assert.match(refused.error!, /applies while Receiver plays in sync/);
    assert.equal(delays.at(-1), 80, "a refused adjustment never reaches the speaker");
    assert.deepEqual(f.publisher.state.preferences, preferences, "audio-versus-video offset is a separate preference");
    assert.deepEqual([sound(f.publisher, f.receiver.id), sound(f.publisher, other.id)], volumes);
    assert.deepEqual(consent(f.publisher, f.receiver.id), { audio: true, video: true });
    // Joining again restores the group and the saved value applies.
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delayActive === true);
    assert.equal(f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay, 80);
  } finally { await f.close(); }
});

test("a saved sync adjustment shows on a Direct output after Core restarts, without forming a group", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    const delays = await f.speaker(1);
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true });
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delayActive === true);
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, delay: 80 })).ok, true);
    await until(() => delays.includes(80) && f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay === 80);
    // Core restarts; the speaker has not reconnected, and Receiver plays an ordinary item on itself alone.
    await f.restart();
    const receiver = await f.connect(1, "&audio=1&video=1");
    await receiver.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: receiver.id });
    await until(() => !!receiver.load() && receivers(receiver)?.join() === receiver.id);
    const output = receiver.state.outputs![0]!;
    assert.equal(output.delay, 80, "the saved value shows");
    assert.equal(output.delayActive, undefined, "Direct playback stays Direct");
    assert.equal(receiver.load()!.follow, undefined);
    const rows = WhereItPlays({ state: receiver.state, run: async () => true });
    assert.equal(control(rows, "Receiver sync"), undefined, "no operative control while it cannot apply");
    assert.match(JSON.stringify(rows, (_key, value) => typeof value === "function" || _key === "_owner" ? undefined : value), /Sync 80 ms earlier/);
  } finally { await f.close(); }
});

test("Stop ends reception and keeps capture; Stop sharing ends the source everywhere", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    assert.equal((await f.receiver.command({ type: "stop", playbackId: f.receiver.load()!.playbackId })).ok, true);
    await until(() => lastCommand(f.receiver) === "stop");
    assert.equal(f.receiver.state.liveSources?.length, 1, "Stop leaves capture running");
    const before = loads(f.receiver).length;
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => loads(f.receiver).length > before && direct(f.receiver.load()));
    assert.equal((await f.publisher.command({ type: "endLive", sourceId: "screen" })).ok, true);
    await until(() => !f.receiver.state.liveSources?.length && !sharedPlaybacks(f.receiver).length);
    assert.equal(lastCommand(f.receiver), "stop");
  } finally { await f.close(); }
});
