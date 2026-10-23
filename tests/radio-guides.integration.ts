import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRadio } from "../src/server/radio";
import { Database } from "../src/server/sqlite";
import { createRadioSettings } from "../src/server/radio-settings";
import { avoidRadioPlaylistUrl, radioNow } from "../src/shared/radio";

const m3u = readFileSync("tests/fixtures/radio/community.m3u", "utf8");
const xml = readFileSync("tests/fixtures/radio/community.xml", "utf8");

test("generic source-scoped guides, explicit override, favourites, directory tags and no-guide sources survive reload", async () => {
  const realNow = Date.now; Date.now = () => Date.parse("2026-10-24T23:45:00Z");
  const scratch = mkdtempSync(join(tmpdir(), "couch-radio-guides-"));
  const calls: string[] = [];
  const request: typeof fetch = async input => {
    const url = String(input); calls.push(url);
    if (url === avoidRadioPlaylistUrl) return new Response("#EXTM3U\n");
    if (url.includes(".api.radio-browser.info")) return Response.json([{ stationuuid: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Directory", url: "https://audio.example/dir", tags: "Jazz, jazz ,Talk,Deep House", bitrate: 128 }]);
    if (url.includes("bad-guide") && url.endsWith(".xml")) return new Response("broken guide");
    if (url.endsWith(".xml")) return new Response(url.includes("override") ? xml.replaceAll("Night Shift", "Other programme") : xml);
    return new Response(url.includes("no-guide") ? m3u.replace(' x-tvg-url="guide.xml"', '') : m3u);
  };
  let radio = createRadio({ databasePath: join(scratch, "couch.sqlite"), fetch: request, discover: async () => ["https://fixture.api.radio-browser.info"] });
  try {
    const first = await radio.addPlaylist({ name: "Community", url: "https://community.example/list.m3u" });
    const second = await radio.addPlaylist({ name: "Other", url: "https://other.example/list.m3u", guideUrl: "https://override.example/schedule.xml" });
    const bare = await radio.addPlaylist({ name: "No guide", url: "https://no-guide.example/list.m3u" });
    const failedGuide = await radio.addPlaylist({ name: "Bad guide", url: "https://bad-guide.example/list.m3u" });
    const one = radio.playlistStations({ playlistId: first.id })[0]!, two = radio.playlistStations({ playlistId: second.id })[0]!;
    assert.notEqual(one.id, two.id);
    radio.saveFavorite(one);
    const guides = await radio.programmes();
    assert.equal(radioNow(guides[one.id], one.id)?.title, "Night Shift");
    assert.equal(radioNow(guides[two.id], two.id)?.title, "Other programme");
    assert.equal(guides[radio.playlistStations({ playlistId: bare.id })[0]!.id], undefined);
    const failedStation = radio.playlistStations({ playlistId: failedGuide.id })[0]!;
    assert.equal(guides[failedStation.id], undefined);
    assert.equal(radio.getPlayable(failedStation.id).source, failedStation.url);
    assert.equal(calls.includes("https://other.example/guide.xml"), false);
    assert.equal((await radio.metadata.get(one.id, one.url)).programme?.title, "Night Shift");
    const [directory] = await radio.search({ q: "Directory" });
    assert.deepEqual(directory!.tags, ["Jazz", "Talk", "Deep House"]);
    radio.saveFavorite(directory);
    await radio.refreshPlaylist(first.id);
    assert.equal(radio.favorites().find(item => item.id === one.id)?.id, one.id);
    radio.close(); radio = createRadio({ databasePath: join(scratch, "couch.sqlite"), fetch: request });
    assert.equal(radio.favorites().find(item => item.id === one.id)?.sourceId, first.id);
    assert.deepEqual(radio.favorites().find(item => item.id === directory!.id)?.tags, directory!.tags);
    assert.equal(radio.playlists().find(item => item.id === second.id)?.guideUrl, "https://override.example/schedule.xml");
    radio.removePlaylist(first.id);
    assert.equal(radio.getPlayable(one.id).source, one.url);
    assert.equal(radio.favorites().some(item => item.id === one.id), true);
  } finally { radio.close(); Date.now = realNow; rmSync(scratch, { recursive: true, force: true }); }
});

test("existing JSON enrichment works without a guide and pairing/authority still protect guide configuration", async () => {
  const now = Date.now(); let metadataCalls = 0;
  const radio = createRadio({ databasePath: ":memory:", fetch: async input => {
    const url = String(input);
    if (url.includes("/api/radio-metadata")) {
      metadataCalls++;
      return Response.json({ ok: true, data: { title: "Live show", genre: "Soul", artist: "Host", album: "Series", streamUrl: "https://audio.example/live", resolvedUrl: "https://wrong.example/not-playback", sampledAt: now, expiresAt: now + 60_000 } });
    }
    return new Response('#EXTM3U\n#EXTINF:-1 tvg-id="immutable-id",Station\nhttps://audio.example/live\n');
  } });
  try {
    const catalog = await radio.avoid();
    const item = catalog.stations[0]!;
    const [a, b] = await Promise.all([radio.metadata.get(item.id, item.url), radio.programmes()]);
    assert.equal(a.programme?.genre, "Soul");
    assert.equal(radioNow(b[item.id], item.id)?.artist, "Host");
    assert.equal(metadataCalls, 1);
    assert.equal(radio.getPlayable(item.id).source, "https://audio.example/live");
    const settings = createRadioSettings(radio);
    const get = () => new Request("http://couch.local/api/radio/programmes");
    assert.equal((await settings.handle(get(), () => null)).status, 401);
    assert.equal((await settings.handle(get(), () => ({ device: null, authority: "controller", claimAvailable: false }))).status, 200);
    const post = () => new Request("http://couch.local/api/radio/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bad", url: "https://example.com/list", guideUrl: "file:///etc/passwd" }) });
    assert.equal((await settings.handle(post(), () => ({ device: null, authority: "controller", claimAvailable: false }))).status, 403);
    assert.equal((await settings.handle(post(), () => ({ device: null, authority: "host", claimAvailable: false }))).status, 400);
  } finally { radio.close(); }
});

test("blank guide overrides restore discovery while an omitted guide keeps the configured URL", async () => {
  const radio = createRadio({ databasePath: ":memory:", fetch: async () => new Response(m3u) });
  const settings = createRadioSettings(radio);
  const input = { name: "Community", url: "https://community.example/list.m3u" };
  const explicit = "https://override.example/schedule.xml";
  const post = async (body: object) => {
    const response = await settings.handle(new Request("http://couch.local/api/radio/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), () => ({ device: null, authority: "host", claimAvailable: false }));
    assert.equal(response.status, 201);
    return (await response.json() as { playlist: { id: string; guideUrl: string | null; discoveredGuideUrl: string | null } }).playlist;
  };
  try {
    const initial = await post({ ...input, guideUrl: explicit });
    const kept = await post(input);
    assert.equal(kept.id, initial.id);
    assert.equal(kept.guideUrl, explicit);
    for (const guideUrl of ["", " \t ", null]) {
      await post({ ...input, guideUrl: explicit });
      const cleared = await post({ ...input, guideUrl });
      assert.equal(cleared.id, initial.id);
      assert.equal(cleared.guideUrl, null);
      assert.equal(cleared.discoveredGuideUrl, "https://community.example/guide.xml");
      assert.equal((await post(input)).guideUrl, null);
    }
  } finally { radio.close(); }
});

test("browsing and playback preserve live shows inside broad guide slots, then fall back on expiry", async () => {
  const realNow = Date.now;
  const sampledAt = Date.parse("2026-10-23T18:00:00Z"), expiresAt = sampledAt + 60_000;
  let clock = sampledAt, metadataCalls = 0;
  Date.now = () => clock;
  const titles = ["سراب / Sarab – whybc", "Memory Archive w/ FDG (R)"];
  const slots = ["Rotation", "Programming 22.10.26 (2)"];
  const radio = createRadio({ databasePath: ":memory:", fetch: async input => {
    const url = new URL(String(input));
    if (url.pathname === "/api/radio-metadata") {
      metadataCalls++;
      const index = Number(url.searchParams.get("stationId")!.slice(-1));
      return Response.json({ ok: true, data: { title: titles[index], artworkUrl: `https://example.com/live-${index}.jpg`, stationDescription: "Live episode description", genre: "Experimental", artist: "Live host", streamUrl: `https://audio.example/${index}`, sampledAt, expiresAt } });
    }
    if (url.pathname.endsWith(".xml")) return new Response(`<tv>${slots.map((title, i) => `<programme channel="community-${i}" start="20261023030000 +0000" stop="20261024030000 +0000"><title>${title}</title><desc>Schedule description</desc><category>Talk</category><icon src="https://example.com/slot.jpg"/></programme>`).join("")}</tv>`);
    return new Response(`#EXTM3U x-tvg-url="guide.xml"\n${slots.map((_, i) => `#EXTINF:-1 tvg-id="community-${i}",Community ${i}\nhttps://audio.example/${i}\n`).join("")}`);
  } });
  try {
    const { stations } = await radio.avoid();
    const guides = await radio.programmes();
    for (const [index, station] of stations.entries()) {
      const listed = radioNow(guides[station.id], station.id)!;
      const playing = (await radio.metadata.get(station.id, station.url)).programme!;
      assert.deepEqual(playing, listed);
      assert.equal(playing.title, titles[index]);
      assert.equal(playing.artworkUrl, `https://example.com/live-${index}.jpg`);
      assert.equal(playing.description, "Live episode description");
      assert.equal(playing.genre, "Experimental");
      assert.equal(playing.start, undefined);
      assert.equal(playing.end, undefined);
      assert.equal(playing.categories, undefined);
    }
    assert.equal(metadataCalls, 2);
    clock = expiresAt;
    const station = stations[0]!;
    const fallback = (await radio.metadata.get(station.id, station.url)).programme!;
    assert.equal(fallback.title, slots[0]);
    assert.equal(fallback.artworkUrl, "https://example.com/slot.jpg");
    assert.deepEqual(fallback.categories, ["Talk"]);
    assert.equal(fallback.artist, undefined);
    assert.equal(fallback.start, Date.parse("2026-10-23T03:00:00Z"));
    assert.equal(fallback.end, Date.parse("2026-10-24T03:00:00Z"));
  } finally { radio.close(); Date.now = realNow; }
});


test("an existing installation adds guide columns without changing saved station identities", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "couch-radio-upgrade-"));
  const databasePath = join(scratch, "couch.sqlite");
  const saved = { id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", name: "Saved station", url: "https://audio.example/saved", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
  const db = new Database(databasePath);
  db.exec("CREATE TABLE radio_playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, updated_at INTEGER, error TEXT); CREATE TABLE radio_favorites (id TEXT PRIMARY KEY, station TEXT NOT NULL)");
  db.query("INSERT INTO radio_favorites VALUES (?, ?)").run(saved.id, JSON.stringify(saved));
  db.close();
  const radio = createRadio({ databasePath });
  try {
    assert.deepEqual(radio.favorites(), [saved]);
    assert.deepEqual(await radio.getStation(saved.id), saved);
    assert.equal(radio.getPlayable(saved.id).source, saved.url);
    assert.deepEqual(radio.playlists(), []);
  } finally { radio.close(); rmSync(scratch, { recursive: true, force: true }); }
});
