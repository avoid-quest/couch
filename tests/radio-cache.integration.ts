import assert from "node:assert/strict";
import { test } from "node:test";
import { createRadio } from "../src/server/radio";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
test("radio details reuse fresh searches, prefer saved metadata, and respect expiry and the 50-search bound", async () => {
  const realNow = Date.now; let now = realNow(), calls = 0;
  Date.now = () => now;
  const radio = createRadio({ databasePath: ":memory:", discover: async () => ["https://fixture.api.radio-browser.info"], fetch: async input => {
    calls++;
    const url = new URL(String(input));
    const stationuuid = url.searchParams.get("name")?.startsWith("other") ? "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" : id;
    return Response.json([{ stationuuid, name: "Directory FM", url: "https://audio.example/fm", homepage: "", countrycode: "IT", codec: "MP3", bitrate: 128 }]);
  } });
  try {
    const [station] = await radio.search({ q: "Fixture" });
    await radio.getStation(id); await radio.getStation(id.toUpperCase());
    await Promise.all([radio.getStation(id), radio.getStation(id)]);
    assert.equal(calls, 1, "four details reads after search need zero extra upstream calls");
    radio.saveFavorite({ ...station, name: "Saved FM" });
    assert.equal((await radio.getStation(id)).name, "Saved FM");
    radio.removeFavorite(id);
    now += 5 * 60_000 + 1;
    await radio.getStation(id); assert.equal(calls, 2);
    await radio.search({ q: "Fixture" });
    for (let i = 0; i < 50; i++) await radio.search({ q: `other-${i}` });
    await radio.getStation(id); assert.equal(calls, 54, "oldest search metadata must be evicted");
  } finally { Date.now = realNow; radio.close(); }
});

test("configured playlist rows take precedence over fresh directory search metadata", async () => {
  let stationId = "", directoryCalls = 0;
  const radio = createRadio({ databasePath: ":memory:", discover: async () => ["https://fixture.api.radio-browser.info"], fetch: async input => {
    if (String(input) === "https://playlist.example/radio.m3u") return new Response("#EXTM3U\n#EXTINF:-1,Playlist FM\nhttps://audio.example/fm\n");
    directoryCalls++;
    return Response.json([{ stationuuid: stationId, name: "Directory FM", url: "https://audio.example/old", homepage: "", countrycode: "IT", codec: "MP3", bitrate: 128 }]);
  } });
  try {
    const playlist = await radio.addPlaylist({ name: "My stations", url: "https://playlist.example/radio.m3u" });
    const [local] = radio.playlistStations({ playlistId: playlist.id });
    assert.ok(local); stationId = local.id;
    const [search] = await radio.search({ q: "FM" }); assert.equal(search?.name, "Directory FM");
    assert.deepEqual(await radio.getStation(stationId), local);
    assert.equal(directoryCalls, 1);
  } finally { radio.close(); }
});
