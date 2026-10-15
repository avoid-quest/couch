import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFixture, until } from "./live-input.fixture";

// These requests cross the real HTTP authorization boundary. Real encoded track
// contents and timestamps are checked separately in live-stream.integration.ts.
async function granted(link: string, rendition: string) {
  assert.ok(link.includes(`/${rendition}/`), link);
  assert.equal((await fetch(link)).status, 200);
  assert.equal((await fetch(new URL("segment-000000000.ts", link))).status, 200);
  for (const other of ["av", "audio", "video"].filter(value => value !== rendition)) {
    const forged = link.replace(`/${rendition}/`, `/${other}/`);
    assert.equal((await fetch(forged)).status, 404, "a rendition cannot reuse another rendition's signature");
    assert.equal((await fetch(new URL("segment-000000000.ts", forged))).status, 404);
    assert.equal((await fetch(new URL(`../${other}/stream.m3u8`, link))).status, 404);
    assert.equal((await fetch(new URL(`%2e%2e%2f${other}%2fstream.m3u8`, link))).status, 404);
  }
}
async function revoked(link: string) {
  assert.equal((await fetch(link)).status, 404);
  assert.equal((await fetch(new URL("segment-000000000.ts", link))).status, 404);
}

test("fallback grants only selected channels and revokes saved links while other receivers keep the shared source", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.livePeerId);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.hls);
    const av = f.receiver.load()!.source;
    await granted(av, "av");
    f.receiver.report();
    await until(() => f.publisher.state.player.status === "playing");

    const other = await f.connect(2, "&audio=1&video=1");
    assert.equal((await f.publisher.command({ type: "output", deviceId: other.id, picture: true, level: 50 })).ok, true);
    await until(() => !!other.load()?.livePeerId);
    other.socket.send(JSON.stringify({ type: "liveFailed", peerId: other.load()!.livePeerId, error: "Unreachable." }));
    await until(() => !!other.load()?.hls);
    const shared = other.load()!.source;
    await granted(shared, "av");

    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: false })).ok, true);
    await until(() => f.receiver.load()!.source.includes("/audio/"));
    const audio = f.receiver.load()!.source;
    await granted(audio, "audio");
    await revoked(av);
    await granted(shared, "av");
    assert.equal((await fetch(audio.replace(`/${f.receiver.id}/`, `/${other.id}/`))).status, 404);
    assert.equal((await fetch(audio.replace(`/${f.receiver.id}/`, "/core/"))).status, 404);

    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: true, level: 0 })).ok, true);
    await until(() => f.receiver.load()!.source.includes("/video/"));
    const video = f.receiver.load()!.source;
    await granted(video, "video");
    await revoked(audio);
    await revoked(av);
    await granted(shared, "av");

    assert.equal((await f.publisher.command({ type: "inSync", inSync: true })).ok, true);
    await until(() => !!f.receiver.load()?.follow && !!other.load()?.follow);
    await granted(f.receiver.load()!.source, "video");
    await granted(other.load()!.source, "video");
    await revoked(shared);
    await revoked(audio);
    assert.equal((await f.publisher.command({ type: "output", deviceId: f.receiver.id, picture: false, level: 50 })).ok, true);
    await revoked(video);
    assert.equal(f.uploads.size, 1, "channel/mode changes reuse the source's single upload");
  } finally { await f.close(); }
});

for (const kind of ["microphone", "screen"] as const) test(`${kind} with one captured channel falls back to that channel`, { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publish("input", kind, kind === "microphone");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "input", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load()?.livePeerId);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
    await until(() => !!f.receiver.load()?.hls);
    await granted(f.receiver.load()!.source, kind === "microphone" ? "audio" : "video");
  } finally { await f.close(); }
});
