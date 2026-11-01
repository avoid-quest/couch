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
