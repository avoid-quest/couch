import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";
import type { PlaybackCommand } from "../src/shared/protocol";
import { outputStatus, WhereItPlays } from "../src/client/sections/shell/Outputs";
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

test("Play on the publisher waits in Where it plays, and both receiver entry points join one playback", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    const self = await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.publisher.id });
    assert.equal(self.ok, true, self.error);
    await until(() => f.publisher.state.player.error === "Publisher is sharing this source. Choose where it plays.");
    assert.equal(f.publisher.state.player.status, "paused");
    assert.deepEqual(f.publisher.state.outputs, []);
    assert.equal(loads(f.publisher).length, 0, "the publisher never loads its own capture");
    const waiting = f.publisher.state.playback;
    // Now Playing: a device viewing the waiting playback adds This device in Where it plays, which starts it.
    const other = await f.connect(2);
    await until(() => other.state.playback === waiting);
    const sheet = WhereItPlays({ state: other.state, run: async () => true });
    assert.ok(isValidElement<{ defaultOpen?: boolean }>(sheet) && sheet.props.defaultOpen, "a waiting source opens Where it plays");
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 40, picture: true })).ok, true);
    await until(() => direct(other.load()));
    assert.equal(other.load()!.paused, false);
    other.report();
    await until(() => other.state.player.status === "playing" && !other.state.player.error);
    // Find: Play on This device joins the same playback and its clock.
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.follow);
    assert.equal(f.receiver.state.playback, waiting);
    assert.equal(sharedPlaybacks(other).length, 1);
    assert.deepEqual(receivers(other)?.sort(), [f.receiver.id, other.id].sort());
    assert.equal(loads(f.publisher).length, 0);
    // Both outputs are private, so the publisher no longer sees that playback.
    assert.equal(f.publisher.state.playback, null);
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
  } finally { await f.close(); }
});

test("joining is refused rather than guessed when the source plays in several independent playbacks", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
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

test("receiving privately needs no remote-control consent and keeps consent, volume and private outputs", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => direct(f.receiver.load()));
    assert.equal((await f.receiver.command({ type: "volume", deviceId: f.receiver.id, volume: 35 })).ok, true);
    const other = await f.connect(2);
    assert.equal((await other.command({ type: "playLive", sourceId: "screen", deviceId: other.id })).ok, true);
    await until(() => other.state.playback === f.receiver.state.playback && !!other.load());
    for (const client of [f.receiver, other]) assert.deepEqual(consent(other, client.id), { audio: false, video: false }, "joining grants nothing");
    assert.equal((await other.command({ type: "output", deviceId: f.receiver.id, picture: false })).ok, false, "a private output stays its device's");
    assert.equal((await other.command({ type: "output", deviceId: f.receiver.id, level: 0 })).ok, false);
    assert.equal((await other.command({ type: "volume", deviceId: f.receiver.id, volume: 90 })).ok, false);
    assert.equal(sound(other, f.receiver.id).volume, 35);
    assert.equal((await other.command({ type: "output", deviceId: other.id, level: 20 })).ok, true, "a receiver adjusts its own output");
    assert.deepEqual(f.receiver.state.outputs?.find(output => output.deviceId === f.receiver.id)?.local, true);
    assert.equal(f.publisher.state.playbacks?.find(playback => playback.liveSourceId === "screen")?.outputs.length, 2);
    // The publisher has no consent to use either receiver.
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, false);
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
