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
    for (const value of [null, false, 0]) assert.equal((await send(`/${source.id}`, { name: "TV", playlistUrl: value })).status, 400);
    for (const value of [false, 0]) assert.equal((await send(`/${source.id}`, { name: "TV", guideUrl: value })).status, 400);
    for (const urls of [{}, { playlistUrl: "", guideUrl: "" }]) assert.equal((await send(`/${source.id}`, { name: "Renamed", ...urls })).status, 200);
    assert.deepEqual(fetched, Array(3).fill(valid.playlistUrl));
  } finally { guide.close(); }
});

test("an edit with a null guide URL removes the guide and its programmes; a blank one keeps it", async () => {
  const now = new Date(), stamp = (offset: number) => new Date(now.getTime() + offset).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
  const xmltv = `<tv><channel id="one"><display-name>One</display-name></channel><programme channel="one" start="${stamp(-3_600_000)}" stop="${stamp(3_600_000)}"><title>News</title></programme></tv>`;
  const guide = createGuide({ databasePath: ":memory:", fetch: (async input => new Response(String(input).endsWith(".xml") ? xmltv
    : '#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://media.example/live.m3u8\n')) as typeof fetch });
  const call = (path: string, body?: unknown) => guide.handle(new Request(`http://couch.local/api/iptv${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), () => ({ device: null, authority: "host", claimAvailable: false }));
  const listed = async () => ((await (await call("/sources")).json()) as { sources: { hasGuide: boolean; programCount: number }[] }).sources[0]!;
  try {
    const created = await call("/sources", { name: "TV", playlistUrl: "https://media.example/channels.m3u", guideUrl: "https://media.example/guide.xml" });
    const { source } = await created.json() as { source: { id: string } };
    assert.deepEqual(await listed(), { ...await listed(), hasGuide: true, programCount: 1 });
    assert.equal(JSON.stringify(await listed()).includes("guide.xml"), false);
    assert.equal((await call(`/sources/${source.id}`, { name: "TV", guideUrl: "" })).status, 200);
    assert.equal((await listed()).programCount, 1);
    assert.equal((await call(`/sources/${source.id}`, { name: "TV", guideUrl: null })).status, 200);
    assert.deepEqual(await listed(), { ...await listed(), hasGuide: false, programCount: 0 });
    const { channels } = await (await call("/guide")).json() as { channels: { now: unknown; next: unknown }[] };
    assert.deepEqual(channels.map(item => [item.now, item.next]), [[null, null]]);
  } finally { guide.close(); }
});
