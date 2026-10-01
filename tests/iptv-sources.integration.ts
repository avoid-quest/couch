import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuide } from "../src/server/iptv";

test("optional guide URLs accept only blank strings or omission, and edits keep saved URLs", async () => {
  const fetched: string[] = [];
  const guide = createGuide({ databasePath: ":memory:", fetch: (async input => {
    fetched.push(String(input));
    return new Response('#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://media.example/live.m3u8\n');
  }) as typeof fetch });
  const send = (path: string, body: unknown) => guide.handle(new Request(`http://couch.local/api/iptv/sources${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), () => ({ device: null, authority: "host", claimAvailable: false }));
  const valid = { name: "TV", playlistUrl: "https://media.example/channels.m3u" };
  try {
    for (const guideUrl of [null, false, 0]) assert.equal((await send("", { ...valid, guideUrl })).status, 400);
    assert.equal(fetched.length, 0);
    const created = await send("", { ...valid, guideUrl: "" });
    assert.equal(created.status, 201);
    const { source } = await created.json() as { source: { id: string } };
    for (const field of ["playlistUrl", "guideUrl"]) for (const value of [null, false, 0]) {
      assert.equal((await send(`/${source.id}`, { name: "TV", [field]: value })).status, 400);
    }
    for (const urls of [{}, { playlistUrl: "", guideUrl: "" }]) assert.equal((await send(`/${source.id}`, { name: "Renamed", ...urls })).status, 200);
    assert.deepEqual(fetched, Array(3).fill(valid.playlistUrl));
  } finally { guide.close(); }
});
