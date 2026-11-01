import assert from "node:assert/strict";
import { test } from "node:test";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";

test(
  "completing an unrelated REST request preserves a pending catalogue Playback",
  { timeout: 15_000 },
  async (t) => {
    const f = await authorityFixture(t);
    t.after(() => f.close());
    const tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1");
    const browsing = Promise.withResolvers<void>(),
      loading = Promise.withResolvers<void>();
    const search = Promise.withResolvers<Response>(),
      list = Promise.withResolvers<Response>();
    const localFetch = globalThis.fetch;
    t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("raiplay-search-service")) {
        browsing.resolve();
        return search.promise;
      }
      if (String(input) === "https://www.raiplay.it/programmi/settlement.json") {
        loading.resolve();
        return list.promise;
      }
      return localFetch(input, init);
    });
    const listResponse = () =>
      Response.json({
        name: "Delayed list",
        items: [{ name: "Delayed episode", weblink: "/video/2026/10/settlement-episode.html" }],
      });
    const searchResponse = () =>
      Response.json({ agg: { titoli: { cards: [] }, video: { cards: [] } } });
    try {
      const browse = f.api("/api/providers/raiplay/items?q=settlement");
      await browsing.promise;
      const pending = tv.command({
        type: "enqueueProvider",
        provider: "raiplay",
        shape: "playlist",
        url: "https://www.raiplay.it/programmi/settlement",
        playNow: false,
      });
      await loading.promise;
      search.resolve(searchResponse());
      assert.equal((await browse).status, 200);
      list.resolve(listResponse());
      resultOk(await pending);
      await until(() => tv.state.queue.some((entry) => entry.title === "Delayed episode"));
      assert.ok(
        tv.state.outputs?.some((output) => output.deviceId === tv.id),
        "unrelated request cleanup must retain the pending queue's destination",
      );
    } finally {
      search.resolve(searchResponse());
      list.resolve(listResponse());
    }
  },
);
