import { expect, test } from "bun:test";
import { createProviderMetadata, providerMetadata, resolveProviderMetadata } from "./provider-metadata";
import { openStore } from "./store";
import { playbackMediaId } from "./progress";
import type { ProviderItem } from "../shared/providers";

const origin = "https://streamingcommunityz.photos";
const url = `${origin}/it/watch/1955?e=17207`;
const entry = { id: "episode", title: "S11E07 · Puntata 7", source: `web:${url}`, thumbnail: `${origin}/show.webp` };
const mediaId = playbackMediaId(entry)!;
const progress = { mediaId, title: entry.title, libraryItemId: null, position: 1800, duration: 4209, watched: false, lastPlayedAt: 100 };
const details = { subtitle: "MasterChef Italia", description: "La prova della settimana.", thumbnail: `${origin}/episode.webp` };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const html = (component: string, props: unknown) => new Response(`<div data-page="${JSON.stringify({ component, props }).replaceAll('"', '&quot;')}"></div>`);

test("legacy episode refresh resolves its canonical season and exposes only that episode's catalogue metadata", async () => {
  const requests: string[] = [];
  const fetchPage = (async (input: URL | RequestInfo) => {
    requests.push(String(input));
    const title = { id: 1955, slug: "masterchef-italia", name: "MasterChef Italia", seasons: [{ number: 11 }], images: [] };
    if (String(input) === url) return html("Titles/Watch", { title, episode: { id: 17207, season: { number: 11 } }, auth: { token: "private" }, embedUrl: "private-transport" });
    expect(String(input)).toBe(`${origin}/it/titles/1955-masterchef-italia/season-11`);
    return html("Titles/Title", { title, loadedSeason: { number: 11, episodes: [{ id: 17207, number: 7, duration: 50, plot: details.description, images: [{ type: "cover", filename: "episode.webp" }] }] } });
  }) as typeof fetch;
  const metadata = await resolveProviderMetadata(url, new AbortController().signal, fetchPage);
  expect(metadata.subtitle).toBe(details.subtitle);
  expect(metadata.description).toBe(details.description);
  expect(Object.keys(metadata).sort()).toEqual(["description", "subtitle", "thumbnail"]);
  expect(JSON.stringify(metadata)).not.toContain("private");
  expect(requests).toHaveLength(2);
});

test("film metadata resolves from both canonical title and saved watch URLs", async () => {
  const titleUrl = `${origin}/it/titles/42-film`;
  const title = { id: 42, slug: "film", name: "Film", plot: "A film synopsis.", seasons: [] };
  const fetchPage = (async (input: URL | RequestInfo) => String(input).includes("/watch/") ? html("Titles/Watch", { title }) : html("Titles/Title", { title })) as typeof fetch;
  for (const source of [titleUrl, `${origin}/it/watch/42`]) expect(await resolveProviderMetadata(source, new AbortController().signal, fetchPage)).toEqual({ subtitle: "Film", description: title.plot });
});

test("history refresh is nonblocking, deduplicated and preserves observed facts through later stale checkpoints", async () => {
  const store = openStore(":memory:");
  store.saveProgress("household", progress, entry);
  let complete!: (value: typeof details) => void;
  let calls = 0, changes = 0;
  const metadata = createProviderMetadata({ store, cachedItem: () => undefined, resolve: () => { calls++; return new Promise(resolve => { complete = resolve; }); }, onChange: () => changes++ });
  try {
    metadata.refreshHistory([progress]); metadata.refreshHistory([progress]);
    expect(calls).toBe(1);
    expect(store.historySource(mediaId)?.description).toBeUndefined();
    complete(details); await flush();
    expect(changes).toBe(1);
    expect(store.sharedProgress(mediaId)).toEqual(progress);
    expect(store.historySource(mediaId)).toMatchObject(details);
    store.saveProgress("household", { ...progress, position: 1900 }, { ...entry, subtitle: "Old show context" });
    expect(store.historySource(mediaId)).toMatchObject(details);
    expect(store.sharedProgress(mediaId)?.position).toBe(1900);
    metadata.refreshHistory([progress]); await flush(); expect(calls).toBe(1);
  } finally { metadata.close(); store.close(); }
});

test("refresh never restores removed history, and an incoming trusted episode replaces the old generic poster", async () => {
  const store = openStore(":memory:");
  try {
    store.saveProgress("household", progress, entry);
    store.enrichHistorySource(mediaId, entry.source, details);
    store.saveProgress("household", progress, { ...entry, ...details });
    expect(store.historySource(mediaId)).toMatchObject(details);
    store.takeSharedProgress(mediaId);
    expect(store.enrichHistorySource(mediaId, entry.source, { description: "Late" })).toBe(false);
    expect(store.sharedHistory()).toEqual([]);
    expect(store.historySource(mediaId)?.description).toBe(details.description);
  } finally { store.close(); }
});

test("refresh skips zero-position and watched rows, bounds concurrent requests, and stops writes after close", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const finishes: Array<() => void> = [];
  const metadata = createProviderMetadata({ store, cachedItem: () => undefined, resolve: () => { calls++; return new Promise(resolve => finishes.push(() => resolve(details))); }, onChange: () => { throw new Error("Must not publish after close"); } });
  try {
    const rows = Array.from({ length: 8 }, (_, index) => {
      const source = { ...entry, source: `web:${origin}/it/watch/${index + 1}?e=1` };
      const row = { ...progress, mediaId: playbackMediaId(source)!, position: index < 4 ? 0 : 10 };
      store.saveProgress("household", row, source); return row;
    });
    metadata.refreshHistory(rows); expect(calls).toBe(2);
    metadata.close(); finishes.forEach(finish => finish()); await flush();
    expect(store.historySource(rows[4]!.mediaId)?.description).toBeUndefined();
  } finally { metadata.close(); store.close(); }
});

test("already fetched provider rows supply bounded public metadata without a network lookup", async () => {
  const store = openStore(":memory:");
  const item: ProviderItem = { id: "track", provider: "bandcamp", kind: "media", title: "Track", url: "https://artist.bandcamp.com/track/one", subtitle: "Artist", description: "x".repeat(3000), thumbnail: "https://user:secret@example.com/a" };
  const metadata = createProviderMetadata({ store, cachedItem: () => item, resolve: () => { throw new Error("Unnecessary network lookup"); }, onChange: () => {} });
  try { expect(await metadata.load(item.url)).toEqual({ subtitle: "Artist", description: "x".repeat(2000) }); expect(providerMetadata(item).thumbnail).toBeUndefined(); }
  finally { metadata.close(); store.close(); }
});

test("cached early history rows do not starve later unfinished episodes", async () => {
  const store = openStore(":memory:");
  let calls = 0;
  const metadata = createProviderMetadata({ store, cachedItem: () => undefined, resolve: async () => { calls++; return details; }, onChange: () => {} });
  try {
    const rows = Array.from({ length: 6 }, (_, index) => {
      const source = { ...entry, source: `web:${origin}/it/watch/${index + 1}?e=1` };
      const row = { ...progress, mediaId: playbackMediaId(source)! };
      store.saveProgress("household", row, source); return row;
    });
    for (let batch = 0; batch < 3; batch++) { metadata.refreshHistory(rows); await flush(); }
    expect(calls).toBe(6);
    expect(rows.every(row => store.historySource(row.mediaId)?.description === details.description)).toBe(true);
  } finally { metadata.close(); store.close(); }
});
