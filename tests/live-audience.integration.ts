import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { liveFixture, until } from "./live-input.fixture";
import type { Action } from "../src/shared/protocol";

const publication = { type: "publishLive", sourceId: "concert", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" } as const;

test("live audience can join privately, set its own zero level and leave; all programme entrypoints reject", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1), other = await f.connect(2);
    const token = new URL(f.receiver.socket.url).searchParams.get("token")!;
    const post = (path: string, body: unknown) => fetch(`${f.hub.origin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await f.receiver.command({ type: "enqueue", entry: { id: "saved", title: "Saved programme", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id });
    await until(() => f.receiver.state.currentEntryId === "saved");
    const saved = await post("/api/playlists", { name: "Ordinary playlist" });
    assert.equal(saved.status, 201);
    const { playlist } = await saved.json();
    assert.equal((await f.publisher.command(publication)).ok, false, "paired clients cannot promote themselves to host capture");
    assert.equal((await host.command(publication)).ok, true);
    assert.equal((await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id, picture: false, sound: true })).ok, true);
    await until(() => f.receiver.state.controls?.leave === true);
    await until(() => f.receiver.messages.some(message => message.type === "sendspin" && message.listen));
    assert.equal(f.receiver.state.playbacks?.find(item => item.id === f.receiver.state.playback)?.delivery, "scheduled", "one receiver stays scheduled");
    const playback = f.receiver.state.playback, playbackId = f.receiver.state.player.playbackId!, entryId = f.receiver.state.currentEntryId!;
    const queue = f.receiver.state.queue.map(entry => entry.id);
    const actions: Action[] = [
      { type: "pause", playbackId, paused: true }, { type: "pause", playbackId, paused: false },
      { type: "stop", playbackId }, { type: "stop" }, { type: "next", playbackId },
      { type: "seek", playbackId, position: 5 }, { type: "speed", playbackId, speed: 2 },
      { type: "audioDelay", playbackId, delay: 0.1 }, { type: "subtitleDelay", playbackId, delay: 0.1 },
      { type: "inSync", inSync: false }, { type: "allSpeakers", level: 0 },
      { type: "volume", volume: 0 }, { type: "mute", muted: true },
      { type: "remove", entryId }, { type: "play", entryId }, { type: "move", entryId, beforeEntryId: null },
      { type: "enqueue", entry: { id: "attack", title: "Replace concert", source: `${f.hub.origin}/api/health` }, playNow: true },
    ];
    for (const action of actions) assert.equal((await f.receiver.command(action)).ok, false, `audience ${action.type} must reject`);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
    assert.equal(f.receiver.state.playback, playback);
    assert.equal(f.receiver.state.currentEntryId, entryId);
    for (const mode of ["append", "replace", "play"]) {
      const api = await post(`/api/playlists/${playlist.id}/load`, { revision: playlist.revision, mode });
      assert.equal(api.status, 403, `REST ${mode} cannot mutate the concert queue`);
      assert.match((await api.json()).error, /Live audio listeners/);
    }
    assert.equal((await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id, picture: false, sound: true })).ok, true, "private audience membership does not require programme rights");
    await until(() => f.receiver.state.outputs?.length === 2);
    assert.equal(other.state.playback, playback);
    assert.equal((await f.receiver.command({ type: "volume", deviceId: f.receiver.id, volume: 0 })).ok, true);
    await until(() => f.receiver.state.devices?.find(device => device.id === f.receiver.id)?.volume === 0);
    assert.equal(f.receiver.state.outputs?.length, 2, "local zero volume keeps audience membership");
    assert.equal((await f.receiver.command({ type: "leave", playbackId })).ok, true);
    await until(() => other.state.outputs?.length === 1);
    assert.equal(other.state.playback, playback);
    assert.equal(other.state.playbacks?.find(item => item.id === playback)?.delivery, "scheduled");
    assert.ok(host.state.liveSources?.some(source => source.id === "concert"));
    assert.equal((await other.command({ type: "endLive", sourceId: "concert" })).ok, false);
    assert.equal((await host.command({ type: "endLive", sourceId: "concert" })).ok, true);
    await until(() => !other.state.liveSources?.length);
  } finally { await f.close(); }
});

test("timestamped uploads require the current publication upload identity", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  const uploads: WebSocket[] = [];
  const upgrade = (url: string) => new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: f.hub.origin } });
    uploads.push(socket);
    socket.once("error", reject);
    socket.once("open", () => resolve(101));
    socket.once("unexpected-response", (request, response) => { resolve(response.statusCode!); response.resume(); request.destroy(); });
  });
  try {
    const host = await f.connect(-1);
    assert.equal((await host.command(publication)).ok, true);
    await until(() => host.messages.some(message => message.type === "livePeers" && message.upload));
    const demand = host.messages.findLast(message => message.type === "livePeers" && message.upload);
    assert.ok(demand?.type === "livePeers" && demand.uploadId);
    const url = f.uploadUrl("concert", publication.uploadToken, -1);
    assert.equal(await upgrade(url), 403, "PCM upload cannot omit its generation");
    assert.equal(await upgrade(`${url}&uploadId=stale`), 403);
    assert.equal(await upgrade(`${url}&uploadId=${demand.uploadId}`), 101);
    assert.equal((await host.command({ type: "endLive", sourceId: "concert" })).ok, true);
    assert.equal(await upgrade(`${url}&uploadId=${demand.uploadId}`), 403, "ending capture invalidates its upload credentials");
  } finally { for (const socket of uploads) socket.terminate(); await f.close(); }
});

test("an audio-only legacy join never requests permission for a disabled private screen", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("input", "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: false } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "input", deviceId: f.receiver.id, picture: false, sound: true })).ok, true);
    await until(() => !!f.receiver.load());
    assert.equal(f.receiver.load()?.liveOutput?.picture, false);
    assert.equal(f.receiver.load()?.liveOutput?.sound, true);
    const other = await f.connect(2, "&audio=1");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "input", deviceId: other.id, picture: false, sound: true })).ok, true);
    await until(() => !!other.load());
    assert.equal(other.load()?.liveOutput?.picture, false);
  } finally { await f.close(); }
});

test("a Live listener cannot change another device's level, even one that shares its speaker", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1), other = await f.connect(2);
    assert.equal((await host.command(publication)).ok, true);
    await other.command({ type: "sharing", sharing: { audio: true, video: false } });
    for (const listener of [f.receiver, other]) assert.equal((await listener.command({ type: "playLive", sourceId: "concert", deviceId: listener.id, picture: false, sound: true })).ok, true);
    await until(() => f.receiver.state.outputs?.length === 2);
    const level = () => f.receiver.state.devices!.find(device => device.id === other.id)!;
    const before = level();
    for (const action of [{ type: "volume", deviceId: other.id, volume: before.volume === 20 ? 30 : 20 }, { type: "mute", deviceId: other.id, muted: !before.muted }] as Action[]) {
      const denied = await f.receiver.command(action);
      assert.equal(denied.ok, false, `listener ${action.type} on another device must reject`);
      assert.match(denied.error ?? "", /Live audio listeners/);
    }
    assert.deepEqual({ volume: level().volume, muted: level().muted }, { volume: before.volume, muted: before.muted });
    assert.equal((await f.receiver.command({ type: "volume", deviceId: f.receiver.id, volume: 40 })).ok, true, "a listener still sets its own level");
    for (const action of [{ type: "output", deviceId: other.id, level: 0 }, { type: "output", deviceId: other.id, level: 20 }, { type: "output", deviceId: other.id, delay: 500 }] as Action[]) {
      const denied = await f.receiver.command(action);
      assert.equal(denied.ok, false, `listener fader ${JSON.stringify(action)} on another device must reject`);
      assert.match(denied.error ?? "", /Live audio listeners/);
    }
    assert.equal(f.receiver.state.outputs?.length, 2, "the other listener stays in the audience");
  } finally { await f.close(); }
});
