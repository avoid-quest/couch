import { expect, test } from "bun:test";
import { streamingCommunityBrowse } from "../src/server/streamingcommunity";
import { browseRaiPlay } from "../src/server/providers/raiplay";
import { providerMetadata } from "../src/server/provider-metadata";
import { parseCommand } from "../src/server/validation";

test("a season and its episodes retain separate series and season destinations", async () => {
  const origin = "https://streamingcommunityz.pictures";
  const series = `${origin}/it/titles/42-the-show`;
  const data = { component: "Titles/Title", props: {
    title: { id: 42, slug: "the-show", name: "The show", seasons: [{ number: 2 }] },
    loadedSeason: { number: 2, episodes: [{ id: 10, number: 1, name: "First episode" }] },
  } };
  const fetchPage = (async () => new Response(`<div data-page="${JSON.stringify(data).replaceAll('"', "&quot;")}"></div>`)) as typeof fetch;
  const page = await streamingCommunityBrowse({ url: `${series}/season-2` }, origin, undefined, fetchPage);
  expect(page.parent).toEqual({ title: "The show", url: series });
  expect(page.item?.collection).toEqual(page.parent);
  expect(providerMetadata(page.items[0]).collection).toEqual({ title: "Season 2", url: `${series}/season-2`, parent: page.parent });
});

test("RaiPlay season pagination retains programme and season destinations", async () => {
  const series = "https://www.raiplay.it/programmi/the-show";
  const season = `${series}/ContentSet-12345678-abcd.json`;
  const items = Array.from({ length: 30 }, (_, index) => ({
    name: `Episode ${index + 1}`, weblink: `/video/2026/09/episode-${index}.html`,
    program_name: "The show", program_url: "/programmi/the-show",
  }));
  const fetchPage = (async () => Response.json({ name: "Season 1", items })) as typeof fetch;
  const first = await browseRaiPlay({ url: season }, undefined, fetchPage);
  const second = await browseRaiPlay({ url: season, cursor: first.nextCursor }, undefined, fetchPage);
  expect(first.nextCursor).toBe("24");
  expect(second.items).toHaveLength(6);
  expect(second.parent).toEqual({ title: "The show", url: series });
  expect(second.items[0]?.collection).toEqual({ title: "Season 1", url: season, parent: second.parent, index: 24 });
});

test("a direct StreamingCommunity watch link opens the episode with its hierarchy", async () => {
  const origin = "https://streamingcommunityz.pictures";
  const title = { id: 42, slug: "the-show", name: "The show", seasons: [{ number: 2 }] };
  const fetchPage = (async (url: string | URL | Request) => {
    const watch = String(url).includes("/watch/");
    const data = { component: watch ? "Titles/Watch" : "Titles/Title", props: { title,
      ...(watch ? { episode: { id: 10, season: { number: 2 } } } : { loadedSeason: { number: 2, episodes: [{ id: 10, number: 1, name: "First episode" }] } }),
    } };
    return new Response(`<div data-page="${JSON.stringify(data).replaceAll('"', "&quot;")}"></div>`);
  }) as typeof fetch;
  const page = await streamingCommunityBrowse({ url: `${origin}/it/watch/42?e=10` }, origin, undefined, fetchPage);
  expect(page.item?.title).toBe("S02E01 · First episode");
  expect(page.items).toHaveLength(1);
  expect(page.item?.collection?.parent?.title).toBe("The show");
});

test("a directly opened RaiPlay episode links to its programme", async () => {
  const video = "https://www.raiplay.it/video/2026/09/episode.html";
  for (const metadata of [
    { program_name: "The show", program_url: "/programmi/the-show" },
    { program_info: { name: "The show", weblink: "/programmi/the-show" } },
  ]) {
    const fetchPage = (async () => Response.json({ name: "Episode", video: {}, ...metadata })) as typeof fetch;
    const page = await browseRaiPlay({ url: video }, undefined, fetchPage);
    expect(page.item?.collection).toEqual({ title: "The show", url: "https://www.raiplay.it/programmi/the-show" });
  }
});

test("playback accepts only bounded parent links from the same provider", () => {
  const collection = { title: "Season 1", url: "https://www.raiplay.it/programmi/the-show/ContentSet-1234.json", parent: { title: "The show", url: "https://www.raiplay.it/programmi/the-show", ignored: true } };
  const action = { type: "enqueueProvider", provider: "raiplay", shape: "atom", url: "https://www.raiplay.it/video/2026/09/episode.html", collection };
  const command = (value: unknown) => JSON.stringify({ type: "command", requestId: "test", action: value });
  expect(parseCommand(command(action)).action).toMatchObject({ collection: { ...collection, parent: { title: "The show", url: collection.parent.url } } });
  expect("ignored" in (parseCommand(command(action)).action as typeof action).collection.parent).toBe(false);
  expect(() => parseCommand(command({ ...action, collection: { ...collection, parent: { title: "Wrong provider", url: "https://www.youtube.com/@NASA" } } }))).toThrow();
  expect(() => parseCommand(command({ ...action, collection: { ...collection, parent: { ...collection.parent, title: "x".repeat(301) } } }))).toThrow();
});

test("a StreamingCommunity watch link without an episode query opens the site's selected episode", async () => {
  const origin = "https://streamingcommunityz.pictures";
  const title = { id: 42, slug: "the-show", name: "The show", seasons: [{ number: 2 }] };
  const calls: string[] = [];
  const fetchPage = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const watch = String(input).includes("/watch/");
    const data = { component: watch ? "Titles/Watch" : "Titles/Title", props: { title,
      ...(watch ? { episode: { id: 10, season: { number: 2 } } } : { loadedSeason: { number: 2, episodes: [{ id: 10, number: 1, name: "First episode" }] } }),
    } };
    return new Response(`<div data-page="${JSON.stringify(data).replaceAll('"', "&quot;")}"></div>`);
  }) as typeof fetch;
  const page = await streamingCommunityBrowse({ url: `${origin}/it/watch/42` }, origin, undefined, fetchPage);
  expect(page.item?.url).toBe(`${origin}/it/watch/42?e=10`);
  expect(page.item?.title).toBe("S02E01 · First episode");
  expect(page.item?.collection).toEqual({ title: "Season 2", url: `${origin}/it/titles/42-the-show/season-2`, parent: { title: "The show", url: `${origin}/it/titles/42-the-show` } });
  expect(calls).toEqual([`${origin}/it/watch/42`, `${origin}/it/titles/42-the-show/season-2`]);
});


test("StreamingCommunity films still open without an episode and explicit episode mismatches fail", async () => {
  const origin = "https://streamingcommunityz.pictures";
  const fetchPage = (async (input: string | URL | Request) => {
    const data = { component: String(input).includes("/watch/") ? "Titles/Watch" : "Titles/Title", props: {
      title: { id: 42, slug: "the-film", name: "The film", seasons: [] }, episode: null,
    } };
    return new Response(`<div data-page="${JSON.stringify(data).replaceAll('"', "&quot;")}"></div>`);
  }) as typeof fetch;
  expect((await streamingCommunityBrowse({ url: `${origin}/it/watch/42` }, origin, undefined, fetchPage)).item).toMatchObject({ title: "The film", kind: "media" });
  await expect(streamingCommunityBrowse({ url: `${origin}/it/watch/42?e=10` }, origin, undefined, fetchPage)).rejects.toThrow();
});
