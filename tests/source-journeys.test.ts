import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { mergeSearchHits } from "../src/client/search";
import type { SearchHit } from "../src/client/sections/find/SearchOnlineResults";
import { providerPageQuery } from "../src/client/api/providers";
import type { ProviderPage } from "../src/shared/providers";
import { nextEpisode, progressFor, seriesResumeFor } from "../src/client/sections/find/provider-progress";
import type { HistoryItem } from "../src/shared/viewing";

const hit = (source: string, title: string): SearchHit => ({ id: `${source}:${title}`, source, title, meta: "", kind: "Video", primary: { label: "Open", run() {} }, actions: [] });

test("exact title precedes unrelated hits, while the rest retain provider diversity and order", () => {
  const hits = { YouTube: [hit("YouTube", "Trailer"), hit("YouTube", "Second video")], Twitch: [hit("Twitch", "Streamer")], RaiPlay: [hit("RaiPlay", "Unrelated")], StreamingCommunity: [hit("StreamingCommunity", "Il problema finale"), hit("StreamingCommunity", "Other series")] };
  expect(mergeSearchHits(Object.keys(hits), hits, "  IL  PROBLEMA FINALE ").map(hit => hit.title)).toEqual(["Il problema finale", "Trailer", "Streamer", "Unrelated", "Second video", "Other series"]);
  expect(mergeSearchHits(Object.keys(hits), hits, "no exact match").map(hit => hit.title)).toEqual(["Trailer", "Streamer", "Unrelated", "Il problema finale", "Second video", "Other series"]);
  expect(mergeSearchHits(["A", "B"], { A: [hit("A", "Café")], B: [hit("B", "Cafe\u0301")] }, "CAFÉ").map(hit => hit.source)).toEqual(["A", "B"]);
});

const series = "https://streamingcommunityz.pictures/it/titles/42-the-show";
const season = `${series}/season-1`;
const item = { id: "show", provider: "streamingcommunity" as const, kind: "collection" as const, title: "The show", url: series };
const episodes: ProviderPage = { title: "Season 1", items: [{ id: "episode", provider: "streamingcommunity", kind: "media", title: "S01E01", url: "https://streamingcommunityz.pictures/it/watch/42?e=10", collection: { title: "Season 1", url: season, parent: { title: "The show", url: series } } }] };
const requests: string[] = [];
const request = spyOn(globalThis, "fetch");
afterEach(() => { request.mockReset(); requests.length = 0; });
afterAll(() => request.mockRestore());

function fixture(seasons: number, failSeason = false) {
  request.mockImplementation((async input => {
    const url = new URL(String(input)).searchParams.get("url")!;
    requests.push(url);
    if (url === season) return failSeason ? Response.json({ error: "Season temporarily unavailable" }, { status: 502 }) : Response.json(episodes);
    return Response.json({ item, title: "The show", description: "Known synopsis", items: Array.from({ length: seasons }, (_, index) => ({ ...item, id: `season-${index + 1}`, title: `Season ${index + 1}`, url: `${series}/season-${index + 1}` })) });
  }) as typeof fetch);
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

test("opened sole season displays episodes under the original series without losing hierarchy", async () => {
  const client = fixture(1);
  try {
    const page = await client.fetchQuery(providerPageQuery({ origin: "http://couch.local", token: "test" }, "streamingcommunity", { url: series }));
    expect(page.title).toBe("The show");
    expect(page.description).toBe("Known synopsis");
    expect(page.item).toEqual(item);
    expect(page.items).toEqual(episodes.items);
    expect(requests).toEqual([series, season]);
  } finally { client.clear(); }
});

test("domain healing, canonical SC title/watch links and changed slugs keep exact progress identity", () => {
  const film = { ...item, kind: "media" as const };
  const progress: HistoryItem = { mediaId: "original-opaque-id", title: "Same title is not identity", url: "https://streamingcommunityz.rip/en/watch/42", position: 183, duration: 8160, watched: false, lastPlayedAt: 1, playable: true };
  expect(progressFor(film, [progress])).toBe(progress);
  expect(progressFor({ ...film, url: "https://streamingcommunityz.rip/it/titles/42-renamed" }, [progress])).toBe(progress);
  expect(progressFor({ ...film, url: "https://streamingcommunityz.rip/it/watch/42?e=10" }, [progress])).toBeUndefined();
  expect(progressFor(film, [{ ...progress, url: "https://streamingcommunityz.rip/it/watch/43", title: film.title }])).toBeUndefined();
  expect(progressFor(film, [{ ...progress, url: undefined }])).toBeUndefined();
  expect(progressFor({ ...film, live: true }, [progress])).toBeUndefined();
});

test("series starts with its latest unfinished episode, otherwise the first unwatched one", () => {
  const first = episodes.items[0]!;
  const second = { ...first, id: "second", url: "https://streamingcommunityz.rip/it/watch/42?e=11" };
  const history: HistoryItem[] = [{ mediaId: "first", title: first.title, url: first.url, position: 0, duration: 1000, watched: true, lastPlayedAt: 1, playable: true }, { mediaId: "second", title: second.title, url: second.url, position: 200, duration: 1000, watched: false, lastPlayedAt: 2, playable: true }];
  expect(nextEpisode([first, second], history)).toBe(second);
  expect(nextEpisode([first, second], history.slice(0, 1))).toBe(second);
  expect(nextEpisode([first, second], [])).toBe(first);
  expect(nextEpisode([first, second], history.map(item => ({ ...item, watched: true })))).toBe(first);
});

test("multi-season series resumes only its known unfinished episode across healed domains and legacy hierarchy", () => {
  const progress: HistoryItem = { mediaId: "saved-episode", title: "S02E01", url: "https://streamingcommunityz.pictures/it/watch/42?e=10", position: 90, duration: 2000, watched: false, lastPlayedAt: 2, playable: true,
    collection: { title: "Season 2", url: `${series}/season-2`, parent: { title: item.title, url: series } } };
  const healed = { ...item, url: "https://streamingcommunityz.rip/en/titles/42-new-slug" };
  expect(seriesResumeFor(healed, [progress])).toBe(progress);
  const legacy = { ...progress, collection: { title: "The show - Season 2", url: `${series}/season-2` } };
  expect(seriesResumeFor(healed, [legacy])).toBe(legacy);
  for (const invalid of [
    { ...progress, url: "https://streamingcommunityz.rip/it/watch/43?e=10" },
    { ...progress, url: "https://streamingcommunityz.rip/it/watch/42" },
    { ...progress, url: `${progress.url}&token=private` },
    { ...progress, collection: undefined },
    { ...progress, watched: true },
    { ...progress, playable: false },
    { ...progress, position: 0 },
  ]) expect(seriesResumeFor(healed, [invalid])).toBeUndefined();
  expect(seriesResumeFor({ ...item, url: "https://streamingcommunityz.rip/it/titles/43-other" }, [progress])).toBeUndefined();
});

test("cancelling the opened series also cancels its sole-season request", async () => {
  const client = fixture(1);
  const query = providerPageQuery({ origin: "http://couch.local", token: "test" }, "streamingcommunity", { url: series });
  let cancelled = false;
  const secondRequest = Promise.withResolvers<void>();
  request.mockImplementation((async (input, init) => {
    const url = new URL(String(input)).searchParams.get("url");
    if (url !== season) return Response.json({ item, items: [{ ...item, url: season }] });
    secondRequest.resolve();
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { cancelled = true; reject(init.signal!.reason); }, { once: true }));
  }) as typeof fetch);
  const pending = client.fetchQuery(query).catch(() => {});
  await secondRequest.promise;
  await client.cancelQueries({ queryKey: query.queryKey });
  await pending;
  expect(cancelled).toBe(true);
  expect(client.getQueryData(query.queryKey)).toBeUndefined();
  client.clear();
});

test("multiple seasons and failed sole-season loads retain accessible season navigation", async () => {
  for (const [seasons, fail] of [[2, false], [1, true]] as const) {
    const client = fixture(seasons, fail);
    try {
      const page = await client.fetchQuery(providerPageQuery({ origin: "http://couch.local", token: "test" }, "streamingcommunity", { url: series }));
      expect(page.items).toHaveLength(seasons);
      expect(page.items[0]?.kind).toBe("collection");
      if (fail) expect(page.warning).toContain("Season temporarily unavailable");
      else expect(requests).toEqual([series]);
    } finally { client.clear(); requests.length = 0; }
  }
});
