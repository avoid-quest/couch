import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalog, type Viewing } from "../src/server/catalog";
import { openStore } from "../src/server/store";
import type { QueueEntry } from "../src/shared/protocol";

const mediaId = `media:${"a".repeat(64)}`;
async function history(source: string, kind?: QueueEntry["kind"], live = false) {
  const store = openStore(":memory:");
  store.saveProgress("household", { mediaId, title: "Known film", position: 183, duration: 1000, watched: false, lastPlayedAt: 1 },
    { id: "entry", source, title: "Known film", kind, live, thumbnail: "https://art.example/poster.png" });
  const catalog = createCatalog({ radio: {} as Parameters<typeof createCatalog>[0]["radio"], viewing: { store, session: { state: { activeProfile: { id: "household", name: "Household" }, queue: [], currentEntryId: null } } as Viewing } });
  try {
    const response = await catalog.handle(new Request("http://couch.local/api/progress/history"), false);
    assert.equal(response.status, 200);
    return (await response.json()).items[0];
  } finally { store.close(); }
}

for (const url of [
  "https://streamingcommunityz.pictures/it/titles/42-the-show",
  "https://streamingcommunityz.rip/it/watch/42?e=10",
  "https://www.youtube.com/watch?v=abcdefghijk",
  "https://www.raiplay.it/video/2026/09/episode.html",
  "https://artist.bandcamp.com/track/song",
  "https://soundcloud.com/arsiderprod/track",
  "https://www.twitch.tv/videos/12345",
  "https://ww8.123moviesfree.net/movie/example-123/",
  "https://animesaturn.ro/example-episode-2/",
  "https://www.animeunity.so/anime/12-one-piece/5987",
  "https://ww8.123moviesfree.net/season/example-season-1-123/?episode=2",
]) test(`history exposes only the public provider page: ${url}`, async () => {
  const item = await history(`web:${url}`);
  assert.equal(item.url, url);
  assert.equal(item.position, 183);
  assert.equal(item.mediaId, mediaId);
  assert.equal(item.source, undefined);
});

for (const source of [
  "https://media.example/movie.mp4?signature=PRIVATE",
  "web:https://media.example/movie.mp4?signature=PRIVATE",
  "web:https://cdn.streamingcommunityz.rip/movie.m3u8?token=PRIVATE",
  "web:https://streamingcommunityz.rip/it/watch/42?e=10&signature=PRIVATE",
  "web:https://www.youtube.com/watch?v=abcdefghijk&token=PRIVATE",
  "web:https://www.raiplay.it/video/2026/09/movie.html?token=PRIVATE",
  "web:https://artist.bandcamp.com/track/song?token=PRIVATE",
  "web:https://soundcloud.com/arsiderprod/track?secret_token=PRIVATE",
  "web:https://www.twitch.tv/videos/12345?token=PRIVATE",
  "web:https://ww8.123moviesfree.net/season/example-season-1-123/",
  "web:https://ww8.123moviesfree.net/season/example-season-1-123/?episode=2&token=PRIVATE",
  "web:https://ww8.123moviesfree.net/movie/example-123/?token=PRIVATE",
  "web:https://ww8.123moviesfree.net/hls/PRIVATE/master.m3u8",
  "web:https://animesaturn.ro/anime/example/",
  "web:https://animesaturn.ro/example-episode-2/?token=PRIVATE",
  "web:https://animesaturn.ro/wp-content/themes/animestream-child/player/?url=PRIVATE",
  "web:https://www.animeunity.so/anime/12-one-piece",
  "web:https://www.animeunity.so/anime/12-one-piece/5987?token=PRIVATE",
  "web:https://vixcloud.co/playlist/5987?token=PRIVATE",
  "web:https://user:password@www.youtube.com/watch?v=abcdefghijk",
  "web:https://www.youtube.com:444/watch?v=abcdefghijk",
  "web:https://www.youtube.com/watch?v=abcdefghijk#PRIVATE",
  "web:https://www.youtube.com/@some-channel",
  "web:https://example.com/supported-looking.html",
  "radio:station", "iptv:channel", "local-file",
]) test(`history does not expose private or unsupported source ${source.split('?')[0]}`, async () => {
  const item = await history(source);
  assert.equal(item.url, undefined);
  assert.equal(item.source, undefined);
  assert.ok(!JSON.stringify(item).includes("PRIVATE"));
});

test("a direct source is not exposed even when it resembles a provider page", async () => {
  assert.equal((await history("https://www.youtube.com/watch?v=abcdefghijk")).url, undefined);
});

test("known public URL variations expose canonical provider identity", async () => {
  assert.equal((await history("web:https://youtu.be/abcdefghijk")).url, "https://www.youtube.com/watch?v=abcdefghijk");
  assert.equal((await history("web:https://raiplay.it/video/2026/09/episode.json")).url, "https://www.raiplay.it/video/2026/09/episode.html");
});

test("live and radio history cannot expose a finite provider identity", async () => {
  const source = "web:https://www.youtube.com/watch?v=abcdefghijk";
  assert.equal((await history(source, undefined, true)).url, undefined);
  assert.equal((await history(source, "radio")).url, undefined);
});
