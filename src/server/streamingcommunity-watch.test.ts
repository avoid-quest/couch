import { expect, test } from "bun:test";
import { streamingCommunityWatchContext } from "./streamingcommunity";

const origin = "https://streamingcommunityz.photos";
const watchUrl = `${origin}/it/watch/1955?e=17207`;
const fixture = await Bun.file(new URL("./providers/streamingcommunity.fixtures/watch-episode.json", import.meta.url)).json();
const html = (page: unknown) => `<div data-page="${JSON.stringify(page).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`;
const respond = (page: unknown) => (async () => new Response(html(page))) as unknown as typeof fetch;

test("watch metadata recovers canonical title and season without exposing other watch props", async () => {
  let requestOptions: RequestInit | undefined;
  const request = (async (url: URL, options: RequestInit) => {
    expect(url.href).toBe(watchUrl);
    requestOptions = options;
    return new Response(html({ ...fixture, props: { ...fixture.props, auth: { private: true }, embedUrl: "https://private.example/embed" } }));
  }) as unknown as typeof fetch;
  expect(await streamingCommunityWatchContext(watchUrl, undefined, request)).toEqual({
    title: "MasterChef Italia", titleUrl: `${origin}/it/titles/1955-masterchef-italia`,
    seasonUrl: `${origin}/it/titles/1955-masterchef-italia/season-11`, episodeId: 17207,
  });
  expect(requestOptions).toMatchObject({ credentials: "omit", redirect: "error" });
  expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
});

test("watch context rejects unrelated hosts, credentials and unsupported URLs before requesting", async () => {
  let requests = 0;
  const request = (async () => { requests++; return new Response(html(fixture)); }) as unknown as typeof fetch;
  for (const url of ["https://example.com/it/watch/1955?e=17207", "http://streamingcommunityz.photos/it/watch/1955?e=17207", `https://user:password@streamingcommunityz.photos/it/watch/1955?e=17207`, `${watchUrl}&redirect=1`, `${watchUrl}#other`, `${origin}/it/titles/1955`, `${origin}:8443/it/watch/1955?e=17207`]) {
    await expect(streamingCommunityWatchContext(url, undefined, request)).rejects.toThrow("Choose a StreamingCommunity watch link");
  }
  expect(requests).toBe(0);
});

test("watch context verifies the returned title and episode before using its canonical slug", async () => {
  for (const page of [
    { ...fixture, component: "Titles/Title" },
    { ...fixture, props: { ...fixture.props, title: { ...fixture.props.title, id: 99 } } },
    { ...fixture, props: { ...fixture.props, title: { ...fixture.props.title, slug: "../other" } } },
    { ...fixture, props: { ...fixture.props, episode: { ...fixture.props.episode, id: 99 } } },
    { ...fixture, props: { ...fixture.props, episode: { ...fixture.props.episode, season: null } } },
  ]) await expect(streamingCommunityWatchContext(watchUrl, undefined, respond(page))).rejects.toThrow("StreamingCommunity moved");
});

test("watch context cancellation wins both before a request and after a transport ignores abort", async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const request = (async () => { requests++; return new Response(html(fixture)); }) as unknown as typeof fetch;
  await expect(streamingCommunityWatchContext(watchUrl, controller.signal, request)).rejects.toThrow();
  expect(requests).toBe(0);
  const pending = new AbortController();
  const ignoredAbort = (async () => { pending.abort(); return new Response(html(fixture)); }) as unknown as typeof fetch;
  await expect(streamingCommunityWatchContext(watchUrl, pending.signal, ignoredAbort)).rejects.toThrow();
});
