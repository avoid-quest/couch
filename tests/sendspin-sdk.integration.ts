import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import {
  SendspinCore,
  loadSendspinClientIdentity,
  type DecodedAudioChunk,
} from "@sendspin/sendspin-js";
import { liveFixture, until } from "./live-input.fixture";

const ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";

for (const intent of ["live", "relaxed"] as const)
  test(
    `unmodified browser SDK receives encrypted ${intent} capture with its own buffering policy`,
    { timeout: 15_000 },
    async (t) => {
      const f = await liveFixture({ media: { ffmpeg, recording: new Uint8Array() } });
      const host = await f.connect(-1),
        identity = f.identities[1]!;
      const values = new Map<string, string>([["sendspin-static-delay-ms", "200"]]);
      const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      };
      identity.id = loadSendspinClientIdentity(storage).clientId;
      const receiver = await f.connect(1); // Existing Couch token rebinds the new SDK identity.
      const authorization = await fetch(`${f.hub.origin}/api/audio/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${identity.token}` },
      });
      assert.equal(authorization.status, 204);
      const cookie = authorization.headers.get("set-cookie")!.split(";")[0]!;
      const originalSocket = globalThis.WebSocket;
      // Node has no browser cookie jar. Supply the HTTP cookie at the public socket boundary.
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        writable: true,
        value: class extends WebSocket {
          constructor(url: string | URL) {
            super(url, { headers: { Cookie: cookie } });
          }
        },
      });
      t.after(() => {
        globalThis.WebSocket = originalSocket;
      });
      const chunks: DecodedAudioChunk[] = [];
      const player = new SendspinCore({
        suite: "aesgcm",
        storage,
        baseUrl: f.hub.origin,
        codecs: ["pcm"],
        minBufferMs: 150,
      });
      player.onAudioData = (chunk) => chunks.push(chunk);
      let capture: { stop(): void } | undefined;
      t.after(async () => {
        capture?.stop();
        player.disconnect("user_request");
        await f.close();
      });
      assert.equal(
        (
          await host.command({
            type: "publishLive",
            sourceId: "host-input",
            uploadToken: f.uploadToken,
            kind: "microphone",
            audio: true,
            video: false,
            audioDelivery: "pcm",
            intent,
          })
        ).ok,
        true,
      );
      assert.equal(
        (
          await receiver.command({
            type: "playLive",
            sourceId: "host-input",
            deviceId: identity.id,
          })
        ).ok,
        true,
      );
      await player.connect();
      assert.equal(player.clientId, identity.id);
      assert.equal(
        player.getSyncDelayMs(),
        0,
        "upstream ignores compensation saved before its timing fix",
      );
      const input = await f.streamCapture(
        host,
        "host-input",
        -1,
        (position, channel) =>
          0.2 * Math.sin((2 * Math.PI * 440 * position) / 48000) * (channel ? -1 : 1),
      );
      capture = input;
      await until(() => chunks.length > 5);
      assert.equal(player.currentFormat?.codec, "pcm");
      assert.equal(chunks[0]!.sampleRate, 48000);
      assert.equal(chunks[0]!.samples.length, 2);
      assert.equal(chunks[0]!.samples[0]!.length, 240);
      assert.ok(chunks.every((chunk) => Number.isSafeInteger(chunk.serverTimeUs)));
      assert.ok(
        chunks.some((chunk) => chunk.samples[0]!.some((value) => value > 0.15)),
        "the intended nonzero signal survives encryption, capture conversion and SDK decoding",
      );
      assert.ok(
        chunks.every((chunk) =>
          chunk.samples[0]!.every((value, i) => Math.abs(value + chunk.samples[1]![i]!) < 0.001),
        ),
        "the two input channels retain their opposite polarities",
      );
      const lead = intent === "live" ? 150_000 : 1_000_000;
      // The decoder can skip early packets during startup; surviving 5 ms chunks
      // still belong to the source timeline plus the configured presentation lead.
      assert.ok(chunks[0]!.serverTimeUs - input.origin >= lead);
      assert.ok(chunks.every((chunk) => (chunk.serverTimeUs - input.origin - lead) % 5_000 === 0));
    },
  );

test(
  "encrypted init cannot claim another device behind an authenticated token",
  { timeout: 10_000 },
  async (t) => {
    const f = await liveFixture();
    const identity = f.identities[1]!;
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    f.identities[0]!.id = loadSendspinClientIdentity(storage).clientId;
    await f.connect(0); // This key belongs to a different, legitimately paired Device.
    const player = new SendspinCore({
      suite: "aesgcm",
      storage,
      baseUrl: `${f.hub.origin}/api/audio/${identity.token}`,
      codecs: ["pcm"],
      reconnect: { maxAttempts: 0 },
    });
    let closed = false;
    player.onConnectionClose = () => {
      closed = true;
    };
    t.after(async () => {
      player.disconnect("user_request");
      await f.close();
    });
    await player.connect().catch(() => {});
    await until(() => closed);
    assert.equal(player.isConnected, false);
    assert.equal((await fetch(`${f.hub.origin}/api/audio/invalid-token/sendspin`)).status, 401);
  },
);
