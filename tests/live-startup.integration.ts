import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import { liveFixture, until } from "./live-input.fixture";

test("a last fallback receiver leaving during encoder startup never requests an upload", { timeout: 15_000 }, async t => {
  const f = await liveFixture();
  const spawn = childProcess.spawn, access = fs.access, emit = WebSocket.prototype.emit;
  const executable = join(dirname(f.databasePath), "ffmpeg");
  let lookups = 0;
  let child: ChildProcess | undefined, directory: string | undefined, provisioned: (() => void) | undefined;
  // Release the helper lookup in the same turn as the receiver's departure.
  // The encoder process, startup notification, flush and upload messages stay real.
  t.mock.method(fs, "access", async (...args: Parameters<typeof fs.access>) => {
    await access(...args);
    // onPath checks first; helper() rechecks the chosen executable immediately
    // before returning it to liveStreams.start(). Hold that final completion.
    if (args[0] === executable && ++lookups === 2) await new Promise<void>(resolve => { provisioned = resolve; });
  });
  t.mock.method(childProcess, "spawn", (...args: Parameters<typeof childProcess.spawn>) => {
    const process = spawn(...args);
    const playlist = args[1]?.at(-1);
    if (typeof playlist === "string" && playlist.endsWith("/stream.m3u8")) {
      child = process;
      directory = dirname(playlist);
    }
    return process;
  });
  syncBuiltinESMExports();
  // Complete setup after the server has handled the disconnect, before its
  // setImmediate broadcast. send() must still exercise its synchronous flush.
  t.mock.method(WebSocket.prototype, "emit", function (this: WebSocket & { data?: { deviceId?: string } }, event: string, ...values: unknown[]) {
    const result = emit.call(this, event, ...values);
    if (event === "close" && this.data?.deviceId === f.receiver.id) provisioned?.();
    return result;
  });
  try {
    await f.publish("screen");
    await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
    await f.publisher.command({ type: "playLive", sourceId: "screen", deviceId: f.receiver.id });
    await until(() => !!f.receiver.load()?.livePeerId);
    f.receiver.socket.send(JSON.stringify({ type: "liveFailed", peerId: f.receiver.load()!.livePeerId, error: "Unreachable." }));
    await until(() => !!provisioned);
    f.receiver.socket.close();
    await until(() => f.publisher.state.devices?.find(device => device.id === f.receiver.id)?.online === false);
    await until(() => child?.signalCode === "SIGKILL" && !!directory && !existsSync(directory));
    assert.equal(f.publisher.messages.some(message => message.type === "livePeers" && message.upload), false, "no transient upload request reaches the publisher after demand disappears");
    assert.equal(f.uploads.size, 0);
    assert.equal(f.publisher.state.liveSources?.[0]?.id, "screen", "capture remains published");
  } finally {
    provisioned?.();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await f.close();
  }
});
