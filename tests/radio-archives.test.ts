import { afterEach, expect, test } from "bun:test";
import { archiveLink } from "../src/shared/archives";
import { mixcloudLink } from "../src/shared/mixcloud";
import { providerForUrl, publicProviderMediaUrl, type ProviderItem } from "../src/shared/providers";
import {
  browseArchives,
  loadArchiveList,
  resolveArchiveLink,
} from "../src/server/providers/archives";
import { browseMixcloud } from "../src/server/providers/mixcloud";
import { catalogueTransport } from "../src/server/providers/http";
import { slugPattern, wholeList } from "../src/server/providers/archives/station";
import { createContinuationResolver } from "../src/server/continuation";
import { providerCollectionCursor } from "../src/client/collection-pagination";
import bailefunk from "./fixtures/archives/lyl-baile-funk.json";
import lylSearch from "./fixtures/archives/lyl-search.json";
import blackoutPodcast from "./fixtures/archives/blackout-podcast.json";
import hkcrShow from "./fixtures/archives/hkcr-show.json";
import mixcloudUser from "./fixtures/archives/mixcloud-user.json";
import mixcloudCloudcasts from "./fixtures/archives/mixcloud-cloudcasts.json";
import mixcloudPlaylists from "./fixtures/archives/mixcloud-playlists.json";

const realFetch = catalogueTransport.fetch;
afterEach(() => {
  catalogueTransport.fetch = realFetch;
});
type Route = (url: URL, body: unknown) => Response | undefined;
function serve(...routes: Route[]) {
  const asked: string[] = [];
  catalogueTransport.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    asked.push(url.href);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    for (const route of routes) {
      const response = route(url, body);
      if (response) return response;
    }
    throw new TypeError(`Unexpected request ${url.href}`);
  }) as typeof fetch;
  return asked;
}
const lylGraphql: Route = (url, body) => {
  if (url.href !== "https://strapi.lyl.live/graphql") return;
  const { query, variables } = body as {
    query: string;
    variables: Record<string, unknown>;
  };
  if (query.includes("showsByStyles"))
    return Response.json({ data: { showsByStyles: bailefunk.showsByStyles } });
  const episodes =
    bailefunk.episodesByShow[variables.show as keyof typeof bailefunk.episodesByShow];
  return Response.json({
    data: { episodesByShow: variables.start ? [] : episodes },
  });
};

test("a whole list counts every episode it holds, though it keeps its first 500", () => {
  const link = archiveLink("https://lyl.live/show/arsider")!;
  const episode = (index: number) =>
    ({ url: `https://lyl.live/episode/e${index}` }) as ProviderItem;
  const episodes = [episode(0), ...Array.from({ length: 501 }, (_, index) => episode(index))];
  const page = wholeList(link, undefined, { title: "Arsider" }, episodes);
  expect(page.count).toBe(501);
  expect(page.items).toHaveLength(500);
});

test("a station's link says what it is, from the link alone", () => {
  expect(archiveLink("https://lyl.live/shows/residents?styles=Baile%20Funk")).toEqual({
    provider: "archives",
    station: "lyl",
    shape: "playlist",
    url: "https://lyl.live/shows/residents?styles=Baile%20Funk",
    slug: "residents",
    style: "Baile Funk",
  });
  expect(archiveLink("https://lyl.live/episode/dj-ale")).toMatchObject({
    shape: "atom",
    slug: "dj-ale",
  });
  expect(archiveLink("https://radioblackout.org/shows/arsider")).toMatchObject({
    station: "blackout",
    shape: "playlist",
    url: "https://radioblackout.org/shows/arsider/",
  });
  expect(
    archiveLink("https://www.nts.live/shows/minimal-effort/episodes/x-1st-may-2026?utm=1"),
  ).toMatchObject({
    shape: "atom",
    url: "https://www.nts.live/shows/minimal-effort/episodes/x-1st-may-2026",
  });
  expect(archiveLink("https://www.nts.live/shows/minimal-effort/episodes")?.url).toBe(
    "https://www.nts.live/shows/minimal-effort",
  );
  for (const url of ["https://www.nts.live/shows/episodes", "https://lyl.live/episode/episodes"])
    expect(archiveLink(url)?.url).toBe(url);
  // A WordPress slug keeps the station's own lower-case escapes, so a pasted link matches its show's list.
  expect(archiveLink("https://radioblackout.org/podcast/flinta-☽")?.url).toBe(
    "https://radioblackout.org/podcast/flinta-%e2%98%bd/",
  );
  expect(archiveLink("https://radioblackout.org/podcast/☽-flinta")?.url).toBe(
    "https://radioblackout.org/podcast/%e2%98%bd-flinta/",
  );
  expect(slugPattern.test("%e2%98%bd-flinta")).toBe(true);
  expect(slugPattern.test(`%e2${"a".repeat(297)}`)).toBe(true);
  expect(slugPattern.test(`%e2${"a".repeat(298)}`)).toBe(false);
  expect(archiveLink(`https://lyl.live/episode/${"a".repeat(301)}`)).toBeUndefined();
  expect(archiveLink("https://lyl.live/shows/residents")).toBeUndefined();
  expect(archiveLink("https://lyl.live/about")).toBeUndefined();
  expect(mixcloudLink("https://www.mixcloud.com/lylradio/dj-alé-dj-alé-22102026/")).toMatchObject({
    shape: "atom",
    url: "https://www.mixcloud.com/lylradio/dj-al%C3%A9-dj-al%C3%A9-22102026/",
  });
  expect(mixcloudLink("https://mixcloud.com/lylradio/uploads/")).toMatchObject({
    kind: "user",
    shape: "playlist",
    url: "https://www.mixcloud.com/lylradio/",
  });
  expect(
    mixcloudLink("https://www.mixcloud.com/lylradio/playlists/meakusma-festival-2022/"),
  ).toMatchObject({
    kind: "playlist",
  });
  // A user's playlists are a page to choose from, not one list to play.
  expect(mixcloudLink("https://www.mixcloud.com/lylradio/playlists/")).toMatchObject({
    kind: "playlists",
    shape: "page",
  });
  expect(mixcloudLink("https://www.mixcloud.com/lylradio/favorites/")).toBeUndefined();
  expect(mixcloudLink("https://www.mixcloud.com/discover/jazz/")).toBeUndefined();
  expect(providerForUrl("https://hkcr.live/residents/lethal-fantasies")).toBe("archives");
  expect(providerForUrl("https://www.mixcloud.com/NTSRadio/")).toBe("mixcloud");
  expect(publicProviderMediaUrl("https://radio.syg.ma/episodes/expired-17-ijji")).toBe(
    "https://radio.syg.ma/episodes/expired-17-ijji",
  );
  expect(publicProviderMediaUrl("https://radio.syg.ma/shows/expired")).toBeUndefined();
});

test("LYL's residents for a style list every past episode of their shows once, newest first", async () => {
  serve(lylGraphql);
  const url = "https://lyl.live/shows/residents?styles=Baile%20Funk";
  const page = await browseArchives({ url });
  expect(page.title).toBe("Baile Funk");
  expect(page.items).toHaveLength(44);
  expect(page.item).toMatchObject({ kind: "collection", url });
  const dates = page.items.map((item) => Date.parse(item.subtitle!.split(" · ").at(-1)!));
  expect(dates.every(Number.isFinite)).toBe(true);
  expect(dates).toEqual(dates.toSorted((a, b) => b - a));
  expect(page.items.map((item) => item.collection?.index)).toEqual([...Array(44).keys()]);
  expect(page.items[0]).toMatchObject({
    provider: "archives",
    kind: "media",
    creator: { url: expect.stringMatching(/^https:\/\/lyl\.live\/show\//) },
    collection: { title: "Baile Funk", url },
  });
  expect((await loadArchiveList(url)).items).toHaveLength(44);
});

test("an episode that hasn't aired yet isn't offered", async () => {
  const future = {
    ...bailefunk.episodesByShow.gomar[0]!,
    slug: "gomar-next",
    startAt: "2999-01-01T00:00:00.000Z",
  };
  serve((url, body) => {
    const query = (body as { query?: string } | undefined)?.query ?? "";
    if (query.includes("showBySlug"))
      return Response.json({
        data: {
          showBySlug: { slug: "gomar", title: "Gomar", artists: "Gomar" },
        },
      });
    if (query.includes("episodesByShow"))
      return Response.json({
        data: { episodesByShow: [future, ...bailefunk.episodesByShow.gomar] },
      });
  });
  const page = await browseArchives({ url: "https://lyl.live/show/gomar" });
  expect(page.items.map((item) => item.url)).toEqual(["https://lyl.live/episode/gomar"]);
});

test("Radio archives finds an episode by its DJ with or without accents, and names a station that didn't answer", async () => {
  const asked = serve(
    (url) => (url.hostname === "strapi.lyl.live" ? Response.json(lylSearch) : undefined),
    (url) =>
      url.hostname === "www.nts.live" ? new Response("Unavailable", { status: 503 }) : undefined,
    (url) =>
      url.hostname === "api.mixcloud.com" ? Response.json({ data: [], paging: {} }) : undefined,
    (url) =>
      url.hostname === "radio.syg.ma"
        ? new Response(
            '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"episodes":[]}}}</script>',
          )
        : undefined,
    (url) => (url.pathname.endsWith("/series_index") ? Response.json({ series: [] }) : undefined),
    (url) => (url.hostname === "cms.hkcr.live" ? Response.json({ shows: [] }) : undefined),
    () => Response.json([]),
  );
  const page = (await browseArchives({ query: "dj ale" })) as {
    warning?: string;
    items: { url: string }[];
  };
  expect(asked).toContain("https://strapi.lyl.live/api/lyl/search?q=dj+ale");
  expect(page.items[0]!.url).toBe("https://lyl.live/episode/dj-ale");
  expect(page.warning).toBe("NTS didn't answer.");
});

test("an episode plays from the station's own file, else the recording its post embeds", async () => {
  serve(
    (url) =>
      url.hostname === "radioblackout.org" && url.pathname.endsWith("/podcast")
        ? Response.json(blackoutPodcast)
        : undefined,
    (url) => (url.hostname === "cms.hkcr.live" ? Response.json(hkcrShow) : undefined),
  );
  const blackout = await resolveArchiveLink(
    "https://radioblackout.org/podcast/un-mese-in-vetrina/",
  );
  expect(blackout.url).toBe(
    "https://radioblackout.org/wp-content/uploads/2026/11/12112026_arsider_speciale_svarioni.mp3",
  );
  expect(blackout.metadata).toMatchObject({
    title: "UN MESE IN VETRINA",
    creator: {
      title: "ARSIDER",
      url: "https://radioblackout.org/shows/arsider/",
    },
  });
  // HKCR's broadcast has no file, only a Mixcloud player.
  expect((await resolveArchiveLink("https://hkcr.live/shows/gussief1-11-25-2026")).url).toBe(
    "https://www.mixcloud.com/HKCR/gussief1-25112026/",
  );
});

test("a Mixcloud user's page lists their playlists, then their uploads placed in the whole list", async () => {
  serve((url) => {
    if (url.pathname === "/lylradio/") return Response.json(mixcloudUser);
    if (url.pathname === "/lylradio/playlists/") return Response.json(mixcloudPlaylists);
    if (url.pathname === "/lylradio/cloudcasts/") return Response.json(mixcloudCloudcasts);
  });
  const page = await browseMixcloud({
    url: "https://www.mixcloud.com/lylradio/uploads/",
  });
  expect(page.item).toMatchObject({
    kind: "channel",
    url: "https://www.mixcloud.com/lylradio/",
  });
  expect(page.items.map((item) => item.kind)).toEqual([
    "collection",
    "collection",
    "media",
    "media",
    "media",
  ]);
  expect(page.items[2]).toMatchObject({
    provider: "mixcloud",
    collection: {
      title: "LYL Radio",
      url: "https://www.mixcloud.com/lylradio/",
      index: 0,
    },
    creator: { url: "https://www.mixcloud.com/lylradio/" },
  });
  expect(page.nextCursor).toBe("24");
  expect(page.count).toBe(15585);
});

test("Mixcloud's throttle is respected: Couch waits as long as it was told before asking again", async () => {
  const asked = serve(() =>
    Response.json(
      {
        error: {
          type: "RateLimitException",
          message: "Slow down",
          retry_after: 30,
        },
      },
      { status: 403, headers: { "Retry-After": "30" } },
    ),
  );
  await expect(browseMixcloud({ query: "lyl" })).rejects.toThrow(/Try again in 30 s/);
  await expect(browseMixcloud({ query: "nts" })).rejects.toThrow(/Try again in/);
  expect(asked).toHaveLength(1);
});

test("a pasted episode continues through its show, however the link was spelled", async () => {
  const older = {
    ...blackoutPodcast[0]!,
    slug: "older-episode",
    title: "Older",
  };
  serve((url) => {
    if (url.pathname.endsWith("/podcastfilter"))
      return Response.json([{ id: 8162, name: "arsider" }]);
    if (url.pathname.endsWith("/shows")) return Response.json([{ title: "ARSIDER" }]);
    if (url.searchParams.has("podcastfilter")) return Response.json([blackoutPodcast[0], older]);
    if (url.pathname.endsWith("/podcast")) return Response.json(blackoutPodcast);
  });
  const next = await createContinuationResolver()(
    {
      id: "entry",
      title: "UN MESE IN VETRINA",
      source: "web:https://radioblackout.org/podcast/un-mese-in-vetrina",
    },
    AbortSignal.timeout(5_000),
  );
  expect(next?.title).toBe("ARSIDER");
  expect(next?.entries.map((entry) => [entry.source, entry.collection?.index])).toEqual([
    ["web:https://radioblackout.org/podcast/older-episode/", 1],
  ]);
});

test("a WordPress show of exactly 100 episodes ends on its full page", async () => {
  const asked = serve((url) => {
    if (url.pathname.endsWith("/podcastfilter"))
      return Response.json([{ id: 8162, name: "arsider" }]);
    if (url.pathname.endsWith("/shows")) return Response.json([{ title: "ARSIDER" }]);
    if (url.searchParams.get("page") === "1")
      return Response.json(
        Array.from({ length: 100 }, (_, n) => ({
          ...blackoutPodcast[0]!,
          slug: `episode-${n}`,
        })),
        { headers: { "X-WP-TotalPages": "1" } },
      );
    // WordPress rejects a page past its last.
    return Response.json({ code: "rest_post_invalid_page_number" }, { status: 400 });
  });
  const page = await loadArchiveList("https://radioblackout.org/shows/arsider/");
  expect(page.items).toHaveLength(100);
  expect(asked.some((url) => url.includes("page=2"))).toBe(false);
});

test("NTS counts a show's episodes, and a picture off the station's own hosts isn't shown", async () => {
  const episode = (alias: string, picture: string) => ({
    show_alias: "minimal-effort",
    episode_alias: alias,
    name: alias,
    broadcast: "2026-11-01T00:00:00Z",
    media: { picture_medium: picture },
  });
  serve((url) => {
    if (url.pathname === "/api/v2/shows/minimal-effort")
      return Response.json({ name: "Minimal Effort" });
    if (url.pathname === "/api/v2/shows/minimal-effort/episodes")
      return Response.json({
        metadata: { resultset: { count: 145 } },
        results: [
          episode("on-the-lan", "https://192.168.1.10/x.jpeg"),
          episode("on-nts", "https://media2.ntslive.co.uk/resize/400x400/x.jpeg"),
        ],
      });
  });
  const page = await browseArchives({
    url: "https://www.nts.live/shows/minimal-effort",
  });
  expect(page.count).toBe(145);
  expect(page.nextCursor).toBe("12");
  expect(page.items.map((item) => item.thumbnail)).toEqual([
    undefined,
    "https://media2.ntslive.co.uk/resize/400x400/x.jpeg",
  ]);
});

test("an item on a later page of a remote list is found on that page", () => {
  const at = (url: string, index: number) => ({ title: "List", url, index });
  expect(
    providerCollectionCursor("archives", at("https://www.nts.live/shows/minimal-effort", 12)),
  ).toBe("12");
  expect(
    providerCollectionCursor("archives", at("https://www.nts.live/shows/minimal-effort", 11)),
  ).toBeUndefined();
  // A station without upstream paging is one page.
  expect(
    providerCollectionCursor("archives", at("https://radioblackout.org/shows/arsider/", 130)),
  ).toBeUndefined();
  expect(providerCollectionCursor("mixcloud", at("https://www.mixcloud.com/lylradio/", 30))).toBe(
    "24",
  );
  expect(
    providerCollectionCursor("soundcloud", at("https://soundcloud.com/user/sets/set", 48)),
  ).toBe("48");
});
