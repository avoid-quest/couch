import { test } from "node:test";
import assert from "node:assert/strict";
import { liveFixture, until } from "./live-input.fixture";
import { openStore } from "../src/server/store";
import { defaultCompressor } from "../src/shared/compressor";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "Direct compression prepares readable bytes without grouping, preserves position and device volume, and persists per Playback",
  { timeout: 20_000 },
  async () => {
    const f = await liveFixture();
    try {
      const client = f.publisher;
      assert.equal(
        (
          await client.command({
            type: "enqueue",
            playNow: true,
            deviceId: client.id,
            entry: { id: "film", title: "Film", source: `${f.hub.origin}/api/health` },
          })
        ).ok,
        true,
      );
      await until(() => !!client.load());
      const playbackId = client.load()!.playbackId,
        group = client.state.playback!;
      client.report({
        status: "paused",
        playbackId,
        position: 12.5,
        duration: 100,
        seekable: true,
      });
      await until(() => client.state.player.status === "paused");
      await client.command({ type: "volume", volume: 37 });
      const volume = client.state.player.volume;
      assert.deepEqual(client.state.compressor, defaultCompressor);
      assert.equal(
        (
          await client.command({
            type: "compressor",
            playbackId,
            settings: { enabled: true, threshold: -24 },
          })
        ).ok,
        true,
      );
      await until(() => client.load()?.compressor?.enabled === true);
      assert.equal(client.state.playback, group);
      assert.equal(client.load()!.startPosition, 12.5);
      assert.equal(client.load()!.paused, true);
      assert.equal(client.state.player.volume, volume);
      const count = () =>
        client.messages.filter(
          (message) => message.type === "player" && message.command.type === "load",
        ).length;
      const before = count();
      for (const settings of [{ gain: -2, ratio: 4 }, { enabled: false }, { enabled: true }])
        assert.equal((await client.command({ type: "compressor", playbackId, settings })).ok, true);
      assert.equal(
        count(),
        before,
        "an already prepared Direct graph changes without a source reload",
      );
      assert.deepEqual(client.state.compressor, {
        ...defaultCompressor,
        enabled: true,
        threshold: -24,
        ratio: 4,
        gain: -2,
      });
      const saved = openStore(f.databasePath, true);
      try {
        assert.deepEqual(saved.playback(group).compressor(), client.state.compressor);
      } finally {
        saved.close();
      }
      assert.equal(
        (await f.receiver.command({ type: "compressor", playbackId, settings: { gain: 9 } })).ok,
        false,
        "another private playback cannot be changed",
      );
      assert.equal(
        (
          await client.command({
            type: "compressor",
            playbackId: "old-item",
            settings: { enabled: false },
          })
        ).ok,
        false,
      );
      await client.command({
        type: "enqueue",
        entry: { id: "next", title: "Next", source: `${f.hub.origin}/api/health` },
      });
      await f.restart();
      const restored = await f.connect(0);
      const resumed = await restored.command({ type: "play", entryId: "film" });
      assert.equal(resumed.ok, true, resumed.error ?? "");
      assert.equal(restored.state.compressor?.threshold, -24);
      assert.equal(restored.state.compressor?.enabled, true);
    } finally {
      await f.close();
    }
  },
);

test("older queues migrate with compression off, and corrupt saved settings cannot enter the DSP", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-compressor-store-")),
    path = join(directory, "couch.sqlite");
  try {
    const old = openStore(path);
    old.playback("old").saveMixTrim(73);
    old.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("ALTER TABLE playback DROP COLUMN compressor");
    legacy.close();
    const migrated = openStore(path);
    assert.deepEqual(migrated.playback("old").compressor(), defaultCompressor);
    assert.equal(migrated.playback("old").mixTrim(), 73);
    const editor = new DatabaseSync(path);
    for (const bad of [
      "not JSON",
      '{"enabled":true,"ratio":999}',
      '{"enabled":true,"unknown":1}',
    ]) {
      editor.prepare("UPDATE playback SET compressor = ? WHERE id = 'old'").run(bad);
      assert.deepEqual(migrated.playback("old").compressor(), defaultCompressor);
    }
    migrated.playback("old").saveCompressor({ ...defaultCompressor, enabled: true });
    assert.deepEqual(migrated.playback("unrelated").compressor(), defaultCompressor);
    editor.close();
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
