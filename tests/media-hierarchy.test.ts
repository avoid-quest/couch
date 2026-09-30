import { expect, test } from "bun:test";
import { streamingCommunityBrowse } from "../src/server/streamingcommunity";
import { browseRaiPlay } from "../src/server/providers/raiplay";
import { providerMetadata } from "../src/server/provider-metadata";

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
  expect(second.items[0]?.collection).toEqual({ title: "Season 1", url: season, parent: second.parent });
});

test("a directly opened RaiPlay episode links to its programme", async () => {
  const video = "https://www.raiplay.it/video/2026/09/episode.html";
  const fetchPage = (async () => Response.json({ name: "Episode", video: {}, program_name: "The show", program_url: "/programmi/the-show" })) as typeof fetch;
  const page = await browseRaiPlay({ url: video }, undefined, fetchPage);
  expect(page.item?.collection).toEqual({ title: "The show", url: "https://www.raiplay.it/programmi/the-show" });
});
