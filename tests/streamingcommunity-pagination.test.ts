import { test, expect } from "bun:test";
import { streamingCommunityBrowse } from "../src/server/streamingcommunity";

function catalog(total?: number) {
  return (async (input: RequestInfo | URL) => {
    const page = Number(new URL(String(input)).searchParams.get("page") ?? 1);
    const count = total === undefined ? 60 : Math.max(0, Math.min(60, total - (page - 1) * 60));
    const data = { component: "Titles/Browse", props: {
      ...(total === undefined ? {} : { totalCount: total }),
      titles: Array.from({ length: count }, (_, index) => {
        const id = (page - 1) * 60 + index + 1;
        return { id, slug: `title-${id}`, name: `Title ${id}`, type: "movie" };
      }),
    } };
    return new Response(`<div data-page="${JSON.stringify(data).replaceAll('"', "&quot;")}"></div>`);
  }) as typeof fetch;
}

test("root catalog advances to its cursor and returns to page one", async () => {
  const fetchPage = catalog(120);
  const first = await streamingCommunityBrowse({}, undefined, undefined, fetchPage);
  const second = await streamingCommunityBrowse({ cursor: first.nextCursor }, undefined, undefined, fetchPage);
  expect(first.items[0]?.title).toBe("Title 1");
  expect(second.items[0]?.title).toBe("Title 61");
  expect((await streamingCommunityBrowse({ cursor: "1" }, undefined, undefined, fetchPage)).items).toEqual(first.items);
});

for (const [total, page, next] of [[60, 1, undefined], [120, 1, "2"], [120, 2, undefined], [121, 2, "3"], [121, 3, undefined], [undefined, 2, "3"]] as const) {
  test(`catalog total ${total}, page ${page} has next cursor ${next}`, async () => {
    const result = await streamingCommunityBrowse({ url: "https://streamingcommunityz.pictures/it/archive", cursor: String(page) }, undefined, undefined, catalog(total));
    expect(result.nextCursor).toBe(next);
  });
}

for (const cursor of ["0", "-1", "1.5", "no", "10000"]) {
  test(`root rejects out-of-range cursor ${cursor} before fetching`, async () => {
    let fetched = false;
    await expect(streamingCommunityBrowse({ cursor }, undefined, undefined, (async () => { fetched = true; return new Response(); }) as typeof fetch))
      .rejects.toMatchObject({ status: 400, message: "This catalogue page is out of range." });
    expect(fetched).toBe(false);
  });
}

test("text search still sends query and cursor", async () => {
  let target: URL | undefined;
  const fetchPage = (async (input: RequestInfo | URL) => { target = new URL(String(input)); return catalog(121)(input); }) as typeof fetch;
  const page = await streamingCommunityBrowse({ query: "Breaking Bad", cursor: "2" }, undefined, undefined, fetchPage);
  expect(target?.pathname).toBe("/it/search");
  expect(target?.searchParams.get("q")).toBe("Breaking Bad");
  expect(page.items[0]?.title).toBe("Title 61");
});
