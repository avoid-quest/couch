import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../src/server/sqlite";
import { openStore } from "../src/server/store";
import { playbackMediaId } from "../src/server/progress";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";

test("a post-creation REST history read failure settles its empty Playback", { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const phone = await f.connect(), tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1");
  const entry = { id: "history", title: "History", source: `${f.hub.origin}/api/health` }, mediaId = playbackMediaId(entry)!;
  const store = openStore(f.databasePath);
  try { store.saveProgress("household", { mediaId, title: entry.title, position: 12, duration: 60, watched: false, lastPlayedAt: 1 }, entry); }
  finally { store.close(); }
  const before = phone.state.playbacks;
  let reads = 0;
  const query = Database.prototype.query;
  t.mock.method(Database.prototype, "query", function(this: Database, ...args: Parameters<Database["query"]>) {
    if (args[0].startsWith("SELECT profileId, mediaId, title, position") && ++reads === 2) throw new Error("Injected post-creation history read failure");
    return Reflect.apply(query, this, args);
  });
  const failed = await f.api(`/api/progress/${encodeURIComponent(mediaId)}/play?on=${tv.id}`, f.devices[1]!.token, { profileId: "household" });
  assert.equal(failed.status, 500, "the injected storage read fails after own() selected a new Playback");
  assert.ok(reads >= 2);
  // A separate real command publishes the final state even if the failed path never did.
  resultOk(await phone.command({ type: "sharing", sharing: { audio: false, video: false } }));
  assert.deepEqual(phone.state.playbacks, before, "a failed REST command must retire the empty Playback it created");
  t.mock.restoreAll();
  const success = await f.api(`/api/progress/${encodeURIComponent(mediaId)}/play?on=${tv.id}`, f.devices[1]!.token, { profileId: "household" });
  assert.equal(success.status, 200, "explicit Play on remains usable after failure");
  await until(() => tv.state.currentEntryId !== null);
  assert.ok(tv.state.outputs?.some(output => output.deviceId === tv.id));
});

for (const transport of ["REST", "WebSocket"] as const) test(`completing an unrelated ${transport} request preserves a pending catalogue Playback`, { timeout: 15_000 }, async t => {
  const f = await authorityFixture(); t.after(() => f.close());
  const tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1");
  const other = transport === "WebSocket" ? await f.connect(f.devices[3]!, "&tv=1&audio=1&video=1") : undefined;
  const browsing = Promise.withResolvers<void>(), loading = Promise.withResolvers<void>();
  const search = Promise.withResolvers<Response>(), list = Promise.withResolvers<Response>();
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("raiplay-search-service") || String(input) === "https://www.raiplay.it/programmi/settlement-first.json") { browsing.resolve(); return search.promise; }
    if (String(input) === "https://www.raiplay.it/programmi/settlement.json") { loading.resolve(); return list.promise; }
    return localFetch(input, init);
  });
  const listResponse = () => Response.json({ name: "Delayed list", items: [{ name: "Delayed episode", weblink: "/video/2026/10/settlement-episode.html" }] });
  const searchResponse = () => other ? listResponse() : Response.json({ agg: { titoli: { cards: [] }, video: { cards: [] } } });
  try {
    const browse = other
      ? other.command({ type: "enqueueProvider", provider: "raiplay", shape: "playlist", url: "https://www.raiplay.it/programmi/settlement-first", playNow: false })
      : f.api("/api/providers/raiplay/items?q=settlement");
    await browsing.promise;
    const pending = tv.command({ type: "enqueueProvider", provider: "raiplay", shape: "playlist", url: "https://www.raiplay.it/programmi/settlement", playNow: false });
    await loading.promise;
    search.resolve(searchResponse());
    const finished = await browse;
    if (finished instanceof Response) assert.equal(finished.status, 200);
    else resultOk(finished);
    list.resolve(listResponse());
    resultOk(await pending);
    await until(() => tv.state.queue.some(entry => entry.title === "Delayed episode"));
    assert.ok(tv.state.outputs?.some(output => output.deviceId === tv.id), "unrelated request cleanup must retain the pending queue's destination");
  } finally {
    search.resolve(searchResponse()); list.resolve(listResponse());
  }
});
