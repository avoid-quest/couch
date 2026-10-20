import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { liveFixture, until } from "./live-input.fixture";

for (const secondStatus of [200, 404]) test(`a screen reports its own ${secondStatus} after another screen's relay refuses`, { timeout: 15_000 }, async t => {
  let status = 200;
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  const upstream = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/vnd.apple.mpegurl" });
    response.end(status === 200 ? "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n" : "");
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const port = (upstream.address() as import("node:net").AddressInfo).port;
  const f = await liveFixture();
  t.after(async () => { await f.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  const other = await f.connect(2, "&audio=1&video=1");
  await f.receiver.command({ type: "sharing", sharing: { audio: true, video: true } });
  const start = await f.receiver.command({ type: "enqueue", entry: { id: "film", title: "Film", source: `http://127.0.0.1:${port}/film.m3u8` }, playNow: true, deviceId: f.receiver.id });
  assert.equal(start.ok, true, start.error);
  await until(() => !!f.receiver.load());
  f.receiver.report();
  await f.speaker(1);
  assert.equal((await f.receiver.command({ type: "output", deviceId: other.id, picture: true, level: 0 })).ok, true);
  await until(() => !!other.load()?.follow && other.state.player.position > 0);
  const first = f.receiver.load()!, second = other.load()!;
  assert.equal(first.playbackId, second.playbackId);
  assert.notEqual(first.source, second.source);
  assert.ok(first.source.includes("/api/relay/") && second.source.includes("/api/relay/"));
  status = 403;
  assert.equal((await fetch(first.source)).status, 403);
  status = secondStatus;
  assert.equal((await fetch(second.source)).status, secondStatus);
  other.report({ playbackId: second.playbackId, status: "error", error: "Picture decoder failed" });
  // Synced sound owns the shared PlayerState; the screen's rewritten failure reaches couch.log.
  await until(() => lines.some(line => line.includes("player error") && line.includes("on Other")));
  const expected = secondStatus === 200 ? "Picture decoder failed" : "The website refused this stream (HTTP 404). Play it again.";
  const error = lines.find(line => line.includes("player error") && line.includes("on Other"))!;
  assert.equal(error.slice(error.indexOf(": ") + 2), expected);
  f.receiver.report({ playbackId: first.playbackId, status: "error", error: "Picture decoder failed" });
  await until(() => lines.some(line => line.includes("player error") && line.includes("on Receiver")));
  assert.ok(lines.find(line => line.includes("player error") && line.includes("on Receiver"))!.endsWith("The website refused this stream (HTTP 403). Play it again."));
});
