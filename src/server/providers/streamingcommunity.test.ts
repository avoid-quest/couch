import { describe, expect, test } from "bun:test";
import type { BrowseRequest } from "../../shared/providers";
import { ProviderError } from "./http";
import { createProviders } from "./index";
import { parseInertiaPage, streamingCommunityBrowse, streamingCommunityList, streamingCommunityPreview } from "../streamingcommunity";

const origin = "https://streamingcommunityz.academy";
const movie = { id: 11264, slug: "testimone-daccusa" };
const series = { id: 9125, slug: "johnny-test" };
const fixture = (name: string) => Bun.file(new URL(`./streamingcommunity.fixtures/${name}`, import.meta.url)).text();
const page = async (name: string) => new Response(await fixture(name));
const respond = (body: string | Response) => (async () => typeof body === "string" ? new Response(body) : body) as unknown as typeof fetch;
const fetcher = (stub: (url: URL) => Promise<Response> | Response) => (async (input: string | URL | Request) => stub(new URL(String(input)))) as unknown as typeof fetch;
const browse = (request: BrowseRequest, cursor?: string) => streamingCommunityBrowse({ ...request, ...(cursor ? { cursor } : {}) }, origin, undefined, fetcher(async url => {
  const target = new URL(String(url));
  if (target.pathname.endsWith("/archive")) return page("archive.html");
  if (target.pathname.endsWith("/search")) return page("search.html");
  if (/\/season-\d+$/.test(target.pathname)) return page("season.html");
  if (target.pathname.endsWith(`/${series.id}-${series.slug}`)) return page("title-series.html");
  if (target.pathname.endsWith(`/${movie.id}-${movie.slug}`)) return page("title-movie.html");
  throw new Error(`unexpected fetch ${target.href}`);
}));

function pageFixture(titles: number, totalCount?: number) {
  const rows = Array.from({ length: titles }, (_, index) => ({ id: index + 1, slug: `title-${index + 1}`, name: `Title ${index + 1}`, type: index % 2 ? "tv" : "movie" }));
  const page = JSON.stringify({ component: "Titles/Browse", props: { titles: rows, ...(totalCount === undefined ? {} : { totalCount }) } }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><div data-page="${page}"></div>`;
}
const fail = async (work: Promise<unknown>) => {
  try { await work; throw new Error("expected a rejection"); }
  catch (error) { if (error instanceof ProviderError) return error; throw error; }
};

test("the data-page parser decodes captured pages and fails clearly when the layout moves", async () => {
  const page = parseInertiaPage(await fixture("archive.html"));
  expect(page.component).toBe("Titles/Browse");
  expect(Array.isArray(page.props.titles)).toBe(true);
  expect((await fail(new Promise(resolve => resolve(parseInertiaPage("<html><body>blocked</body></html>"))))).message).toContain("StreamingCommunity changed its website.");
});

test("archive rows normalize into provider items with posters, plots and stable links", async () => {
  const result = await browse({});
  expect(result.title).toBe("Catalogue");
  expect(result.items).toHaveLength(3);
  const [first] = result.items;
  expect(first).toMatchObject({ provider: "streamingcommunity", kind: "collection", title: "Golden Axe", url: `${origin}/it/titles/65807-golden-axe`, subtitle: "2026 · Series" });
  expect(first!.thumbnail).toMatch(/^https:\/\/cdn\.streamingcommunityz\.academy\/images\/[\w-]+\.webp$/);
  expect(first!.description!.length).toBeGreaterThan(20);
  expect(result.nextCursor).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("ziggy");
});

test("search rows normalize movies with plots, and captured totals bound pagination", async () => {
  const result = await browse({ query: "test" });
  expect(result.items[0]).toMatchObject({ kind: "media", title: "Testimone d'accusa", url: `${origin}/it/titles/${movie.id}-${movie.slug}`, subtitle: "1957 · Film" });
  expect(result.items[0]!.description).toContain("assassinato");
  expect(result.nextCursor).toBeUndefined();
});

test("search sends q and paginates at sixty results", async () => {
  const requests: URL[] = [];
  const first = await streamingCommunityBrowse({ query: "test" }, origin, undefined, fetcher(async url => {
    requests.push(url);
    return new Response(pageFixture(60, 61));
  }));
  expect(requests[0]!.pathname).toBe("/it/search");
  expect(requests[0]!.searchParams.get("q")).toBe("test");
  expect(first.items).toHaveLength(60);
  expect(first.nextCursor).toBe("2");
  const second = await streamingCommunityBrowse({ query: "test", cursor: "2" }, origin, undefined, fetcher(async url => {
    requests.push(url);
    return new Response(pageFixture(1, 61));
  }));
  expect(requests[1]!.searchParams.get("page")).toBe("2");
  expect(second.nextCursor).toBeUndefined();
  expect((await fail(streamingCommunityBrowse({ query: "test", cursor: "99999" }, origin, undefined, respond(pageFixture(1))))).status).toBe(400);
});

test("a series opens into season collections and a season into play-ready episodes", async () => {
  const seasons = await browse({ url: `${origin}/it/titles/${series.id}-${series.slug}` });
  expect(seasons.title).toBe("Johnny Test");
  expect(seasons.items.map(item => [item.title, item.url])).toEqual([
    ["Season 1", `${origin}/it/titles/${series.id}-${series.slug}/season-1`],
    ["Season 2", `${origin}/it/titles/${series.id}-${series.slug}/season-2`],
    ["Season 3", `${origin}/it/titles/${series.id}-${series.slug}/season-3`],
    ["Season 4", `${origin}/it/titles/${series.id}-${series.slug}/season-4`],
  ]);
  const seasonUrl = `${origin}/it/titles/${series.id}-${series.slug}/season-1`;
  const [episodes, again] = await Promise.all([browse({ url: seasonUrl }), browse({ url: seasonUrl })]);
  expect(episodes.title).toBe("Johnny Test - Season 1");
  expect(episodes.items[0]).toMatchObject({ kind: "media", url: `${origin}/it/watch/${series.id}?e=69717`, duration: 21 * 60, title: "S01E01 · Johnny al centro della Terra / Johnny X" });
  expect(episodes.items[0]!.id).toBe(again.items[0]!.id);
});

test("a movie title page exposes the film with runtime and plot", async () => {
  const result = await browse({ url: `${origin}/it/titles/${movie.id}-${movie.slug}` });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ kind: "media", title: "Testimone d'accusa", url: `${origin}/it/titles/${movie.id}-${movie.slug}`, duration: 116 * 60 });
});

test("the preview endpoint refreshes details without loading a full title page", async () => {
  const preview = await streamingCommunityPreview(movie.id, origin, undefined, fetcher(async url => {
    expect(url.pathname).toBe(`/api/titles/preview/${movie.id}`);
    return page("preview-movie.json");
  }));
  expect(preview).toMatchObject({ id: movie.id, kind: "movie", year: "1957", runtime: 116, genres: ["Drama", "Crime", "Mystery"] });
  expect(preview.thumbnail).toMatch(/^https:\/\/cdn\.streamingcommunityz\.academy\/images\//);
  const seriesPreview = await streamingCommunityPreview(series.id, origin, undefined, respond(await fixture("preview-series.json")));
  expect(seriesPreview.kind).toBe("series");
  expect(seriesPreview.seasonsCount).toBe(6);
});

describe("upstream failures map to actionable source errors", () => {
  test("a redirecting origin reports the administrator fix", async () => {
    const rotated = await fail(streamingCommunityPreview(1, origin, undefined, fetcher(async () => { throw new TypeError("redirect"); })));
    expect(rotated.message).toContain("update its origin in Settings > Sources");
  });
  test("missing pages and unknown layouts keep the 404 and layout errors", async () => {
    const missing = await fail(streamingCommunityBrowse({}, origin, undefined, respond(new Response("nope", { status: 404 }))));
    expect([missing.message, missing.status]).toEqual(["StreamingCommunity does not have this page.", 404]);
    const moved = await fail(streamingCommunityBrowse({}, origin, undefined, respond("<html></html>")));
    expect(moved.message).toContain("StreamingCommunity changed its website.");
    expect(moved.status).toBe(502);
  });
  test("an invalid configured origin and foreign links are rejected", async () => {
    expect((await fail(streamingCommunityBrowse({}, "https://example.com"))).message).toBe("StreamingCommunity needs a valid website origin in Settings > Sources.");
    expect((await fail(streamingCommunityBrowse({ url: "https://example.com/it/archive" }))).message).toBe("Use a StreamingCommunity catalogue or title link.");
  });
});

test("saved lists expand movies, seasons and whole series without retargeting origins", async () => {
  const film = await streamingCommunityList(`${origin}/it/titles/${movie.id}-${movie.slug}`, undefined, respond(await fixture("title-movie.html")));
  expect(film.title).toBe("Testimone d'accusa");
  expect(film.items).toHaveLength(1);
  const season = await streamingCommunityList(`${origin}/it/titles/${series.id}-${series.slug}/season-2`, undefined, respond(await fixture("season.html")));
  expect(season.items).toHaveLength(2);
  expect(season.items[0]!.url).toBe(`${origin}/it/watch/${series.id}?e=69717`);
  const calls: string[] = [];
  const whole = await streamingCommunityList(`${origin}/it/titles/${series.id}-${series.slug}`, undefined, fetcher(async url => {
    calls.push(url.pathname);
    return /\/season-\d+$/.test(url.pathname) ? page("season.html") : page("title-series.html");
  }));
  expect(whole.title).toBe("Johnny Test");
  expect(whole.items).toHaveLength(8);
  expect(calls.filter(path => /season-/.test(path))).toHaveLength(4);
  const rotated = await fail(streamingCommunityList(`https://streamingcommunityz.taxi/it/titles/${movie.id}-${movie.slug}`, undefined, fetcher(async () => { throw new TypeError("redirect"); })));
  expect(rotated.message).toContain("update its origin in Settings > Sources");
  const foreign = await fail(streamingCommunityList("https://example.com/it/titles/1-x"));
  expect([foreign.message, foreign.status]).toEqual(["Choose a StreamingCommunity film, series or season to save.", 400]);
});

test("the providers route exposes previews and accepts streamingcommunity favorites", async () => {
  const catalog = createProviders({ databasePath: ":memory:", streamingCommunityOrigin: () => origin });
  const original = globalThis.fetch;
  globalThis.fetch = respond(await fixture("preview-movie.json"));
  try {
    const preview = await catalog.handle(new Request(`http://localhost/api/providers/streamingcommunity/titles/${movie.id}`));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ id: movie.id, kind: "movie" });
    expect((await catalog.handle(new Request(`http://localhost/api/providers/streamingcommunity/titles/${movie.id}`, { method: "POST" }))).status).toBe(405);
    expect((await catalog.handle(new Request("http://localhost/api/providers/streamingcommunity/titles/nope"))).status).toBe(404);
    const favorite = await catalog.handle(new Request("http://localhost/api/providers/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { provider: "streamingcommunity", kind: "collection", title: "Johnny Test", url: `${origin}/it/titles/${series.id}-${series.slug}` } }) }));
    expect(favorite.status).toBe(200);
    expect((await favorite.json()).item.id).toMatch(/^streamingcommunity-/);
  } finally {
    globalThis.fetch = original;
    catalog.close();
  }
});
