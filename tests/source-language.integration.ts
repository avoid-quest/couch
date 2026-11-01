import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { liveFixture, until } from "./live-input.fixture";
import type { PlaybackCommand } from "../src/shared/protocol";

type Load = Extract<PlaybackCommand, { type: "load" }>;
const languages = ["en", "it"];

async function fixture(t: TestContext, selectedLive = false) {
  const requests: string[] = [];
  const media = createServer((request, response) => {
    const path = request.url!;
    requests.push(path);
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (path.endsWith(".aac")) { response.setHeader("Content-Type", "audio/aac"); response.end(`fixture audio ${path.split("/")[1]}`); return; }
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    if (path === "/master.m3u8") response.end(['#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="/en/index.m3u8"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Italian",LANGUAGE="it",DEFAULT=NO,AUTOSELECT=YES,URI="/it/index.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="a",CODECS="avc1.640028,mp4a.40.2"', '/picture/index.m3u8', ''].join('\n'));
    else response.end(`#EXTM3U\n#EXT-X-TARGETDURATION:60\n#EXTINF:60,\nsegment.aac\n${selectedLive && path.startsWith("/it/") ? "" : "#EXT-X-ENDLIST\n"}`);
  });
  await new Promise<void>(resolve => media.listen(0, "127.0.0.1", resolve));
  t.after(async () => { media.closeAllConnections(); await new Promise<void>(resolve => media.close(() => resolve())); });
  const f = await liveFixture();
  t.after(() => f.close());
  const source = `http://127.0.0.1:${(media.address() as { port: number }).port}/master.m3u8`;
  assert.equal((await f.receiver.command({ type: "preferences", profileId: f.receiver.state.activeProfile.id, preferences: { audioLanguage: "it" } })).ok, true);
  const play = async () => {
    const previous = f.receiver.load();
    const reply = await f.receiver.command({ type: "enqueue", entry: { id: "programme", title: "Two languages", source }, playNow: true });
    assert.equal(reply.ok, true, reply.error ?? "");
    await until(() => !!f.receiver.load() && f.receiver.load() !== previous);
    return f.receiver.load()!;
  };
  return { ...f, source, requests, play };
}

// Read the receiver's HTTP menu and follow the requested language capability.
// This checks Core's contract; it does not run the browser's track selection.
// The master URL may be direct or synthetic; its literal filename is immaterial.
async function choices(load: Load) {
  for (const internal of ["audioManifest", "audioStream", "audioSelection", "headers", "credentialOrigin", "publicNetwork"]) assert.equal(internal in load, false);
  const response = await fetch(load.source);
  assert.equal(response.status, 200);
  const text = await response.text();
  return text.split("\n").filter(line => line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")).map((line, index) => ({
    index, label: /NAME="([^"]+)"/.exec(line)![1]!, language: /LANGUAGE="([^"]+)"/.exec(line)![1]!, uri: new URL(/URI="([^"]+)"/.exec(line)![1]!, load.source).href,
  }));
}

async function requestedAudio(load: Load) {
  const offered = await choices(load);
  assert.deepEqual(offered.map(track => track.language), languages, "the audio language menu must survive channel selection");
  const selected = load.audioTrack === undefined ? offered.find(track => track.language === load.preferences?.audioLanguage) : offered.find(track => track.index === load.audioTrack);
  assert.equal(selected?.language, "it", "the load must offer the requested Italian audio");
  const response = await fetch(selected!.uri);
  assert.equal(response.status, 200);
  const segment = (await response.text()).split("\n").find(line => line && !line.startsWith("#"))!;
  const audio = await fetch(new URL(segment, selected!.uri));
  assert.equal(audio.status, 200);
  assert.equal(await audio.text(), "fixture audio it");
  return offered;
}

test("initial sound-only HLS offers every language and carries the non-default profile preference without video", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load());
  f.receiver.report();
  await until(() => f.receiver.state.player.status === "playing");
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: false })).ok, true);
  const load = await f.play();
  assert.deepEqual(load.output, { picture: false, sound: true });
  await requestedAudio(load);
  assert.equal(f.requests.some(path => path.startsWith("/picture/")), false);
  assert.equal(f.requests.filter(path => path === "/master.m3u8").length, 1, "synthetic delivery reuses this load's master read");
});

test("selected Italian and its menu survive picture off and restoration with the same queue and position", { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const original = await f.play();
  const offered = await requestedAudio(original);
  f.receiver.report({ position: 13, duration: 60, seekable: true, tracks: offered.map(track => ({ id: `audio-${track.index}`, index: track.index, kind: "audio", label: track.label, language: track.language, selected: track.language === "it" })) });
  await until(() => f.receiver.state.player.position === 13);
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "next", title: "Next", source: f.source } })).ok, true);
  await until(() => f.receiver.state.queue.length === 2);
  const queue = f.receiver.state.queue.map(entry => entry.id), currentEntryId = f.receiver.state.currentEntryId;
  f.requests.length = 0;
  for (const picture of [false, true]) {
    const previous = f.receiver.load();
    const reply = await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture });
    assert.equal(reply.ok, true, reply.error ?? "");
    await until(() => f.receiver.load() !== previous);
    const load = f.receiver.load()!;
    assert.deepEqual(load.output, { picture, sound: true });
    assert.equal(load.playbackId, original.playbackId);
    assert.equal(load.startPosition, 13);
    assert.equal(load.audioTrack, 1);
    await requestedAudio(load);
    assert.deepEqual(f.receiver.state.queue.map(entry => entry.id), queue);
    assert.equal(f.receiver.state.currentEntryId, currentEntryId);
    if (!picture) assert.equal(f.requests.some(path => path.startsWith("/picture/")), false);
  }
});

test("Core classifies sound-only HLS from the preferred live rendition instead of the finite default", { timeout: 15_000 }, async t => {
  const f = await fixture(t, true);
  assert.equal((await f.receiver.command({ type: "enqueue", entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` }, playNow: true, deviceId: f.receiver.id })).ok, true);
  await until(() => !!f.receiver.load());
  f.receiver.report();
  await until(() => f.receiver.state.player.status === "playing");
  assert.equal((await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: false })).ok, true);
  const load = await f.play();
  assert.deepEqual(load.output, { picture: false, sound: true });
  await until(() => f.receiver.state.queue.find(entry => entry.id === "programme")?.live === true);
  assert.ok(f.requests.includes("/it/index.m3u8"));
  assert.equal(f.requests.some(path => path.startsWith("/en/") || path.startsWith("/picture/")), false);
});
