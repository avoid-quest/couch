import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { AudioCodec } from "@sonn-audio/node-sendspin";
import { liveFixture, until } from "./live-input.fixture";
import type { Action } from "../src/shared/protocol";
import { SendspinCore, loadSendspinClientIdentity, type ServerStateMetadata } from "@sendspin/sendspin-js";

const publication = { type: "publishLive", sourceId: "concert", uploadToken: "1".repeat(64), kind: "microphone", audio: true, video: false, audioDelivery: "pcm", intent: "live" } as const;

test("host details reach Couch and the stock browser SDK through edits, reconnect and clearing", { timeout: 25_000 }, async () => {
  const f = await liveFixture({ media: { ffmpeg: process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", recording: new Uint8Array() } });
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const identity = f.identities[1]!;
  identity.id = loadSendspinClientIdentity(storage).clientId;
  const connecting = Date.now();
  const receiver = await f.connect(1), host = await f.connect(-1);
  const time = receiver.messages.find(message => message.type === "time");
  assert.ok(time && time.now >= connecting && time.now <= Date.now(), "Core sends its clock, which elapsed Live times count on");
  let metadata: ServerStateMetadata | undefined, chunks = 0, starts = 0, clears = 0;
  const player = new SendspinCore({ suite: "aesgcm", storage, baseUrl: `${f.hub.origin}/api/audio/${identity.token}`, codecs: ["pcm"], minBufferMs: 150,
    onStateChange: state => { metadata = state.serverState.metadata; } });
  player.onAudioData = () => chunks++;
  player.onStreamStart = () => starts++;
  player.onStreamClear = () => clears++;
  let capture: Awaited<ReturnType<typeof f.streamCapture>> | undefined;
  try {
    const before = Date.now();
    assert.equal((await host.command({ ...publication, metadata: { title: " Evening concert ", description: " Piano · first set " } })).ok, true);
    await until(() => !!receiver.state.liveSources?.length);
    const source = receiver.state.liveSources![0]!;
    assert.ok(source.startedAt! >= before && source.startedAt! <= Date.now());
    assert.deepEqual(source.metadata, { title: "Evening concert", description: "Piano · first set" });
    assert.equal((await receiver.command({ type: "playLive", sourceId: source.id, deviceId: identity.id })).ok, true);
    await player.connect();
    await until(() => metadata?.title === "Evening concert");
    assert.equal(metadata!.artist, "Piano · first set", "the public secondary metadata field carries the host's line");
    assert.equal(metadata!.progress?.track_duration, 0);
    assert.equal(metadata!.progress?.playback_speed, 1000);
    capture = await f.streamCapture(host, source.id, -1, (position, channel) => .2 * Math.sin(2 * Math.PI * 440 * position / 48000) * (channel ? -1 : 1));
    await until(() => chunks > 20);
    const playbackId = receiver.state.player.playbackId, streams = starts, resets = clears;
    const edit = { type: "updateLiveMetadata", sourceId: source.id, metadata: { description: "Second set" } } as const;
    assert.equal((await receiver.command(edit)).ok, false, "joining never grants metadata authority");
    assert.equal((await host.command(edit)).ok, true);
    await until(() => metadata?.artist === "Second set" && receiver.state.queue[0]?.subtitle === "Second set");
    assert.equal(metadata!.title, "Evening concert", "patching the line keeps the title");
    assert.equal(receiver.state.playbacks?.find(item => item.id === receiver.state.playback)?.title, "Evening concert");
    assert.equal(receiver.state.player.playbackId, playbackId);
    assert.equal(starts, streams); assert.equal(clears, resets);
    assert.equal(receiver.state.liveSources![0]!.startedAt, source.startedAt);
    const late = await f.connect(2);
    assert.deepEqual(late.state.liveSources![0]!.metadata, { title: "Evening concert", description: "Second set" });
    assert.equal(late.state.liveSources![0]!.startedAt, source.startedAt);
    player.disconnect("user_request"); metadata = undefined;
    await player.connect();
    await until(() => metadata?.artist === "Second set" && !!player.trackProgress);
    assert.ok(Math.abs(player.trackProgress!.positionMs - (Date.now() - source.startedAt!)) < 500, "SDK progress uses the publication clock, including time before Join");
    assert.equal((await host.command({ ...edit, metadata: { title: "", description: " " } })).ok, true);
    await until(() => metadata?.title === source.name && metadata?.artist == null && !receiver.state.queue[0]?.subtitle);
    assert.equal(receiver.state.queue[0]!.title, source.name);
    assert.equal((await receiver.command({ type: "leave", playbackId: receiver.state.player.playbackId! })).ok, true);
    await until(() => metadata?.title == null && metadata?.progress == null);
    await host.command({ ...edit, metadata: { title: "Encore" } });
    await receiver.command({ type: "playLive", sourceId: source.id, deviceId: identity.id });
    await until(() => metadata?.title === "Encore");
    assert.equal(receiver.state.liveSources![0]!.startedAt, source.startedAt);
    await host.command({ type: "endLive", sourceId: source.id });
    await until(() => !receiver.state.liveSources?.length && metadata?.title == null);
    assert.equal((await host.command(edit)).ok, false, "ended publications cannot be edited");
    await host.command(publication);
    await until(() => !!receiver.state.liveSources?.length);
    assert.ok(receiver.state.liveSources![0]!.startedAt! > source.startedAt!);
    assert.deepEqual(receiver.state.liveSources![0]!.metadata, {});
  } finally { capture?.stop(); player.disconnect("user_request"); await f.close(); }
});

test("Live output correction requires an active Sendspin output before changing device levels", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1);
    await host.command(publication);
    await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id });
    await until(() => f.receiver.state.controls?.leave === true);
    const volume = f.receiver.state.devices!.find(device => device.id === f.receiver.id)!.volume;
    for (const delay of [0, 10, 100]) {
      const denied = await f.receiver.command({ type: "output", deviceId: f.receiver.id, delay, level: volume === 20 ? 30 : 20 });
      assert.equal(denied.ok, false);
      assert.match(denied.error ?? "", /plays in sync/);
      assert.equal(f.receiver.state.devices!.find(device => device.id === f.receiver.id)!.volume, volume);
    }
  } finally { await f.close(); }
});

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

test("audience disconnect and newest-tab handover never pause healthy live receivers", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1), other = await f.connect(2);
    await host.command(publication);
    await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id });
    await other.command({ type: "playLive", sourceId: "concert", deviceId: other.id });
    await until(() => other.state.outputs?.length === 2);
    const playback = other.state.playback, status = other.state.player.status;
    const newer = await f.connect(1);
    await until(() => newer.messages.some(message => message.type === "sendspin" && message.listen));
    await until(() => { const instruction = f.receiver.messages.findLast(message => message.type === "sendspin"); return instruction?.type === "sendspin" && !instruction.listen; });
    const oldInstruction = f.receiver.messages.findLast(message => message.type === "sendspin");
    assert.ok(oldInstruction?.type === "sendspin" && !oldInstruction.listen, "only newest tab gets audio");
    f.receiver.socket.terminate();
    newer.socket.terminate();
    await until(() => other.state.devices?.find(device => device.id === newer.id)?.online === false);
    assert.equal(other.state.playback, playback);
    assert.equal(other.state.player.status, status);
    assert.equal(other.state.controls?.programme, false);
    other.socket.terminate();
    await until(() => host.state.devices?.filter(device => [newer.id, other.id].includes(device.id)).every(device => !device.online) === true);
    const summary = host.state.playbacks?.find(item => item.id === playback);
    assert.equal(summary?.status, status, "zero online listeners does not pause the source clock");
    assert.equal(summary?.delivery, "scheduled");
    const rejoined = await f.connect(2);
    await until(() => rejoined.messages.some(message => message.type === "sendspin" && message.listen));
    assert.equal(rejoined.state.playback, playback);
    assert.equal(rejoined.state.controls?.programme, false);
  } finally { await f.close(); }
});

test("capture failure outranks a receiver's own output error and reaches affected outputs while an independent programme continues", { timeout: 15_000 }, async () => {
  // Sendspin delivery needs the real encoder.
  const f = await liveFixture({ media: { ffmpeg: process.env.COUCH_TEST_FFMPEG ?? "ffmpeg", recording: new Uint8Array() } });
  let upload: WebSocket | undefined;
  try {
    const host = await f.connect(-1), other = await f.connect(2);
    await other.command({ type: "enqueue", entry: { id: "independent", title: "Independent", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: other.id });
    await until(() => !!other.load());
    other.report();
    await until(() => other.state.player.status === "playing");
    const independent = other.state.playback;
    await host.command(publication);
    await f.receiver.command({ type: "playLive", sourceId: "concert", deviceId: f.receiver.id });
    await until(() => f.receiver.state.controls?.leave === true);
    // The receiver's speaker takes no Live wire, which its output shows while the capture is healthy.
    await f.speaker(1, AudioCodec.FLAC);
    upload = (await f.streamCapture(host, "concert", -1)).upload;
    await until(() => /neither 48 kHz/.test(f.receiver.state.outputs?.[0]?.error ?? ""));
    // Renegotiating the clock fails the source.
    upload.send(JSON.stringify({ type: "start", generation: "bad-clock", offsetUs: 0, rttUs: 200_000 }));
    await until(() => /capture clock/i.test(f.receiver.state.outputs?.[0]?.error ?? ""));
    assert.match(f.receiver.state.player.error ?? "", /capture clock/i);
    assert.equal(other.state.playback, independent);
    assert.equal(other.state.player.status, "playing");
    assert.equal(other.state.currentEntryId, "independent");
    assert.deepEqual(other.state.queue.map(entry => entry.id), ["independent"]);
  } finally { upload?.terminate(); await f.close(); }
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

test("the host removes one Live listener, which is told why, while the others keep listening", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    const host = await f.connect(-1), other = await f.connect(2);
    assert.equal((await host.command(publication)).ok, true);
    for (const listener of [f.receiver, other]) assert.equal((await listener.command({ type: "playLive", sourceId: "concert", deviceId: listener.id })).ok, true);
    await until(() => host.state.playbacks?.some(playback => playback.liveSourceId === "concert" && playback.outputs.length === 2) === true);
    const playbackId = host.state.playbacks!.find(playback => playback.liveSourceId === "concert")!.id;
    assert.equal((await other.command({ type: "removeLiveListener", playbackId, deviceId: f.receiver.id })).ok, false, "a listener cannot remove another");
    assert.equal((await host.command({ type: "removeLiveListener", playbackId, deviceId: f.receiver.id })).ok, true);
    await until(() => f.receiver.state.controls?.leave === false);
    const notices = (client: typeof host) => client.messages.flatMap(message => message.type === "state" && message.state.activity?.kind === "listener-removed" ? [message.state.activity] : []);
    assert.ok(notices(f.receiver).some(activity => activity.target === f.receiver.id && /removed this device/.test(activity.text)));
    assert.ok(notices(other).every(activity => activity.target !== other.id), "the notice names only the removed listener");
    assert.deepEqual(host.state.playbacks!.find(playback => playback.id === playbackId)!.outputs.map(output => output.deviceId), [other.id]);
    assert.equal((await host.command({ type: "removeLiveListener", playbackId, deviceId: f.receiver.id })).ok, false, "a removed device is no longer listening");
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
