import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import type { PlaybackCommand } from "../src/shared/protocol";
import { helper, startHelpers } from "../src/server/helpers";
import { liveFixture as createLiveFixture, until } from "./live-input.fixture";

// The existing routing suite also locks the opt-in, shared chooser behaviour.
async function liveFixture({ askEveryDevice = true, ...options }: { local?: boolean; askEveryDevice?: boolean } = {}) {
  const fixture = await createLiveFixture(options);
  // Helper selection is process-global. Reinitialize it while this fixture's
  // executable exists, and finish checks before a later fixture changes PATH.
  startHelpers(join(dirname(fixture.databasePath), "helpers"));
  const helpers = await Promise.allSettled([helper("ffmpeg"), helper("qjs"), helper("yt-dlp")]);
  assert.deepEqual(helpers[0], { status: "fulfilled", value: fixture.executable }, "only this fixture's encoder is selected");
  if (askEveryDevice) {
    const host = await fixture.connect(-1);
    assert.equal((await host.command({ type: "askEveryDevice", enabled: true })).ok, true);
    await until(() => fixture.publisher.state.askEveryDevice === true);
    host.socket.close();
  }
  return fixture;
}

type Fixture = Awaited<ReturnType<typeof liveFixture>>;
type Client = Fixture["receiver"];
type Load = Extract<PlaybackCommand, { type: "load" }>;
const loads = (client: Client) => client.messages.flatMap(message => message.type === "player" && message.command.type === "load" ? [message.command] : []);
const direct = (load: Load | undefined) => !!load && "livePeerId" in load && load.follow === undefined;
const receivers = (client: Client) => client.state.outputs?.map(output => output.deviceId);
const sharedPlaybacks = (client: Client, sourceId = "screen") => client.state.playbacks?.filter(playback => playback.liveSourceId === sourceId) ?? [];
const consent = (client: Client, id: string) => client.state.devices?.find(device => device.id === id)?.sharing;
const lastCommand = (client: Client) => client.messages.flatMap(message => message.type === "player" && message.command.type !== "volume" ? [message.command.type] : []).at(-1);
const ordinary = (f: Fixture, id: string) => ({ id, title: id, source: `${f.hub.origin}/api/health` });
const titles = (client: Client) => client.state.queue.map(entry => entry.title);
const playingNow = (client: Client) => client.state.queue.find(entry => entry.id === client.state.currentEntryId)?.title;

test("closing the publishing socket without Stop sharing removes its sources, even across a same-device reconnect", { timeout: 15_000 }, async () => {
  const f = await liveFixture({ askEveryDevice: false });
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load());
    // A new tab may connect before the old socket closes. It does not own the old capture.
    const reloaded = await f.connect(0);
    f.publisher.socket.terminate();
    await until(() => [f.receiver, reloaded].every(client => !client.state.liveSources?.length && !sharedPlaybacks(client).length));
    const reconnected = await f.connect(0);
    assert.deepEqual(reconnected.state.liveSources, []);
    assert.equal((await reconnected.command({ type: "publishLive", sourceId: "new-screen", uploadToken: f.uploadToken, kind: "screen", audio: true, video: true })).ok, true);
    await until(() => f.receiver.state.liveSources?.length === 1);
    assert.deepEqual(f.receiver.state.liveSources?.map(source => source.id), ["new-screen"]);
    reloaded.socket.close();
    // Closing an unrelated tab of the same device must preserve the live publishing window.
    await f.receiver.command({ type: "sharing", sharing: { audio: false, video: false } });
    assert.deepEqual(f.receiver.state.liveSources?.map(source => source.id), ["new-screen"]);
    reconnected.socket.terminate();
    await until(() => !f.receiver.state.liveSources?.length);
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
    assert.equal(play.ok, true, play.error ?? "");
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
    assert.equal(joined.ok, true, joined.error ?? "");
    await until(() => direct(f.receiver.load()));
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");
    // The publisher keeps viewing and controlling the playback it asked for.
    assert.equal(f.receiver.state.playback, waiting);
    assert.equal(f.publisher.state.playback, waiting);
    assert.deepEqual(titles(f.publisher), ["Publisher · Screen"]);
    const pause = await f.publisher.command({ type: "pause", playbackId: f.publisher.state.player.playbackId!, paused: true });
    assert.equal(pause.ok, true, pause.error ?? "");
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
