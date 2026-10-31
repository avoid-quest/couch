import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFixture, until } from "./live-input.fixture";
import { openStore } from "../src/server/store";
import { defaultCompressor } from "../src/shared/compressor";
import { playbackMediaId } from "../src/server/progress";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Direct compression prepares readable bytes without grouping, preserves position and device volume, and persists per Playback", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    const client = f.publisher;
    assert.equal((await client.command({ type: "enqueue", playNow: true, deviceId: client.id, entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => !!client.load());
    const playbackId = client.load()!.playbackId, group = client.state.playback!;
    client.report({ status: "paused", playbackId, position: 12.5, duration: 100, seekable: true });
    await until(() => client.state.player.status === "paused");
    await client.command({ type: "volume", volume: 37 });
    const volume = client.state.player.volume;
    assert.deepEqual(client.state.compressor, defaultCompressor);
    assert.equal((await client.command({ type: "compressor", playbackId, settings: { enabled: true, threshold: -24 } })).ok, true);
    await until(() => client.load()?.compressor?.enabled === true);
    assert.equal(client.state.playback, group);
    assert.equal(client.load()!.startPosition, 12.5);
    assert.equal(client.load()!.paused, true);
    assert.equal(client.load()!.follow, undefined);
    assert.equal(client.state.player.volume, volume);
    assert.equal(client.messages.some(message => message.type === "sendspin" && message.listen), false);
    const count = () => client.messages.filter(message => message.type === "player" && message.command.type === "load").length;
    const before = count();
    for (const settings of [{ gain: -2, ratio: 4 }, { enabled: false }, { enabled: true }]) assert.equal((await client.command({ type: "compressor", playbackId, settings })).ok, true);
    assert.equal(count(), before, "an already prepared Direct graph changes without a source reload");
    assert.deepEqual(client.state.compressor, { ...defaultCompressor, enabled: true, threshold: -24, ratio: 4, gain: -2 });
    const saved = openStore(f.databasePath, true);
    try { assert.deepEqual(saved.playback(group).compressor(), client.state.compressor); } finally { saved.close(); }
    assert.equal((await f.receiver.command({ type: "compressor", playbackId, settings: { gain: 9 } })).ok, false, "another private playback cannot be changed");
    assert.equal((await client.command({ type: "compressor", playbackId: "old-item", settings: { enabled: false } })).ok, false);
    await client.command({ type: "enqueue", entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` } });
    await f.restart();
    const restored = await f.connect(0);
    const resumed = await restored.command({ type: "play", entryId: "film" });
    assert.equal(resumed.ok, true, resumed.error ?? "");
    assert.equal(restored.state.compressor?.threshold, -24);
    assert.equal(restored.state.compressor?.enabled, true);
  } finally { await f.close(); }
});

test("live sharing refuses compressor commands and never receives a processing setting", { timeout: 15_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publish("screen");
    assert.equal((await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id })).ok, true);
    await until(() => !!f.receiver.load());
    const playbackId = f.receiver.load()!.playbackId;
    assert.equal(f.receiver.load()!.compressor, undefined);
    assert.equal((await f.publisher.command({ type: "compressor", playbackId, settings: { enabled: true } })).ok, false);
    assert.equal(f.receiver.state.compressor?.enabled, false);
  } finally { await f.close(); }
});

test("compression enabled In sync prepares the existing screen before returning to Direct", { timeout: 20_000 }, async () => {
  const f = await liveFixture();
  try {
    await f.publisher.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.speaker(0); await f.speaker(1);
    const a = f.publisher;
    assert.equal((await a.command({ type: "enqueue", playNow: true, deviceId: a.id, entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` } })).ok, true);
    await until(() => !!a.load());
    const playbackId = a.load()!.playbackId;
    a.report({ playbackId, position: 4, duration: 100, seekable: true });
    await until(() => a.state.player.status === "playing");
    assert.equal((await a.command({ type: "output", deviceId: f.receiver.id, level: 50 })).ok, true);
    await until(() => f.heard(0) > 0 && f.heard(1) > 0);
    assert.equal((await a.command({ type: "compressor", playbackId, settings: { enabled: true, threshold: -22 } })).ok, true);
    assert.equal((await a.command({ type: "output", deviceId: f.receiver.id, level: 0, picture: false })).ok, true);
    await until(() => a.load()?.compressor?.enabled === true && !a.load()?.follow);
    assert.equal(a.load()!.compressor!.threshold, -22);
    assert.equal(a.state.outputs?.length, 1);
    a.report({ playbackId, status: "error", error: "Couldn't start the compressor", position: 4 });
    await until(() => a.state.player.status === "error");
    assert.equal((await a.command({ type: "compressor", playbackId, settings: { enabled: false } })).ok, true);
    await until(() => a.load()?.compressor?.enabled === false);
    assert.equal(a.load()!.startPosition, 4, "Disabling after an error retries from the current position");
  } finally { await f.close(); }
});

for (const observed of [false, true]) test(`disabling compression after an error ${observed ? "after" : "before"} the first progress report restores tracking`, { timeout: 15_000 }, async () => {
  const f = await liveFixture(), saved = openStore(f.databasePath, true);
  try {
    const client = f.publisher, entry = { id: "film", title: "Film", source: `${f.hub.origin}/api/health` };
    assert.equal((await client.command({ type: "enqueue", playNow: true, deviceId: client.id, entry })).ok, true);
    await until(() => !!client.load());
    const playbackId = client.load()!.playbackId, mediaId = playbackMediaId(entry)!;
    assert.equal((await client.command({ type: "compressor", playbackId, settings: { enabled: true } })).ok, true);
    await until(() => client.load()?.compressor?.enabled === true);
    const owner = client.state.activeProfile.id, actor = client.state.playedBy;
    assert.equal(actor?.deviceId, client.id);
    if (observed) {
      client.report({ playbackId, position: 12, duration: 100, seekable: true });
      await until(() => saved.sharedProgress(mediaId)?.position === 12);
    } else assert.equal(saved.sharedProgress(mediaId), null);
    client.report({ playbackId, status: "error", error: "Couldn't start the compressor", position: observed ? 12 : 0 });
    await until(() => client.state.player.status === "error");
    const created = await f.api("/api/profiles", { name: "Another viewer" });
    assert.equal(created.status, 201);
    const { profile } = await created.json() as { profile: { id: string } };
    assert.equal((await f.api(`/api/profiles/${profile.id}/select`, {})).status, 200);
    await until(() => client.state.activeProfile.id === profile.id);
    assert.equal((await client.command({ type: "compressor", playbackId, settings: { enabled: false } })).ok, true);
    await until(() => client.load()?.compressor?.enabled === false);
    client.report({ playbackId, position: 40, duration: 100, seekable: true, error: null });
    await until(() => client.state.player.status === "playing");
    assert.equal(saved.sharedProgress(mediaId)?.position, 40, "Recovered playback stopped saving progress");
    assert.equal(saved.progressOwner(mediaId), owner);
    assert.deepEqual(saved.sharedProgress(mediaId)!.playedBy, actor);
    assert.deepEqual(client.state.playedBy, actor);
    client.report({ playbackId, status: "ended", position: 100, duration: 100, seekable: true, error: null });
    await until(() => saved.sharedProgress(mediaId)?.watched === true);
    assert.equal(saved.sharedProgress(mediaId)?.watched, true);
    assert.equal(saved.sharedProgress(mediaId)?.position, 0);
  } finally { saved.close(); await f.close(); }
});

test("older queues migrate with compression off, and corrupt saved settings cannot enter the DSP", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-compressor-store-")), path = join(directory, "couch.sqlite");
  try {
    const old = openStore(path);
    old.playback("old").saveMixTrim(73); old.close();
    const legacy = new DatabaseSync(path); legacy.exec("ALTER TABLE playback DROP COLUMN compressor"); legacy.close();
    const migrated = openStore(path);
    assert.deepEqual(migrated.playback("old").compressor(), defaultCompressor);
    assert.equal(migrated.playback("old").mixTrim(), 73);
    const editor = new DatabaseSync(path);
    for (const bad of ["not JSON", '{"enabled":true,"ratio":999}', '{"enabled":true,"unknown":1}']) {
      editor.prepare("UPDATE playback SET compressor = ? WHERE id = 'old'").run(bad);
      assert.deepEqual(migrated.playback("old").compressor(), defaultCompressor);
    }
    migrated.playback("old").saveCompressor({ ...defaultCompressor, enabled: true });
    assert.deepEqual(migrated.playback("unrelated").compressor(), defaultCompressor);
    editor.close(); migrated.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
