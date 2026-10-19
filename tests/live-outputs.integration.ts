import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { isValidElement, type ReactNode } from "react";
import type { PlaybackCommand } from "../src/shared/protocol";
import { WhereItPlays } from "../src/client/sections/shell/Outputs";
import { chooserRequest, choosesHere, picker, reopens } from "../src/client/session/where-it-plays";
import { deviceId } from "../src/client/session/device-id";
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
type ControlProps = { label?: string; "aria-label"?: string; children?: ReactNode; disabled?: boolean; checked?: boolean; onSelect?: () => void; onClick?: () => void; onCommit?: (value: number) => void };
function control(node: ReactNode, label: string): ControlProps | undefined {
  if (Array.isArray(node)) return node.map(child => control(child, label)).find(Boolean);
  if (!isValidElement<ControlProps>(node)) return;
  if (node.props.label === label || node.props["aria-label"] === label) return node.props;
  return control(node.props.children, label);
}
// A device's one-line status in the picker this process's window would show.
const status = (client: Client, id: string) => picker(client.state, { here: deviceId() }).rows.find(row => row.device.id === id)?.status;
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
    assert.equal(choosesHere({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id }, null, f.publisher.state), false, "Core's request opens it, not another of this window's");
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
    await until(() => direct(f.receiver.load()));
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
    await until(() => other.state.playback === first && direct(other.load()));
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
    await until(() => other.state.playback === first && direct(other.load()));
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
    await until(() => direct(other.load()));
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
    // Where it plays lists the publisher with its status, and offers nothing that would make it receive: its row is
    // disabled, and out of the playback it has no fader or menu.
    const rows = WhereItPlays({ state: f.publisher.state, connected: true, run: async () => true });
    assert.equal(status(f.publisher, f.publisher.id), "Sharing this source");
    assert.equal(control(rows, "Publisher")?.disabled, true);
    for (const label of ["Publisher picture", "Publisher volume", "Only on Publisher"]) assert.equal(control(rows, label), undefined, label);
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
  const f = await liveFixture({ local: true });
  // The publisher is this process's own client device, so Where it plays shows its own rows.
  const publisher = await f.connect(3);
  const upload = await publishOn(f, publisher, 3, "screen");
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: publisher.id });
    await until(() => !!publisher.load());
    await publisher.command({ type: "output", deviceId: f.receiver.id, level: 50, picture: true });
    await publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    await publisher.command({ type: "enqueue", entry: ordinary(f, "last") });
    await publisher.command({ type: "next", playbackId: publisher.state.player.playbackId! });
    await until(() => direct(f.receiver.load()) && receivers(publisher)?.join() === f.receiver.id);
    f.receiver.report();
    await until(() => publisher.state.player.status === "playing");
    assert.equal((await publisher.command({ type: "next", playbackId: publisher.state.player.playbackId! })).ok, true);
    await until(() => playingNow(publisher) === "after" && receivers(publisher)?.length === 2);
    assert.deepEqual(receivers(publisher)?.sort(), [publisher.id, f.receiver.id].sort(), "the ordinary mix returns");
    await until(() => !!f.receiver.load()?.follow && f.receiver.load()?.source !== undefined && !("livePeerId" in f.receiver.load()!));
    // Only here during the source is an explicit exclusive move: the publisher does not come back.
    assert.equal((await publisher.command({ type: "play", entryId: publisher.state.queue[1]!.id })).ok, true);
    await until(() => playingNow(publisher) === "Local · Screen" && receivers(publisher)?.join() === f.receiver.id);
    await until(() => direct(f.receiver.load()) && f.receiver.load()!.playbackId === publisher.state.player.playbackId && f.receiver.state.player.playbackId === f.receiver.load()!.playbackId);
    f.receiver.report();
    await until(() => publisher.state.player.status === "playing");
    // The receiver is already the only output, so its row shows Only here pressed; pressing it still commits.
    const results: boolean[] = [];
    const only = control(WhereItPlays({ state: publisher.state, connected: true, run: async action => { const result = await publisher.command(action); results.push(result.ok); return result.ok; } }), "Only on Receiver")!;
    assert.deepEqual({ checked: only.checked, disabled: only.disabled }, { checked: true, disabled: false });
    only.onSelect!();
    await until(() => results.length === 1);
    assert.deepEqual(results, [true]);
    assert.equal((await publisher.command({ type: "next", playbackId: publisher.state.player.playbackId! })).ok, true);
    // Playing an entry moves it after the current one, so the next ordinary item is now "last".
    await until(() => playingNow(publisher) === "last" && f.receiver.load()?.playbackId === publisher.state.player.playbackId);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(receivers(publisher), [f.receiver.id]);
    assert.equal(direct(f.receiver.load()) || f.receiver.load()?.follow === undefined, true, "it stays Direct on the receiver");
  } finally { upload.terminate(); await f.close(); }
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
    const rows = WhereItPlays({ state: local.state, connected: true, run: async () => true });
    assert.equal(control(rows, "Local")?.disabled, false);
    assert.equal(status(local, local.id), "This device · Not playing");
    assert.equal((await local.command({ type: "output", deviceId: local.id, level: 30, picture: true })).ok, true);
    await until(() => direct(local.load()));
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
    const blocked = WhereItPlays({ state: local.state, connected: true, run: async () => true });
    for (const label of ["Only on Local", "Only on Receiver", "Only on Other"]) assert.equal(control(blocked, label)?.disabled, true, `${label} is not offered while it cannot be exclusive`);
    // Once Other leaves, Local's Only here is exclusive: Receiver shares, so it leaves too.
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 0, picture: false })).ok, true);
    await until(() => receivers(local)?.length === 2);
    assert.equal(control(WhereItPlays({ state: local.state, connected: true, run: async () => true }), "Only on Local")?.disabled, false);
    // Each receives it directly; the first one's player reports for the playback.
    f.receiver.report({ position: 1 }); local.report({ position: 1 });
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
    // Sync adjustment belongs to devices playing In sync (docs/adr/0001).
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
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
    // Joining again restores the group and the saved value applies, with Sync under its fader in Where it plays.
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delayActive === true);
    assert.equal(f.publisher.state.outputs?.find(output => output.deviceId === f.receiver.id)?.delay, 80);
    assert.ok(control(WhereItPlays({ state: f.publisher.state, connected: true, run: async () => true }), "Receiver sync"));
  } finally { await f.close(); }
});

test("a saved sync adjustment shows on a Direct output after Core restarts, without forming a group", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
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
    // Sync shows only while the device plays in sync with others.
    assert.equal(control(WhereItPlays({ state: receiver.state, connected: true, run: async () => true }), "Receiver sync"), undefined, "no operative control while it cannot apply");
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
    // Its player closes with the item, so the receiver hears who stopped sharing; the publisher is the actor and gets no toast.
    const stopped = f.receiver.messages.find(message => message.type === "state" && message.state.activity?.text === "Publisher stopped sharing");
    assert.ok(stopped && stopped.type === "state" && stopped.state.activity?.actor.deviceId === f.publisher.id, "receivers are told who stopped sharing");
  } finally { await f.close(); }
});

// A second publisher: Receiver shares its own capture.
async function publishOn(f: Fixture, client: Client, device: number, sourceId: string) {
  assert.equal((await client.command({ type: "publishLive", sourceId, uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
  return f.answerUploads(client, device);
}

test("consecutive sources from different publishers each leave out only their own publisher, and every output returns", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  const sorted = (...ids: string[]) => ids.sort();
  try {
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const other = await f.connect(2, "&audio=1&video=1");
    await f.publish("source-a");
    const upload = await publishOn(f, f.receiver, 1, "source-b");
    try {
      await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
      await until(() => !!f.publisher.load());
      await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
      await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 });
      await f.publisher.command({ type: "playLive", sourceId: "source-a", playNow: false });
      await f.publisher.command({ type: "playLive", sourceId: "source-b", playNow: false });
      await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
      const all = sorted(f.publisher.id, f.receiver.id, other.id);
      assert.deepEqual(receivers(f.publisher)?.sort(), all);
      const step = async (current: string, expected: string[]) => {
        assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
        await until(() => playingNow(f.publisher) === current && receivers(f.publisher)?.sort().join() === expected.join());
      };
      await step("Publisher · Screen", sorted(f.receiver.id, other.id));
      await step("Receiver · Screen", sorted(f.publisher.id, other.id));
      await step("after", all);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.deepEqual(receivers(f.publisher)?.sort(), all, "no output is lost on the way");
      assert.notEqual(f.publisher.state.player.status, "unavailable");
    } finally { upload.terminate(); }
  } finally { await f.close(); }
});

test("unpairing a held publisher retires its output, and the remaining receiver plays the next item", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! });
    await until(() => playingNow(f.receiver) === "Publisher · Screen" && receivers(f.receiver)?.join() === f.receiver.id);
    // The normal device API: it ends the publisher's capture too.
    const removal = await fetch(`${f.hub.origin}/api/devices/${f.publisher.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${"h".repeat(64)}` } });
    assert.equal(removal.status, 200);
    await until(() => !f.receiver.state.liveSources?.length);
    const play = await f.receiver.command({ type: "play", entryId: "after" });
    assert.equal(play.ok, true, play.error);
    await until(() => playingNow(f.receiver) === "after" && f.receiver.load()?.source === `${f.hub.origin}/api/health`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.receiver.state.player.error ?? null, null);
    assert.notEqual(f.receiver.state.player.status, "unavailable");
    assert.deepEqual(receivers(f.receiver), [f.receiver.id]);
  } finally { await f.close(); }
});

test("a private receiver joining the publisher's waiting playback leaves the publisher in control of it, and no further", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => !!f.publisher.state.playback);
    const waiting = f.publisher.state.playback;
    const joined = await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    assert.equal(joined.ok, true, joined.error);
    await until(() => direct(f.receiver.load()));
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    // The publisher keeps viewing and controlling the playback it asked for.
    assert.equal(f.receiver.state.playback, waiting);
    assert.equal(f.publisher.state.playback, waiting);
    assert.deepEqual(titles(f.publisher), ["Publisher · Screen"]);
    const pause = await f.publisher.command({ type: "pause", playbackId: f.publisher.state.player.playbackId!, paused: true });
    assert.equal(pause.ok, true, pause.error);
    await until(() => lastCommand(f.receiver) === "pause");
    // The receiver's output stays its own, and its consent unchanged.
    assert.deepEqual(consent(f.publisher, f.receiver.id), { audio: false, video: false });
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, false);
    assert.equal((await f.publisher.command({ type: "volume", deviceId: f.receiver.id, volume: 90 })).ok, false);
    assert.equal((await f.publisher.command({ type: "solo", deviceId: f.receiver.id })).ok, false);
    assert.deepEqual(receivers(f.publisher), [f.receiver.id]);
    // Another device still cannot join that private playback.
    const other = await f.connect(2);
    assert.match((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).error!, /playing privately on Receiver/);
    assert.equal((await other.command({ type: "stop", playbackId: f.publisher.state.player.playbackId! })).ok, false);
    assert.deepEqual(receivers(f.publisher), [f.receiver.id]);
  } finally { await f.close(); }
});

test("capture alone gives the publisher no control of a separate private playback of its source", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    f.receiver.report();
    await until(() => f.receiver.state.player.status === "playing");
    const { playbackId } = f.receiver.state.player;
    assert.equal(f.publisher.state.playback, null);
    assert.equal((await f.publisher.command({ type: "pause", playbackId: playbackId!, paused: true })).ok, false);
    // Its own request to choose is another playback; the private one stays out of its reach.
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => sharedPlaybacks(f.publisher).length === 2);
    assert.notEqual(f.publisher.state.playback, f.receiver.state.playback);
    assert.equal((await f.publisher.command({ type: "stop", playbackId: playbackId! })).ok, false);
    assert.equal(f.receiver.state.player.status, "playing");
  } finally { await f.close(); }
});

test("Only here rechecks every output it removes after the item resolves, and refuses when one turned private meanwhile", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  let block = false;
  const pending: ServerResponse[] = [];
  const respond = (response: ServerResponse) => { response.setHeader("Content-Type", "video/mp4"); response.end("fixture"); };
  const server = createServer((_request, response) => { if (block) pending.push(response); else respond(response); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "enqueue", entry: { id: "movie", title: "Movie", source: `http://127.0.0.1:${address.port}/movie.mp4` }, playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    f.publisher.report();
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 40 });
    // Receiver adds itself too, so its output is its own once it stops sharing.
    await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 40 });
    await f.speaker(0);
    await until(() => f.publisher.state.player.status === "playing");
    const before = f.publisher.state.outputs?.map(({ deviceId, picture, sound, local }) => ({ deviceId, picture, sound, local }));
    const outputs = () => f.publisher.state.outputs?.map(({ deviceId, picture, sound, local }) => ({ deviceId, picture, sound, local }));
    block = true;
    const move = f.publisher.command({ type: "solo", deviceId: f.publisher.id });
    await until(() => pending.length > 0);
    assert.equal((await f.receiver.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
    block = false;
    pending.splice(0).forEach(respond);
    const refused = await move;
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "Only here is unavailable while Receiver plays this privately.");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(outputs(), before, "membership is unchanged");
    assert.deepEqual(consent(f.publisher, f.receiver.id), { audio: false, video: false });
    assert.equal(f.publisher.state.player.status, "playing");
    // With the receiver sharing again, the same move succeeds and is exclusive.
    assert.equal((await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } })).ok, true);
    await until(() => consent(f.publisher, f.receiver.id)?.audio === true);
    const moved = await f.publisher.command({ type: "solo", deviceId: f.publisher.id });
    assert.equal(moved.ok, true, moved.error);
    await until(() => receivers(f.publisher)?.join() === f.publisher.id);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await f.close();
  }
});

// The publisher asked to choose; a receiver that keeps its outputs private then joined that playback.
async function establishedPrivate(f: Fixture) {
  await f.publish("screen");
  assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
  await until(() => !!f.publisher.state.playback);
  const playback = f.publisher.state.playback;
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => direct(f.receiver.load()));
  f.receiver.report();
  await until(() => f.publisher.state.player.status === "playing");
  return playback;
}

test("Only here counts a held publisher: refused and not offered while it is private, exclusive across Next once it shares", { timeout: 15_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    const local = await f.connect(3, "&audio=1&video=1");
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: local.id, picture: true, level: 50 });
    // Local claims its output, then keeps it private; the publisher's own output is private to it.
    await local.command({ type: "output", deviceId: local.id, picture: true, level: 50 });
    await local.command({ type: "sharing", sharing: { audio: false, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "last") });
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    await until(() => playingNow(local) === "Publisher · Screen" && receivers(local)?.join() === local.id);
    const outputs = local.state.outputs, load = local.load();
    // Local is the only current output, yet the publisher returns at Next: Only here cannot be exclusive.
    const rows = WhereItPlays({ state: local.state, connected: true, run: async () => true });
    assert.deepEqual({ checked: control(rows, "Only on Local")?.checked, disabled: control(rows, "Only on Local")?.disabled }, { checked: true, disabled: true });
    const refused = await local.command({ type: "solo", deviceId: local.id });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "Only here is unavailable while Publisher keeps its place in this playback privately.");
    assert.deepEqual(local.state.outputs, outputs);
    assert.equal(local.load(), load);
    assert.equal((await local.command({ type: "next", playbackId: local.state.player.playbackId! })).ok, true);
    await until(() => playingNow(local) === "after" && receivers(local)?.length === 2);
    assert.deepEqual(receivers(local)?.sort(), [f.publisher.id, local.id].sort(), "the refused move left the publisher's return as it was");
    // Shared, the held publisher no longer blocks: the pressed row commits, and Next keeps Local alone.
    assert.equal((await local.command({ type: "play", entryId: local.state.queue.find(entry => entry.liveSourceId)!.id })).ok, true);
    await until(() => playingNow(local) === "Publisher · Screen" && receivers(local)?.join() === local.id);
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await until(() => consent(local, f.publisher.id)?.video === true);
    const results: boolean[] = [];
    const only = control(WhereItPlays({ state: local.state, connected: true, run: async action => { const result = await local.command(action); results.push(result.ok); return result.ok; } }), "Only on Local")!;
    assert.deepEqual({ checked: only.checked, disabled: only.disabled }, { checked: true, disabled: false });
    only.onSelect!();
    await until(() => results.length === 1);
    assert.deepEqual(results, [true]);
    assert.equal((await local.command({ type: "next", playbackId: local.state.player.playbackId! })).ok, true);
    await until(() => playingNow(local) === "last");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(receivers(local), [local.id]);
  } finally { await f.close(); }
});

for (const sharing of ["", "&audio=1&video=1"]) test(`an established publisher keeps its playback when a ${sharing ? "shared" : "private"} receiver keeps its output private, with the host online`, { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1);
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => !!f.publisher.state.playback);
    const playback = f.publisher.state.playback;
    const receiver = sharing ? await f.connect(1, sharing) : f.receiver;
    assert.equal((await receiver.command({ type: "playLive", sourceId: "screen", deviceId: receiver.id })).ok, true);
    await until(() => direct(receiver.load()) && f.publisher.state.playback === playback);
    assert.equal((await receiver.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
    await until(() => consent(f.publisher, receiver.id)?.video === false);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.publisher.state.playback, playback, "Now Playing stays on the playback it controls");
    assert.notEqual(f.publisher.state.controlling, host.id);
    assert.deepEqual(titles(f.publisher), ["Publisher · Screen"]);
    // Implicit Queue reaches that playback, not a new one on the host.
    assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") })).ok, true);
    await until(() => receiver.state.queue.length === 2);
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(f.publisher.state.playbacks?.length, 1);
    assert.deepEqual(consent(f.publisher, receiver.id), { audio: false, video: false });
  } finally { await f.close(); }
});

test("a publisher on the host keeps its playback when its receiver keeps its output private", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1);
    const upload = await publishOn(f, host, -1, "host-screen");
    try {
      assert.equal((await host.command({ type: "playLive", sourceId: "host-screen", deviceId: host.id })).ok, true);
      await until(() => !!host.state.playback);
      const playback = host.state.playback;
      const receiver = await f.connect(1, "&audio=1&video=1");
      assert.equal((await receiver.command({ type: "playLive", sourceId: "host-screen", deviceId: receiver.id })).ok, true);
      await until(() => direct(receiver.load()));
      assert.equal((await receiver.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
      await until(() => consent(host, receiver.id)?.video === false);
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(host.state.playback, playback);
      assert.equal((await host.command({ type: "enqueue", entry: ordinary(f, "after") })).ok, true);
      await until(() => receiver.state.queue.length === 2);
      assert.equal(host.state.playbacks?.length, 1);
    } finally { upload.terminate(); }
  } finally { await f.close(); }
});

test("Play on the publisher again shows the playback it established, keeping its control and the private receiver", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const playback = await establishedPrivate(f);
    const load = f.receiver.load(), { playbackId } = f.receiver.state.player;
    const action = { type: "playLive", sourceId: "screen", deviceId: f.publisher.id } as const, before = f.publisher.state;
    const repeat = await f.publisher.command(action);
    assert.equal(repeat.ok, true, repeat.error);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(sharedPlaybacks(f.publisher).length, 1, "no outputless playback is forked");
    assert.equal(f.receiver.load(), load);
    // It leads to output selection in the requesting window only: Core asks no window, so the receiver plays on.
    assert.equal(choosesHere(action, before, f.publisher.state), true);
    assert.equal(chooserRequest(f.publisher.state), null);
    assert.equal(chooserRequest(f.receiver.state), null);
    assert.equal(f.receiver.state.player.status, "playing");
    const pause = await f.publisher.command({ type: "pause", playbackId: playbackId!, paused: true });
    assert.equal(pause.ok, true, pause.error);
    // Primary Play while viewing it is the same request.
    const primary = { type: "playLive", sourceId: "screen" } as const, viewing = f.publisher.state;
    assert.equal((await f.publisher.command(primary)).ok, true);
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(choosesHere(primary, viewing, f.publisher.state), true);
    // Play on the receiver joins rather than choosing, and Queue only queues.
    assert.equal(choosesHere({ ...action, deviceId: f.receiver.id }, before, f.publisher.state), false);
    assert.equal(choosesHere({ ...primary, playNow: false }, viewing, f.publisher.state), false);
    assert.equal(sharedPlaybacks(f.publisher).length, 1);
    assert.equal((await f.publisher.command({ type: "stop", playbackId: playbackId! })).ok, true);
  } finally { await f.close(); }
});

test("ordinary Play while holding a playback keeps its mix; Play on the publisher still isolates it", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "before"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
    await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
    await f.receiver.command({ type: "sharing", sharing: { audio: false, video: false } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
    assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
    await until(() => playingNow(f.receiver) === "Publisher · Screen" && receivers(f.publisher)?.join() === f.receiver.id);
    const playback = f.publisher.state.playback;
    const play = await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true });
    assert.equal(play.ok, true, play.error);
    await until(() => playingNow(f.publisher) === "movie" && receivers(f.publisher)?.length === 2);
    assert.equal(f.publisher.state.playback, playback, "the selected mix keeps its playback");
    assert.deepEqual(receivers(f.publisher)?.sort(), [f.publisher.id, f.receiver.id].sort(), "the publisher returns to it");
    assert.equal(f.receiver.state.playback, playback);
    assert.equal((await f.publisher.command({ type: "pause", playbackId: f.publisher.state.player.playbackId!, paused: true })).ok, true);
    // Back on the source, explicit Play on the publisher isolates it in a playback of its own.
    assert.equal((await f.publisher.command({ type: "play", entryId: f.publisher.state.queue.find(entry => entry.liveSourceId)!.id })).ok, true);
    await until(() => playingNow(f.publisher) === "Publisher · Screen" && receivers(f.publisher)?.join() === f.receiver.id);
    assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "alone"), playNow: true, deviceId: f.publisher.id })).ok, true);
    await until(() => playingNow(f.publisher) === "alone");
    assert.notEqual(f.publisher.state.playback, playback);
    assert.deepEqual(receivers(f.publisher), [f.publisher.id]);
    assert.equal(f.receiver.state.playback, playback);
  } finally { await f.close(); }
});

for (const entry of ["find", "picker"] as const) test(`an established publisher adds a shared device to its playback the same way from ${entry === "find" ? "Find" : "Where it plays"}`, { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const playback = await establishedPrivate(f);
    const queue = f.publisher.state.queue;
    // Somebody with no place in it is refused.
    const outsider = await f.connect(-1);
    assert.match((await outsider.command({ type: "playLive", sourceId: "screen", deviceId: outsider.id })).error!, /playing privately on Receiver/);
    const other = await f.connect(2, "&audio=1&video=1");
    const join = entry === "find" ? await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: other.id }) : await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 });
    assert.equal(join.ok, true, join.error);
    await until(() => direct(other.load()) && receivers(f.publisher)?.length === 2);
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(other.state.playback, playback);
    assert.deepEqual(f.publisher.state.queue, queue);
    assert.equal(other.load()!.playbackId, f.receiver.state.player.playbackId, "it joins the same item and clock");
    assert.equal(sharedPlaybacks(f.publisher).length, 1);
    assert.deepEqual(consent(f.publisher, f.receiver.id), { audio: false, video: false });
  } finally { await f.close(); }
});

for (const revoked of ["video", "audio"] as const) test(`a held remote output keeps its still-shared ${revoked === "video" ? "sound" : "picture"} after its ${revoked === "video" ? "screen" : "speakers"} stop being shared`, { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    await f.receiver.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.publisher.id, picture: true, level: 50 })).ok, true);
    await f.receiver.command({ type: "playLive", sourceId: "screen", playNow: false });
    await f.receiver.command({ type: "enqueue", entry: ordinary(f, "after") });
    await f.receiver.command({ type: "next", playbackId: f.receiver.state.player.playbackId! });
    await until(() => playingNow(f.receiver) === "Publisher · Screen" && receivers(f.receiver)?.join() === f.receiver.id);
    await f.publisher.command({ type: "sharing", sharing: { audio: revoked !== "audio", video: revoked !== "video" } });
    await until(() => consent(f.receiver, f.publisher.id)?.[revoked] === false);
    // Shared again before the return: a retired channel stays retired, as for an active output.
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await until(() => consent(f.receiver, f.publisher.id)?.[revoked] === true);
    assert.equal((await f.receiver.command({ type: "next", playbackId: f.receiver.state.player.playbackId! })).ok, true);
    await until(() => playingNow(f.receiver) === "after" && receivers(f.receiver)?.length === 2);
    const returned = f.receiver.state.outputs?.find(output => output.deviceId === f.publisher.id);
    assert.deepEqual({ picture: returned?.picture, sound: returned?.sound, local: returned?.local }, { picture: revoked !== "video", sound: revoked !== "audio", local: false });
  } finally { await f.close(); }
});

test("primary Play of another publisher's source keeps the held publisher in the mix; explicit Play on still isolates", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("publisher-screen");
    const upload = await publishOn(f, f.receiver, 1, "receiver-screen");
    try {
      await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
      await until(() => !!f.publisher.load());
      await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
      await f.publisher.command({ type: "playLive", sourceId: "publisher-screen", playNow: false });
      assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
      await until(() => f.receiver.load()?.liveSourceId === "publisher-screen" && direct(f.receiver.load()));
      f.receiver.report();
      await until(() => f.publisher.state.player.status === "playing");
      const playback = f.publisher.state.playback, held = () => f.publisher.state.playbacks?.find(item => item.id === playback)?.held?.deviceId;
      assert.deepEqual({ outputs: receivers(f.publisher), held: held() }, { outputs: [f.receiver.id], held: f.publisher.id });
      // Primary Play of the receiver's capture: the selected mix moves with it, so each publisher swaps places.
      const play = await f.publisher.command({ type: "playLive", sourceId: "receiver-screen" });
      assert.equal(play.ok, true, play.error);
      await until(() => playingNow(f.publisher) === "Receiver · Screen" && direct(f.publisher.load()) && f.publisher.load()?.liveSourceId === "receiver-screen");
      assert.equal(f.publisher.state.playback, playback);
      assert.deepEqual({ outputs: receivers(f.publisher), held: held() }, { outputs: [f.publisher.id], held: f.receiver.id });
      assert.equal(chooserRequest(f.publisher.state), null, "a receiver remains, so nothing waits in Where it plays");
      assert.deepEqual(titles(f.publisher), ["movie", "Publisher · Screen", "Receiver · Screen"]);
      // The next ordinary Play restores both.
      assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after"), playNow: true })).ok, true);
      await until(() => playingNow(f.publisher) === "after" && receivers(f.publisher)?.length === 2);
      assert.equal(f.publisher.state.playback, playback);
      assert.deepEqual(receivers(f.publisher)?.sort(), [f.publisher.id, f.receiver.id].sort());
      // Explicit Play on still isolates: back on the publisher's capture, Play on Publisher takes it out of the mix.
      assert.equal((await f.publisher.command({ type: "play", entryId: f.publisher.state.queue.find(entry => entry.liveSourceId === "publisher-screen")!.id })).ok, true);
      await until(() => playingNow(f.publisher) === "Publisher · Screen" && receivers(f.publisher)?.join() === f.receiver.id);
      assert.equal((await f.publisher.command({ type: "playLive", sourceId: "receiver-screen", deviceId: f.publisher.id })).ok, true);
      await until(() => f.publisher.state.playback !== playback && direct(f.publisher.load()) && f.publisher.load()?.liveSourceId === "receiver-screen");
      assert.deepEqual(receivers(f.publisher), [f.publisher.id]);
      assert.equal(f.receiver.state.playback, playback);
      // It moved, so it does not return.
      await until(() => !!f.receiver.state.playbacks?.some(item => item.id === playback && !item.held));
    } finally { upload.terminate(); }
  } finally { await f.close(); }
});

// From a playing group or Direct receiver, the selected mix moves to the next publisher's source however it is played.
// A retired held output (consent revoked, or moved to another playback) is the control: it does not return.
for (const [count, entry, retired] of [[2, "primary"], [2, "next"], [3, "primary"], [3, "next"], [3, "primary", "revoked"], [3, "primary", "moved"]] as const) {
  test(`with ${count} selected devices, ${entry === "primary" ? "primary Play" : "Next"} of another publisher's source swaps the held publisher${retired ? `, and a ${retired} one stays retired` : ""}`, { timeout: 15_000 }, async () => {
    const f = await liveFixture();
    try {
      await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
      await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
      const other = count === 3 ? await f.connect(2, "&audio=1&video=1") : undefined;
      await f.publish("publisher-screen");
      const upload = await publishOn(f, f.receiver, 1, "receiver-screen");
      try {
        await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
        await until(() => !!f.publisher.load());
        // A real speaker joins before the group forms, so it plays the fixture's PCM.
        if (other) await f.speaker(1);
        await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
        if (other) await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 });
        const all = [f.publisher.id, f.receiver.id, ...other ? [other.id] : []].sort();
        await f.publisher.command({ type: "playLive", sourceId: "publisher-screen", playNow: false });
        assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
        await until(() => playingNow(f.publisher) === "Publisher · Screen" && receivers(f.publisher)?.length === count - 1);
        await until(() => f.receiver.load()?.liveSourceId === "publisher-screen" && (!other || other.load()?.liveSourceId === "publisher-screen"));
        f.receiver.report();
        await until(() => f.publisher.state.player.status === "playing");
        const playback = f.publisher.state.playback, mix = () => { const item = f.publisher.state.playbacks?.find(item => item.id === playback); return { outputs: receivers(f.publisher)?.sort(), held: item?.held?.deviceId }; };
        assert.deepEqual(mix(), { outputs: all.filter(id => id !== f.publisher.id), held: f.publisher.id });
        if (entry === "next") assert.equal((await f.publisher.command({ type: "playLive", sourceId: "receiver-screen", playNow: false })).ok, true);
        const transition = await f.publisher.command(entry === "primary" ? { type: "playLive", sourceId: "receiver-screen" } : { type: "next", playbackId: f.publisher.state.player.playbackId! });
        assert.equal(transition.ok, true, transition.error);
        await until(() => playingNow(f.publisher) === "Receiver · Screen" && f.publisher.state.playbacks?.find(item => item.id === playback)?.liveSourceId === "receiver-screen");
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(f.publisher.state.playback, playback);
        assert.deepEqual(titles(f.publisher), ["movie", "Publisher · Screen", "Receiver · Screen"]);
        assert.deepEqual(mix(), { outputs: all.filter(id => id !== f.receiver.id), held: f.receiver.id });
        assert.equal(chooserRequest(f.publisher.state), null);
        // Neither publisher ever receives its own capture, Direct or as a synchronized picture.
        const captured = (client: Client, sourceId: string) => loads(client).some(load => load.liveSourceId === sourceId || load.source.includes(`/api/live/media/${sourceId}/`));
        await until(() => captured(f.publisher, "receiver-screen") && (!other || captured(other, "receiver-screen")));
        assert.deepEqual([captured(f.publisher, "publisher-screen"), captured(f.receiver, "receiver-screen")], [false, false]);
        if (retired === "revoked") {
          await f.receiver.command({ type: "sharing", sharing: { audio: false, video: false } });
          await until(() => consent(f.publisher, f.receiver.id)?.audio === false);
        } else if (retired === "moved") {
          assert.equal((await f.receiver.command({ type: "enqueue", entry: ordinary(f, "elsewhere"), playNow: true, deviceId: f.receiver.id })).ok, true);
          await until(() => f.receiver.state.playback !== playback && playingNow(f.receiver) === "elsewhere");
        }
        // The next ordinary item plays on the whole selected mix, less only a retired output.
        const expected = retired ? all.filter(id => id !== f.receiver.id) : all;
        assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after"), playNow: true })).ok, true);
        await until(() => playingNow(f.publisher) === "after" && receivers(f.publisher)?.length === expected.length);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(f.publisher.state.playback, playback);
        assert.deepEqual(mix(), { outputs: expected, held: undefined });
        if (retired === "moved") assert.deepEqual(receivers(f.receiver), [f.receiver.id]);
      } finally { upload.terminate(); }
    } finally { await f.close(); }
  });
}

// Up next reaches its 500-entry limit through ordinary Queue, paced under the command limit.
async function fillQueue(f: Fixture) {
  for (let index = f.publisher.state.queue.length; index < 500; index++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, `filler-${index}`), playNow: false })).ok, true);
  }
  assert.equal(f.publisher.state.queue.length, 500);
}
// What a refused Play must leave as it was, and every player command or speaker instruction sent since.
function settled(f: Fixture, clients: Client[]) {
  const counts = clients.map(client => client.messages.length);
  const snapshot = () => {
    const { state } = f.publisher, item = state.playbacks?.find(item => item.id === state.playback);
    return { playback: state.playback, playbackId: state.player.playbackId, status: state.player.status, playing: playingNow(f.publisher), outputs: receivers(f.publisher)?.sort(), held: item?.held?.deviceId,
      controlling: state.controlling, chooser: chooserRequest(state), consent: clients.map(client => consent(f.publisher, client.id)) };
  };
  return { snapshot, since: () => clients.map((client, index) => client.messages.slice(counts[index]).flatMap(message =>
    message.type === "player" && message.command.type !== "volume" ? [message.command.type] : message.type === "sendspin" && message.listen ? ["listen"] : [])) };
}

// A Play the Session refuses (Up next is full) changes nothing: the receivers keep playing and the publisher stays out of its own capture.
for (const count of [2, 3] as const) {
  test(`with ${count} selected devices, a refused primary Play of another publisher's source leaves the playing mix as it was`, { timeout: 30_000 }, async () => {
    const f = await liveFixture();
    try {
      await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
      await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
      const other = count === 3 ? await f.connect(2, "&audio=1&video=1") : undefined;
      await f.publish("publisher-screen");
      const upload = await publishOn(f, f.receiver, 1, "receiver-screen");
      try {
        await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
        await until(() => !!f.publisher.load());
        if (other) await f.speaker(1);
        await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 50 });
        if (other) await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 });
        const all = [f.publisher.id, f.receiver.id, ...other ? [other.id] : []].sort();
        await f.publisher.command({ type: "playLive", sourceId: "publisher-screen", playNow: false });
        assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
        await until(() => playingNow(f.publisher) === "Publisher · Screen" && receivers(f.publisher)?.length === count - 1);
        await until(() => f.receiver.load()?.liveSourceId === "publisher-screen" && (!other || other.load()?.liveSourceId === "publisher-screen"));
        f.receiver.report();
        await until(() => f.publisher.state.player.status === "playing");
        await fillQueue(f);
        // A speaker connected for the publisher, against Core's instruction, still hears nothing of its own capture.
        if (other) await f.speaker(0);
        const queue = f.publisher.state.queue.map(entry => entry.id), clients = [f.publisher, f.receiver, ...other ? [other] : []];
        const { snapshot, since } = settled(f, clients), before = snapshot();
        assert.deepEqual({ outputs: before.outputs, held: before.held }, { outputs: all.filter(id => id !== f.publisher.id), held: f.publisher.id });
        const refused = await f.publisher.command({ type: "playLive", sourceId: "receiver-screen" });
        assert.deepEqual({ ok: refused.ok, error: refused.error }, { ok: false, error: "Up next is full (500). Remove some first." });
        // A harmless queue edit publishes the mix: nothing changed in it, and nothing was stopped, loaded or heard.
        assert.equal((await f.publisher.command({ type: "remove", entryId: "filler-499" })).ok, true);
        await until(() => f.publisher.state.queue.length === 499);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(f.publisher.state.queue.map(entry => entry.id), queue.filter(id => id !== "filler-499"));
        assert.deepEqual(since(), clients.map(() => []));
        assert.equal(f.heard(0), 0);
        // With room in Up next, the same Play moves the mix.
        const play = await f.publisher.command({ type: "playLive", sourceId: "receiver-screen" });
        assert.equal(play.ok, true, play.error);
        await until(() => playingNow(f.publisher) === "Receiver · Screen" && f.publisher.state.playbacks?.find(item => item.id === before.playback)?.liveSourceId === "receiver-screen");
        await new Promise(resolve => setTimeout(resolve, 50));
        const { playback, playing, outputs, held, chooser } = snapshot();
        assert.deepEqual({ playback, playing, outputs, held, chooser }, { playback: before.playback, playing: "Receiver · Screen", outputs: all.filter(id => id !== f.receiver.id), held: f.receiver.id, chooser: null });
        const captured = (client: Client, sourceId: string) => loads(client).some(load => load.liveSourceId === sourceId || load.source.includes(`/api/live/media/${sourceId}/`));
        await until(() => captured(f.publisher, "receiver-screen") && (!other || captured(other, "receiver-screen")));
        assert.deepEqual([captured(f.publisher, "publisher-screen"), captured(f.receiver, "receiver-screen")], [false, false]);
        // The publisher receives the receiver's capture directly; no group forms.
        assert.ok(direct(f.publisher.load()));
        assert.equal((await f.publisher.command({ type: "remove", entryId: "filler-498" })).ok, true);
        assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after"), playNow: true })).ok, true);
        await until(() => playingNow(f.publisher) === "after" && receivers(f.publisher)?.length === all.length);
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual({ playback: f.publisher.state.playback, outputs: receivers(f.publisher)?.sort(), held: f.publisher.state.playbacks?.find(item => item.id === before.playback)?.held }, { playback: before.playback, outputs: all, held: undefined });
      } finally { upload.terminate(); }
    } finally { await f.close(); }
  });
}

test("a refused Play of its own source, explicit or primary, leaves the publisher playing what it played", { timeout: 30_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.publisher.id });
    await until(() => !!f.publisher.load());
    f.publisher.report();
    await until(() => f.publisher.state.player.status === "playing");
    await fillQueue(f);
    const { snapshot, since } = settled(f, [f.publisher]), before = snapshot();
    assert.deepEqual({ outputs: before.outputs, held: before.held }, { outputs: [f.publisher.id], held: undefined });
    for (const action of [{ type: "playLive", sourceId: "screen", deviceId: f.publisher.id }, { type: "playLive", sourceId: "screen" }] as const) {
      const refused = await f.publisher.command(action);
      assert.deepEqual({ ok: refused.ok, error: refused.error }, { ok: false, error: "Up next is full (500). Remove some first." });
    }
    assert.equal((await f.publisher.command({ type: "remove", entryId: "filler-499" })).ok, true);
    await until(() => f.publisher.state.queue.length === 499);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(since(), [[]]);
    // With room, Play on itself leads to Where it plays, its own output held.
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
    await until(() => playingNow(f.publisher) === "Publisher · Screen" && !!chooserRequest(f.publisher.state));
    assert.deepEqual({ playback: f.publisher.state.playback, outputs: receivers(f.publisher), held: f.publisher.state.playbacks?.find(item => item.id === before.playback)?.held?.deviceId }, { playback: before.playback, outputs: [], held: f.publisher.id });
  } finally { await f.close(); }
});

// Publisher's own ordinary output holds its picture privately; it then plays its own screen, held out of it.
async function heldPrivately(f: Fixture, sharing: { audio: boolean; video: boolean }) {
  await f.publisher.command({ type: "sharing", sharing });
  await f.publish("screen");
  const local = await f.connect(3);
  await f.publisher.command({ type: "enqueue", entry: ordinary(f, "publisher-movie"), playNow: true, deviceId: f.publisher.id });
  await until(() => !!f.publisher.load());
  await local.command({ type: "enqueue", entry: ordinary(f, "local-movie"), playNow: true, deviceId: local.id });
  await until(() => !!local.load());
  return local;
}
async function holdPublisher(f: Fixture, local: Client) {
  assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id })).ok, true);
  assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
  await until(() => direct(f.receiver.load()));
  await f.publisher.command({ type: "enqueue", entry: ordinary(f, "after") });
  const playback = f.publisher.state.playback!;
  await until(() => !!local.state.playbacks?.some(item => item.id === playback && item.held?.deviceId === f.publisher.id));
  return playback;
}

test("replacing a held publisher needs the consent its held private picture would need while active", { timeout: 15_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    const local = await heldPrivately(f, { audio: true, video: false });
    const rows = () => WhereItPlays({ state: local.state, connected: true, run: async () => true });
    const refusal = "Publisher is not sharing video.";
    // Active: the speakers alone do not let Local take the publisher's private picture output, so its row is disabled.
    assert.equal(control(rows(), "Publisher")?.disabled, true);
    assert.equal((await local.command({ type: "output", deviceId: f.publisher.id, level: 50 })).error, refusal);
    const playback = await holdPublisher(f, local);
    const localOutputs = local.state.outputs, localLoad = local.load(), queue = f.publisher.state.queue;
    // Held, the same: Where it plays, Play on, and Only here are each refused, and the picker agrees.
    assert.deepEqual([control(rows(), "Publisher")?.disabled, control(rows(), "Publisher picture"), control(rows(), "Only on Publisher")], [true, undefined, undefined]);
    assert.equal((await local.command({ type: "output", deviceId: f.publisher.id, level: 50 })).error, refusal);
    assert.equal((await local.command({ type: "enqueue", entry: ordinary(f, "taken"), playNow: true, deviceId: f.publisher.id })).error, refusal);
    assert.equal((await local.command({ type: "solo", deviceId: f.publisher.id })).error, refusal);
    await new Promise(resolve => setTimeout(resolve, 50));
    // Nothing changed: both playbacks, the queue, consent, and the publisher's control of its playback.
    assert.equal(f.publisher.state.playback, playback);
    assert.equal(f.publisher.state.playbacks?.find(item => item.id === playback)?.held?.deviceId, f.publisher.id);
    assert.deepEqual(f.publisher.state.queue, queue);
    assert.deepEqual(local.state.outputs, localOutputs);
    assert.equal(local.load(), localLoad);
    assert.deepEqual(consent(local, f.publisher.id), { audio: true, video: false });
    assert.equal((await f.publisher.command({ type: "pause", playbackId: f.receiver.state.player.playbackId!, paused: true })).ok, true);
    // Its held picture returns at Next.
    assert.equal((await f.receiver.command({ type: "next", playbackId: f.receiver.state.player.playbackId! })).ok, true);
    await until(() => playingNow(f.receiver) === "after" && receivers(f.receiver)?.length === 2);
    assert.deepEqual(f.receiver.state.outputs?.find(output => output.deviceId === f.publisher.id), { deviceId: f.publisher.id, picture: true, sound: true, local: true });
    // The owner still moves itself: back on its source, Play on Publisher leaves the held place for good.
    assert.equal((await f.publisher.command({ type: "play", entryId: f.publisher.state.queue.find(entry => entry.liveSourceId)!.id })).ok, true);
    await until(() => f.receiver.state.playbacks?.find(item => item.id === playback)?.held?.deviceId === f.publisher.id);
    assert.equal((await f.publisher.command({ type: "enqueue", entry: ordinary(f, "mine"), playNow: true, deviceId: f.publisher.id })).ok, true);
    await until(() => playingNow(f.publisher) === "mine");
    assert.notEqual(f.publisher.state.playback, playback);
    await until(() => !!f.receiver.state.playbacks?.some(item => item.id === playback && !item.held));
  } finally { await f.close(); }
});

test("a held publisher that shares every channel it holds can be moved to another playback, which retires its place", { timeout: 15_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    const local = await heldPrivately(f, { audio: true, video: true });
    const playback = await holdPublisher(f, local);
    const results: boolean[] = [];
    const row = control(WhereItPlays({ state: local.state, connected: true, run: async action => { const result = await local.command(action); results.push(result.ok); return result.ok; } }), "Publisher")!;
    assert.equal(row.disabled, false);
    row.onClick!();
    await until(() => results.length === 1);
    assert.deepEqual(results, [true]);
    await until(() => receivers(local)?.length === 2);
    assert.equal(f.receiver.state.playbacks?.find(item => item.id === playback)?.held, undefined);
    assert.equal((await f.receiver.command({ type: "next", playbackId: f.receiver.state.player.playbackId! })).ok, true);
    await until(() => playingNow(f.receiver) === "after");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(receivers(f.receiver), [f.receiver.id], "it moved, so it does not return");
  } finally { await f.close(); }
});

test("consent that leaves a live source no output it uses makes it wait in Where it plays, for picture-only and audio-only sources", { timeout: 20_000 }, async () => {
  for (const [kind, audio, withdrawn] of [["screen", false, { audio: true, video: false }], ["system-audio", true, { audio: false, video: true }]] as const) {
    const f = await liveFixture();
    try {
      await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
      await f.publish("source", kind, audio);
      assert.equal((await f.publisher.command({ type: "playLive", sourceId: "source", deviceId: f.receiver.id })).ok, true);
      await until(() => direct(f.receiver.load()));
      f.receiver.report();
      await until(() => f.publisher.state.player.status === "playing");
      const playback = f.publisher.state.playback, sheet = chooser(f.publisher);
      // The receiver still shares the other channel, which this source does not use.
      const withdrawal = await f.receiver.command({ type: "sharing", sharing: withdrawn });
      assert.equal(withdrawal.ok, true, `${kind}: ${withdrawal.error}`);
      await until(() => f.publisher.state.player.status === "paused");
      assert.equal(f.publisher.state.player.error, "Receiver is not sharing an output this source uses. Choose where it plays.");
      assert.deepEqual(f.publisher.state.outputs, []);
      assert.equal(f.publisher.state.playback, playback);
      assert.equal(lastCommand(f.receiver), "stop");
      assert.equal(sheet.observe(), 1, `${kind}: Where it plays opens`);
      // Where it plays starts it on a device that shares what the source uses.
      const other = await f.connect(2, "&audio=1&video=1");
      assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
      await until(() => direct(other.load()));
      assert.equal(other.load()!.paused, false);
      await until(() => receivers(f.publisher)?.join() === other.id);
      assert.equal(f.publisher.state.playback, playback, "the controller that chose keeps viewing it");
      assert.equal(loads(f.publisher).some(load => "livePeerId" in load), false, "its publisher still never receives it");
    } finally { await f.close(); }
  }
});

test("a live source keeps playing while a remaining output uses it, a private one too, and waits once none does", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen", "screen", false);
    // Receiver plays it privately on itself; Other joins its mix by consent.
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => direct(f.receiver.load()));
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    await until(() => receivers(f.receiver)?.length === 2);
    assert.equal((await other.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    await until(() => f.receiver.state.outputs?.find(output => output.deviceId === other.id)?.picture === false);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.receiver.state.player.error, null, "the private picture still plays it");
    assert.ok(f.receiver.state.outputs?.find(output => output.deviceId === f.receiver.id)?.picture);
    assert.equal(chooserRequest(f.receiver.state), null);
  } finally { await f.close(); }
  // A remote group: the first withdrawal leaves a compatible receiver, the second none.
  const g = await liveFixture();
  try {
    const third = await g.connect(2, "&audio=1&video=1");
    await g.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await g.publish("screen", "screen", false);
    assert.equal((await g.publisher.command({ type: "playLive", sourceId: "screen", deviceId: g.receiver.id })).ok, true);
    await until(() => direct(g.receiver.load()));
    assert.equal((await g.publisher.command({ type: "output", deviceId: third.id, level: 50, picture: true })).ok, true);
    await until(() => receivers(g.publisher)?.length === 2);
    assert.equal((await g.receiver.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    await until(() => g.publisher.state.outputs?.find(output => output.deviceId === g.receiver.id)?.picture === false);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(g.publisher.state.outputs?.find(output => output.deviceId === third.id)?.picture, "a compatible receiver remains");
    assert.equal(g.publisher.state.player.error, null);
    assert.equal(chooserRequest(g.publisher.state), null);
    assert.equal((await third.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    await until(() => g.publisher.state.player.status === "paused");
    assert.deepEqual(g.publisher.state.outputs, [], "sound-only receivers leave a picture-only source");
    assert.equal(g.publisher.state.player.error, "Other is not sharing an output this source uses. Choose where it plays.");
    assert.notEqual(chooserRequest(g.publisher.state), null);
  } finally { await g.close(); }
});

test("private outputs a live source cannot use keep it waiting in Where it plays across a reconnect, until one uses it", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("audio", "system-audio", true);
    // Receiver plays it privately, its sound out and its picture kept; Other's speaker is the only sound.
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "audio", deviceId: f.receiver.id })).ok, true);
    await until(() => direct(f.receiver.load()));
    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 50 })).ok, true);
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, true);
    await until(() => receivers(f.receiver)?.length === 2);
    const playback = f.receiver.state.playback, sheet = chooser(f.receiver);
    const withdrawal = await other.command({ type: "sharing", sharing: { audio: false, video: true } });
    assert.equal(withdrawal.ok, true, withdrawal.error);
    await until(() => f.receiver.state.player.status === "paused");
    const waiting = { status: "paused", error: "Other is not sharing an output this source uses. Choose where it plays." };
    assert.deepEqual({ status: f.receiver.state.player.status, error: f.receiver.state.player.error }, waiting);
    assert.deepEqual(f.receiver.state.outputs?.map(output => [output.deviceId, output.picture, output.sound]), [[f.receiver.id, true, false]], "its private picture stays");
    assert.equal(sheet.observe(), 1);
    const request = chooserRequest(f.receiver.state);
    // Its tab reconnects: it keeps waiting with the same request rather than failing the item.
    const tab = await f.connect(1);
    await until(() => tab.state.playback === playback);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual({ status: tab.state.player.status, error: tab.state.player.error }, waiting);
    assert.equal(chooserRequest(tab.state), request);
    assert.equal(tab.load(), undefined, "nothing it cannot use loads");
    // Its own sound uses the source, so raising it starts it there.
    assert.equal((await tab.command({ type: "output", deviceId: f.receiver.id, level: 40 })).ok, true);
    await until(() => direct(tab.load()));
    assert.equal(tab.load()!.paused, false);
    assert.equal(chooserRequest(tab.state), null);
    assert.equal(tab.state.playback, playback);
    assert.equal(loads(f.publisher).some(load => "livePeerId" in load || load.source.includes("/api/live/")), false, "its publisher still never receives it");
  } finally { await f.close(); }
  // Alone, a private picture of an audio-only source waits too once it loads again.
  const g = await liveFixture();
  try {
    await g.publish("audio", "system-audio", true);
    assert.equal((await g.receiver.command({ type: "playLive", sourceId: "audio", deviceId: g.receiver.id })).ok, true);
    await until(() => direct(g.receiver.load()));
    assert.equal((await g.receiver.command({ type: "output", deviceId: g.receiver.id, level: 0 })).ok, true);
    const tab = await g.connect(1);
    await until(() => tab.state.player.status !== "playing");
    assert.deepEqual({ status: tab.state.player.status, error: tab.state.player.error }, { status: "paused", error: "Publisher is sharing this source. Choose where it plays." });
    assert.notEqual(chooserRequest(tab.state), null);
  } finally { await g.close(); }
});

// Next onto a queued item of the source, directly or after an ordinary item the pictures play, waits unloaded with them.
for (const via of ["", "a queued item of it", "an ordinary item and a queued item of it"] as const) test(`two private pictures a live source cannot use keep its group waiting in Where it plays, until one of them uses it${via && `, after Next to ${via}`}`, { timeout: 20_000 }, async () => {
  const f = await liveFixture({ local: true });
  try {
    await f.publish("audio", "system-audio", true);
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const local = await f.connect(3), other = await f.connect(2, "&audio=1&video=1");
    await f.speaker(1);
    await f.speaker(2);
    // Receiver and Local play it privately with their pictures kept and sound out; Other's speaker is shared.
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "audio", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    f.receiver.report();
    assert.equal((await f.receiver.command({ type: "inSync", inSync: true })).ok, true);
    assert.equal((await local.command({ type: "playLive", sourceId: "audio", deviceId: local.id })).ok, true);
    await until(() => receivers(f.receiver)?.length === 2);
    assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, level: 50, picture: true })).ok, true);
    for (const client of [f.receiver, local]) {
      assert.equal((await client.command({ type: "output", deviceId: client.id, level: 0 })).ok, true);
      assert.equal((await client.command({ type: "sharing", sharing: { audio: false, video: false } })).ok, true);
    }
    await until(() => f.receiver.state.outputs?.filter(output => output.local && output.picture && !output.sound).length === 2);
    await until(() => f.heard(2) > 0 && f.receiver.state.player.status === "playing");
    // Withdrawing a channel it does not use leaves Other's sound playing it.
    assert.equal((await other.command({ type: "sharing", sharing: { audio: true, video: false } })).ok, true);
    const heard = f.heard(2);
    await until(() => f.heard(2) > heard);
    assert.equal(f.receiver.state.player.status, "playing");
    assert.equal(chooserRequest(f.receiver.state), null);
    const playback = f.receiver.state.playback, playbackId = f.receiver.state.player.playbackId, sheet = chooser(f.receiver);
    // Withdrawing its last sound leaves only the private pictures: the group waits instead of playing to nobody.
    assert.equal((await other.command({ type: "sharing", sharing: { audio: false, video: true } })).ok, true);
    await until(() => receivers(f.receiver)?.length === 2);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.deepEqual({ status: f.receiver.state.player.status, error: f.receiver.state.player.error }, { status: "paused", error: "Other is not sharing an output this source uses. Choose where it plays." });
    assert.deepEqual(f.receiver.state.outputs?.map(output => [output.deviceId, output.picture, output.sound]).sort(), [[f.receiver.id, true, false], [local.id, true, false]].sort(), "the private pictures stay");
    assert.equal(sheet.observe(), 1);
    if (via) {
      if (via.startsWith("an ordinary")) assert.equal((await f.receiver.command({ type: "enqueue", entry: ordinary(f, "movie") })).ok, true);
      assert.equal((await f.receiver.command({ type: "playLive", sourceId: "audio", playNow: false })).ok, true);
      if (via.startsWith("an ordinary")) {
        // Both pictures show an ordinary item, which closes the request.
        assert.equal((await f.receiver.command({ type: "next", playbackId: f.receiver.state.player.playbackId! })).ok, true);
        await until(() => playingNow(f.receiver) === "movie" && [f.receiver, local].every(client => client.load()?.playbackId === f.receiver.state.player.playbackId));
        assert.equal(chooserRequest(f.receiver.state), null);
      }
      const from = f.receiver.state.player.playbackId;
      assert.equal((await f.receiver.command({ type: "next", playbackId: from! })).ok, true);
      await until(() => f.receiver.state.player.playbackId !== from && f.receiver.state.player.status === "paused" && chooserRequest(f.receiver.state) !== null);
      assert.deepEqual(f.receiver.state.outputs?.map(output => [output.deviceId, output.picture, output.sound]).sort(), [[f.receiver.id, true, false], [local.id, true, false]].sort(), "the private pictures stay");
    }
    const current = f.receiver.state.player.playbackId;
    // Receiver's own sound uses it, so raising it starts the current item in the same playback and closes the request.
    assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, level: 40 })).ok, true);
    await until(() => f.receiver.state.player.status === "playing");
    const resumed = f.heard(1);
    await until(() => f.heard(1) > resumed);
    assert.equal(chooserRequest(f.receiver.state), null);
    assert.equal(f.receiver.state.player.error, null);
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.player.playbackId, via ? current : playbackId);
    assert.equal(loads(f.publisher).some(load => "livePeerId" in load || load.source.includes("/api/live/")), false, "its publisher never receives it");
  } finally { await f.close(); }
});

test("an output that goes offline supersedes a Play it never confirmed, while a new tab of it keeps that Play", { timeout: 15_000 }, async () => {
  for (const [pending, handover] of [[false, false], [true, false], [true, true]]) {
    const f = await liveFixture();
    try {
      assert.equal((await f.receiver.command({ type: "enqueue", entry: ordinary(f, "movie"), deviceId: f.receiver.id, playNow: true })).ok, true);
      await until(() => !!f.receiver.load());
      f.receiver.report({ status: "paused", position: 31, duration: 100, seekable: true });
      await until(() => f.receiver.state.player.status === "paused");
      const playback = f.receiver.state.playback, playbackId = f.receiver.state.player.playbackId!;
      // Its renderer never acknowledges the Play.
      if (pending) assert.equal((await f.receiver.command({ type: "pause", playbackId, paused: false })).ok, true);
      if (!handover) {
        f.receiver.socket.close();
        await until(() => f.publisher.state.devices?.find(device => device.id === f.receiver.id)?.online === false);
        assert.equal(f.publisher.state.playbacks?.find(item => item.id === playback)?.status, "paused");
      }
      const tab = await f.connect(1);
      await until(() => !!tab.load());
      assert.deepEqual({ playbackId: tab.load()!.playbackId, paused: tab.load()!.paused, at: tab.load()!.startPosition }, { playbackId, paused: !handover, at: 31 }, `pending=${pending} handover=${handover}`);
    } finally { await f.close(); }
  }
});

test("a held publisher that returns for the next source counts as an output it uses, so that source plays rather than waits", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    const other = await f.connect(2, "&video=1");
    await f.publish("audio", "system-audio", true);
    const upload = await publishOn(f, f.receiver, 1, "screen");
    try {
      await f.publisher.command({ type: "enqueue", entry: ordinary(f, "movie"), playNow: true, deviceId: f.receiver.id });
      await until(() => !!f.receiver.load());
      assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, picture: true })).ok, true);
      await f.publisher.command({ type: "playLive", sourceId: "screen", playNow: false });
      await f.publisher.command({ type: "playLive", sourceId: "audio", playNow: false });
      const next = async (current: string) => {
        assert.equal((await f.publisher.command({ type: "next", playbackId: f.publisher.state.player.playbackId! })).ok, true);
        await until(() => playingNow(f.publisher) === current);
      };
      await next("Receiver · Screen");
      await until(() => receivers(f.publisher)?.join() === other.id);
      // Other shows only pictures; Receiver, held for its own source, returns with the sound this one uses.
      await next("Publisher · System audio");
      await until(() => receivers(f.publisher)?.sort().join() === [f.receiver.id, other.id].sort().join());
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal(chooserRequest(f.publisher.state), null);
      assert.notEqual(f.publisher.state.player.status, "unavailable");
      assert.equal(f.publisher.state.player.error, null);
    } finally { upload.terminate(); }
  } finally { await f.close(); }
});
