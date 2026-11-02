import assert from "node:assert/strict";
import { test } from "node:test";
import { createRadio } from "../src/server/radio";

test("configured playlist rows take precedence over fresh directory search metadata", async () => {
  let stationId = "",
    directoryCalls = 0;
  const radio = createRadio({
    databasePath: ":memory:",
    discover: async () => ["https://fixture.api.radio-browser.info"],
    fetch: async (input) => {
      if (String(input) === "https://playlist.example/radio.m3u")
        return new Response("#EXTM3U\n#EXTINF:-1,Playlist FM\nhttps://audio.example/fm\n");
      directoryCalls++;
      return Response.json([
        {
          stationuuid: stationId,
          name: "Directory FM",
          url: "https://audio.example/old",
          homepage: "",
          countrycode: "IT",
          codec: "MP3",
          bitrate: 128,
        },
      ]);
    },
  });
  try {
    const playlist = await radio.addPlaylist({
      name: "My stations",
      url: "https://playlist.example/radio.m3u",
    });
    const [local] = radio.playlistStations({ playlistId: playlist.id });
    assert.ok(local);
    stationId = local.id;
    const [search] = await radio.search({ q: "FM" });
    assert.equal(search?.name, "Directory FM");
    assert.deepEqual(await radio.getStation(stationId), local);
    assert.equal(directoryCalls, 1);
  } finally {
    radio.close();
  }
});

test("recognition resolves only catalog or directory stations and preserves their identity", async (t) => {
  const directoryStation = {
    stationuuid: "01234567-89ab-4cde-8fab-0123456789ab",
    name: "Directory FM",
    url: "https://audio.example/fm",
    homepage: "",
    countrycode: "IT",
    codec: "MP3",
    bitrate: 128,
  };
  const lookups: string[] = [];
  const radio = createRadio({
    databasePath: ":memory:",
    discover: async () => ["https://fixture.api.radio-browser.info"],
    fetch: async (input) => {
      const url = new URL(String(input));
      lookups.push(url.href);
      if (url.hostname === "playlist.example")
        return new Response("#EXTM3U\n#EXTINF:-1,Playlist FM\nhttps://playlist.example/fm\n");
      return Response.json([directoryStation]);
    },
  });
  t.after(() => radio.close());
  const playlist = await radio.addPlaylist({
    name: "Radio",
    url: "https://playlist.example/radio.m3u",
  });
  const [local] = radio.playlistStations({ playlistId: playlist.id });
  assert.ok(local);
  assert.deepEqual(await radio.getStationByUrl(local.url), local);
  const lookedUp = await radio.getStationByUrl(directoryStation.url);
  assert.equal(lookedUp.id, directoryStation.stationuuid);
  assert.equal(lookedUp.name, directoryStation.name);
  assert.equal(new URL(lookups.at(-1)!).pathname, "/json/stations/byurl");
  assert.equal(new URL(lookups.at(-1)!).searchParams.get("url"), directoryStation.url);
  await assert.rejects(radio.getStationByUrl("https://example.com/not-radio"), { status: 404 });
  await assert.rejects(radio.getStationByUrl("file:///tmp/song.mp3"), { status: 400 });
  const [cached] = await radio.search({ q: "FM" });
  const before = lookups.length;
  assert.deepEqual(await radio.getStationByUrl(directoryStation.url), cached);
  assert.equal(lookups.length, before);
  assert.deepEqual(radio.favorites(), []);
});
