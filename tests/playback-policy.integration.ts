import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { liveFixture, until } from "./live-input.fixture";
import { parseCommand } from "../src/server/validation";

for (const master of ["/master.m3u8", "/stream"])
  test(
    `Core sound-only Direct selects ${master} without video; restoring picture keeps its queue`,
    { timeout: 15_000 },
    async () => {
      const requested: string[] = [];
      const media = createServer((request, response) => {
        requested.push(request.url!);
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        if (request.url === master)
          response.end(
            '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,NAME="Sound",URI="/sound.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio",CODECS="avc1.640028,mp4a.40.2"\n/picture.m3u8\n',
          );
        else if (request.url === "/sound.m3u8")
          response.end(
            "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/sound.aac\n#EXT-X-ENDLIST\n",
          );
        else if (request.url === "/picture.m3u8")
          response.end(
            "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n/picture.ts\n#EXT-X-ENDLIST\n",
          );
        else response.end("fixture media");
      });
      await new Promise<void>((resolve) => media.listen(0, "127.0.0.1", resolve));
      const source = `http://127.0.0.1:${(media.address() as { port: number }).port}${master}`;
      const f = await liveFixture();
      try {
        assert.equal(
          (
            await f.receiver.command({
              type: "enqueue",
              entry: { id: "seed", title: "Seed", source: `${f.hub.origin}/api/health` },
              playNow: true,
              deviceId: f.receiver.id,
            })
          ).ok,
          true,
        );
        await until(() => f.receiver.load()?.source.includes("/api/health") === true);
        f.receiver.report();
        await until(() => f.receiver.state.player.status === "playing");
        assert.equal(
          (await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: false }))
            .ok,
          true,
        );
        assert.equal(
          (
            await f.receiver.command({
              type: "enqueue",
              entry: { id: "programme", title: "Programme", source },
              playNow: true,
            })
          ).ok,
          true,
        );
        await until(() => f.receiver.load()?.source.includes("sound.m3u8") === true);
        const command = f.receiver.load()!;
        assert.deepEqual(command.output, { picture: false, sound: true });
        assert.equal(command.audioSource, undefined);
        assert.equal(command.follow, undefined);
        for (const internal of [
          "headers",
          "audioManifest",
          "credentialOrigin",
          "publicNetwork",
          "hasAudio",
        ])
          assert.equal(
            internal in command,
            false,
            `${internal} stays inside Core source preparation`,
          );
        assert.equal(
          f.receiver.state.playbacks?.find((item) => item.id === f.receiver.state.playback)
            ?.delivery,
          "direct",
        );
        assert.ok(
          requested.includes(master) && requested.includes("/sound.m3u8"),
          "the fixture exercised real Core HTTP preparation",
        );
        assert.equal(
          requested.filter((path) => path === master).length,
          1,
          "one load selects its rendition once",
        );
        assert.equal(
          requested.some((path) => path.startsWith("/picture")),
          false,
          "even source classification and relay preparation must leave unused picture bytes alone",
        );
        await f.receiver.command({
          type: "enqueue",
          entry: { id: "next-item", title: "Next", source: `${f.hub.origin}/api/health` },
        });
        const queue = f.receiver.state.queue.map((entry) => entry.id),
          playback = f.receiver.state.playback;
        f.receiver.report({ duration: 5, seekable: true, audioDelay: undefined });
        await until(() => f.receiver.state.player.status === "playing");
        assert.equal(
          (
            await f.receiver.command({
              type: "audioDelay",
              playbackId: command.playbackId,
              delay: 0.1,
            })
          ).ok,
          false,
          "muxed audio delay is unavailable when the renderer reports none",
        );
        assert.equal(
          (await f.receiver.command({ type: "output", deviceId: f.receiver.id, picture: true })).ok,
          true,
        );
        await until(() => f.receiver.load()?.output?.picture === true);
        assert.equal(f.receiver.state.playback, playback);
        assert.deepEqual(
          f.receiver.state.queue.map((entry) => entry.id),
          queue,
        );
        assert.equal(f.receiver.load()!.playbackId, command.playbackId);
        assert.equal(
          f.receiver.load()?.source,
          source,
          "restoring picture reselects the complete master",
        );
        f.receiver.report({ audioDelay: 0 });
        await until(() => f.receiver.state.controls?.audioDelay === true);
        assert.equal(
          (
            await f.receiver.command({
              type: "audioDelay",
              playbackId: command.playbackId,
              delay: 0.08,
            })
          ).ok,
          true,
          "a renderer that supports split audio retains useful delay",
        );
      } finally {
        await f.close();
        media.closeAllConnections();
        await new Promise<void>((resolve) => media.close(() => resolve()));
      }
    },
  );

test(
  "relative transport seeks accumulate through buffering and delayed observations",
  { timeout: 10000 },
  async () => {
    const f = await liveFixture();
    try {
      assert.equal(
        (
          await f.receiver.command({
            type: "enqueue",
            entry: {
              id: "relative-seek",
              title: "Programme",
              source: `${f.hub.origin}/api/health`,
            },
            playNow: true,
            deviceId: f.receiver.id,
          })
        ).ok,
        true,
      );
      await until(() => !!f.receiver.load());
      f.receiver.report({
        position: 12,
        duration: 60,
        seekable: true,
        status: "loading",
        buffering: true,
      });
      await until(() => f.receiver.state.player.position === 12);
      let playbackId = f.receiver.state.player.playbackId!;
      const relative = async (position: number) => {
        const result = await f.receiver.command({
          type: "seek",
          playbackId,
          position,
          relative: true,
        });
        assert.equal(result.ok, true, result.error);
        const latest = f.receiver.messages.findLast(
          (message) => message.type === "player" && message.command.type === "seek",
        );
        assert.ok(latest?.type === "player" && latest.command.type === "seek");
        assert.equal("relative" in latest.command, false, "renderers receive an absolute seek");
        return latest.command.position;
      };
      assert.equal(await relative(10), 22);
      assert.equal(await relative(10), 32, "a delayed clock must not discard the second key");
      f.receiver.report({
        position: 22,
        duration: 60,
        seekable: true,
        status: "loading",
        buffering: true,
      });
      assert.equal(
        await relative(10),
        42,
        "an older seek report must not replace the latest target",
      );
      assert.equal(await relative(-10), 32);
      assert.equal(await relative(100), 60);
      assert.equal(await relative(-100), 0);
      f.receiver.report({ position: 0, duration: 60, seekable: true });
      await until(() => f.receiver.state.player.status === "playing");
      f.receiver.report({ position: 3, duration: 60, seekable: true });
      assert.equal(
        await relative(10),
        13,
        "confirmed seeks resume from the observed programme clock",
      );
      assert.equal((await f.receiver.command({ type: "seek", playbackId, position: 45 })).ok, true);
      assert.equal(
        await relative(-10),
        35,
        "absolute seeks also establish the next relative target",
      );
      f.receiver.report({ position: 35, duration: 60, seekable: true });
      assert.equal(await relative(10), 45);
      assert.equal(await relative(-10), 35);
      f.receiver.report({ position: 35, duration: 60, seekable: true });
      f.receiver.report({ position: 45, duration: 60, seekable: true });
      assert.equal(
        await relative(10),
        45,
        "an unchanged old report cannot confirm a reversed seek",
      );
      await f.receiver.command({
        type: "enqueue",
        entry: {
          id: "replacement",
          title: "Replacement",
          source: `${f.hub.origin}/api/health?next`,
        },
        playNow: true,
      });
      await until(() => f.receiver.load()?.playbackId !== playbackId);
      playbackId = f.receiver.load()!.playbackId;
      f.receiver.report({ playbackId, position: 5, duration: 60, seekable: true });
      assert.equal(
        await relative(10),
        15,
        "the replacement must not inherit the retired seek target",
      );
      for (const invalid of [
        { position: -10 },
        { position: 10, relative: "yes" },
        { position: null, relative: true },
      ])
        assert.throws(() =>
          parseCommand(
            JSON.stringify({
              type: "command",
              requestId: "invalid",
              action: { type: "seek", playbackId, ...invalid },
            }),
          ),
        );
    } finally {
      await f.close();
    }
  },
);
