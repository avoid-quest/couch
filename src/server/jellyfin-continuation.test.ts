import { afterEach, expect, test } from "bun:test";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client";
import { createJellyfin } from "./jellyfin";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const id = (number: number) => number.toString(16).padStart(32, "0");
const parent = id(9000);
const user = id(9001);
const signal = () => new AbortController().signal;

async function fixture(current: BaseItemDto, siblings: BaseItemDto[], wait?: () => Promise<void>) {
  const requests: URL[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    requests.push(url);
    if (url.pathname === "/System/Info/Public") return Response.json({ ServerName: "Fixture", Id: "server", Version: "10.11.0" });
    if (url.pathname === "/Users/AuthenticateByName") return Response.json({ AccessToken: "fixture-token", User: { Id: user, Name: "Fixture" } });
    if (!request.headers.get("Authorization")?.includes('Token="fixture-token"')) return new Response(null, { status: 401 });
    if (url.pathname === `/Items/${current.Id}`) return Response.json(current);
    if (url.pathname === `/Shows/${parent}/Episodes` || url.pathname === "/Items") {
      await wait?.();
      const offset = Number(url.searchParams.get("startIndex"));
      const limit = Number(url.searchParams.get("limit"));
      return Response.json({ Items: siblings.slice(offset, offset + limit), TotalRecordCount: siblings.length });
    }
    if (url.pathname === "/Sessions/Logout") return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  } });
  cleanup.push(() => server.stop(true));
  const jellyfin = createJellyfin(":memory:");
  cleanup.push(() => jellyfin.close());
  await jellyfin.connect({ url: `http://127.0.0.1:${server.port}`, username: "Fixture", password: "Fixture" });
  const entry = await jellyfin.entry(current.Id!, "current");
  return { jellyfin, reference: entry.source.slice(9), requests };
}

test("Jellyfin episodes use the series endpoint and complete pagination across seasons", async () => {
  const episodes: BaseItemDto[] = Array.from({ length: 205 }, (_, index) => ({ Id: id(index + 1), Type: "Episode", Name: `Episode ${index + 1}`, SeriesId: parent, SeriesName: "Series", ParentIndexNumber: index < 102 ? 1 : 2, IndexNumber: index < 102 ? index + 1 : index - 101 }));
  const current = episodes[100]!;
  const { jellyfin, reference, requests } = await fixture(current, episodes.toReversed());
  const result = await jellyfin.continuation(reference, signal());
  expect(result?.title).toBe("Series");
  expect(result?.entries).toHaveLength(104);
  expect(result?.entries[0]?.source.endsWith(`:${id(102)}`)).toBe(true);
  expect(result?.entries[1]?.source.endsWith(`:${id(103)}`)).toBe(true);
  expect(result?.entries.at(-1)?.source.endsWith(`:${id(205)}`)).toBe(true);
  const pages = requests.filter(url => url.pathname.endsWith("/Episodes"));
  expect(pages.map(url => url.searchParams.get("startIndex"))).toEqual(["0", "100", "200"]);
  expect(pages.every(url => url.searchParams.get("isMissing") === "false" && url.searchParams.get("userId") === user)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/fixture-token|127\.0\.0\.1/);
});

test("Jellyfin music stays inside its album and uses disc/track order", async () => {
  const track = (number: number, disc: number, index: number, overrides: Partial<BaseItemDto> = {}): BaseItemDto => ({ Id: id(number), Type: "Audio", Name: `Track ${number}`, Overview: "Album notes", AlbumPrimaryImageTag: "cover", AlbumId: parent, Album: "Album", ParentIndexNumber: disc, IndexNumber: index, ...overrides });
  const current = track(1, 1, 1);
  const { jellyfin, reference, requests } = await fixture(current, [track(3, 2, 1), track(9, 1, 2, { AlbumId: id(8000) }), track(8, 1, 2, { Type: "Movie" }), track(7, 1, 2, { IndexNumber: null }), track(2, 1, 2), current]);
  const result = await jellyfin.continuation(reference, signal());
  expect(result?.title).toBe("Album");
  expect(result?.entries[0]).toMatchObject({ title: "Track 2", subtitle: "Album", description: "Album notes", artworkId: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(result?.entries.map(entry => entry.source.split(":").at(-1))).toEqual([id(2), id(3)]);
  const query = requests.find(url => url.pathname === "/Items")!.searchParams;
  expect(query.get("albumIds")).toBe(parent);
  expect(query.getAll("sortBy")).toEqual(["ParentIndexNumber", "IndexNumber"]);
});

test("Jellyfin movies and entries from another account have no continuation", async () => {
  const { jellyfin, reference, requests } = await fixture({ Id: id(1), Type: "Movie", Name: "Movie" }, []);
  expect(await jellyfin.continuation(reference, signal())).toBeNull();
  expect(await jellyfin.continuation(`different:${id(1)}`, signal())).toBeNull();
  expect(requests.some(url => url.pathname.endsWith("/Episodes") || url.pathname === "/Items")).toBe(false);
});

test("disconnecting Jellyfin while siblings load invalidates their result", async () => {
  let started!: () => void, release!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const item: BaseItemDto = { Id: id(1), Type: "Audio", Name: "One", AlbumId: parent, IndexNumber: 1 };
  const { jellyfin, reference } = await fixture(item, [item], async () => { started(); await waiting; });
  const pending = jellyfin.continuation(reference, signal());
  await loading;
  await jellyfin.disconnect();
  release();
  expect(await pending).toBeNull();
});

test("canceling a Jellyfin sibling lookup cannot publish its late result", async () => {
  let started!: () => void, release!: () => void;
  const loading = new Promise<void>(resolve => { started = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const item: BaseItemDto = { Id: id(1), Type: "Audio", Name: "One", AlbumId: parent, IndexNumber: 1 };
  const { jellyfin, reference } = await fixture(item, [item, { ...item, Id: id(2), IndexNumber: 2 }], async () => { started(); await waiting; });
  const controller = new AbortController();
  const pending = jellyfin.continuation(reference, controller.signal);
  await loading;
  controller.abort();
  release();
  await expect(pending).rejects.toThrow();
});
