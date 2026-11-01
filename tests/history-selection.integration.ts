import { test } from "node:test";
import { executableName, nodeExecutables } from "./executable.fixture";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createHub } from "../src/server/hub";
import { openStore } from "../src/server/store";
import { playbackMediaId } from "../src/server/progress";
import { helper, startHelpers } from "../src/server/helpers";
import { updateStatus } from "../src/server/helper-status";
import type { PlaybackCommand, QueueEntry, ServerMessage, SessionState } from "../src/shared/protocol";

// Actual REST -> Hub -> Session -> renderer load, using private SQLite and offline helpers.
test("Core resumes alias history on the requested device with selected occurrence and quality", { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(process.env.COUCH_DATA_DIR ?? tmpdir(), "history-selection-"));
  const bin = join(directory, "bin"), helpers = join(directory, "helpers"), databasePath = join(directory, "couch.sqlite");
  const before = { PATH: process.env.PATH, COUCH_DATA_DIR: process.env.COUCH_DATA_DIR };
  const fixtures = nodeExecutables(directory);
  mkdirSync(bin);
  process.env.PATH = bin;
  process.env.COUCH_DATA_DIR = directory;
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (new URL(String(input)).hostname !== "127.0.0.1") throw new Error("Offline fixture");
    return fetchLocal(input, init);
  });
  const timers: ReturnType<typeof setInterval>[] = [], interval = globalThis.setInterval;
  t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => { const timer = interval(...args); timers.push(timer); return timer; });
  for (const [name, version] of [["qjs", "0.17.0"], ["ffmpeg", "ffmpeg version 9.0.2"]]) {
    writeFileSync(join(bin, executableName(name!)), `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
  }
  const url = "https://www.youtube.com/watch?v=abcdefghijk";
  const collection = { title: "Selected list", url: "https://www.youtube.com/playlist?list=PLselected123", index: 2 };
  writeFileSync(join(bin, executableName("yt-dlp")), `#!${process.execPath}
if (process.argv.includes("--version")) console.log("2026.10.21");
else if (process.argv.includes("--flat-playlist")) console.log(JSON.stringify({title:"Selected list", entries:[0,1,2,3].map(index => ({id:index === 3 ? "other000002" : "abcdefghijk", title:"Occurrence " + index, url:index === 3 ? "https://www.youtube.com/watch?v=other000002" : ${JSON.stringify(url)}}))}));
else console.log(JSON.stringify({title:"Video",url:"https://example.com/video.mp4",protocol:"https",duration:100}));
`, { mode: 0o755 });
  const hostId = "h".repeat(43), hostToken = "h".repeat(64), tvId = "t".repeat(43);
  const store = openStore(databasePath, true), tvToken = store.pair(tvId, "Fixture TV");
  const saved = ["https://youtu.be/abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk"].map((source, index) => {
    const entry: QueueEntry = { id: `previous-${index}`, source: `web:${source}`, title: "Video", collection: { ...collection, index: 0 } };
    const mediaId = playbackMediaId(entry)!;
    store.saveProgress(store.activeProfile().id, { mediaId, title: entry.title, position: 45, duration: 100, watched: false, lastPlayedAt: index + 1 }, entry);
    return { entry, mediaId };
  });
  store.close();
  const sockets: WebSocket[] = [];
  let hub: Awaited<ReturnType<typeof createHub>> | undefined;
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await hub?.close();
    await updateStatus(helpers, () => {});
    for (const timer of timers) clearInterval(timer);
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await fixtures.close();
    rmSync(directory, { recursive: true, force: true });
  });
  startHelpers(helpers);
  await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
  hub = await createHub({ databasePath, hostToken, hostname: "127.0.0.1", port: Number(process.env.COUCH_PORT) || 0, streamingCommunityFetch: async () => new Response("", { status: 503 }) });
  const loads: Extract<PlaybackCommand, { type: "load" }>[] = [];
  let state: SessionState | undefined;
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 3_000;
    while (!condition()) { assert.ok(Date.now() < deadline, "Core did not publish the expected load/state"); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const socket = new WebSocket(`${hub.origin.replace("http:", "ws:")}/api/ws?token=${tvToken}&device=${tvId}&tv=1&audio=1&video=1`, { headers: { Origin: hub.origin } });
  sockets.push(socket);
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "state") state = message.state;
    if (message.type === "player" && message.command.type === "load") {
      loads.push(message.command);
      socket.send(JSON.stringify({ type: "player", state: { playbackId: message.command.playbackId, status: "paused", buffering: false, position: message.command.startPosition ?? 0, duration: 100, volume: 80, seekable: true, error: null, speed: 1, tracks: [], audioDelay: 0, subtitleDelay: 0 } }));
    }
  };
  await until(() => !!state);
  const request = (path: string, body?: unknown, token = hostToken) => fetch(`${hub!.origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: hub!.origin, "X-Couch-Device": hostId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  for (const { entry, mediaId } of saved) {
    const historyResponse = await request("/api/progress/history");
    assert.equal(historyResponse.status, 200);
    const history = (await historyResponse.json()).items.find((item: { mediaId: string }) => item.mediaId === mediaId);
    assert.equal(history.url, url);
    assert.equal(history.source, undefined);
    for (const fromStart of [false, true]) {
      const count = loads.length;
      const response = await request(`/api/progress/${encodeURIComponent(mediaId)}/play?on=${tvId}`, { profileId: state!.activeProfile.id, fromStart, selection: { collection, quality: "720p" } });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      await until(() => loads.length === count + 1 && !!state?.queue.some(current => current.id === state?.currentEntryId && current.collection?.index === 2));
      assert.equal(loads.at(-1)!.startPosition ?? 0, fromStart ? 0 : 45);
      const current = state!.queue.find(current => current.id === state!.currentEntryId)!;
      assert.equal(current.source, entry.source);
      assert.equal(playbackMediaId(current), mediaId);
      assert.deepEqual(current.collection, collection);
      assert.equal(current.quality, "720p");
    }
  }
  const count = loads.length;
  assert.equal((await request(`/api/progress/${encodeURIComponent(saved[0]!.mediaId)}/play?on=${tvId}`, { profileId: state!.activeProfile.id, selection: { collection } }, "invalid-fixture-token")).status, 401);
  assert.equal(loads.length, count);
  const history = (await (await request("/api/progress/history")).json()).items;
  assert.deepEqual(history.map((item: { mediaId: string }) => item.mediaId).sort(), saved.map(item => item.mediaId).sort());
});
