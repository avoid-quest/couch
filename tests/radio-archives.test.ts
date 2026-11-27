import { afterEach, expect, test } from "bun:test";
import { archiveLink } from "../src/shared/archives";
import { mixcloudLink } from "../src/shared/mixcloud";
import { providerForUrl, publicProviderMediaUrl } from "../src/shared/providers";
import {
  browseArchives,
  loadArchiveList,
  resolveArchiveLink,
} from "../src/server/providers/archives";
import { browseMixcloud } from "../src/server/providers/mixcloud";
import bailefunk from "./fixtures/archives/lyl-baile-funk.json";
import lylSearch from "./fixtures/archives/lyl-search.json";
import blackoutPodcast from "./fixtures/archives/blackout-podcast.json";
import hkcrShow from "./fixtures/archives/hkcr-show.json";
import mixcloudUser from "./fixtures/archives/mixcloud-user.json";
import mixcloudCloudcasts from "./fixtures/archives/mixcloud-cloudcasts.json";
import mixcloudPlaylists from "./fixtures/archives/mixcloud-playlists.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
type Route = (url: URL, body: unknown) => Response | undefined;
function serve(...routes: Route[]) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
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
  const { query, variables } = body as { query: string; variables: Record<string, unknown> };
  if (query.includes("showsByStyles"))
    return Response.json({ data: { showsByStyles: bailefunk.showsByStyles } });
  const episodes =
    bailefunk.episodesByShow[variables.show as keyof typeof bailefunk.episodesByShow];
  return Response.json({ data: { episodesByShow: variables.start ? [] : episodes } });
};

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
  // A WordPress slug keeps the station's own lower-case escapes, so a pasted link matches its show's list.
  expect(archiveLink("https://radioblackout.org/podcast/flinta-☽")?.url).toBe(
    "https://radioblackout.org/podcast/flinta-%e2%98%bd/",
  );
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
  const dates = page.items.map((item) => item.subtitle!.slice(-10));
  expect(dates).toEqual(dates.toSorted().toReversed());
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
        data: { showBySlug: { slug: "gomar", title: "Gomar", artists: "Gomar" } },
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
    creator: { title: "ARSIDER", url: "https://radioblackout.org/shows/arsider/" },
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
  const page = await browseMixcloud({ url: "https://www.mixcloud.com/lylradio/uploads/" });
  expect(page.item).toMatchObject({ kind: "channel", url: "https://www.mixcloud.com/lylradio/" });
  expect(page.items.map((item) => item.kind)).toEqual([
    "collection",
    "collection",
    "media",
    "media",
    "media",
  ]);
  expect(page.items[2]).toMatchObject({
    provider: "mixcloud",
    collection: { title: "LYL Radio", url: "https://www.mixcloud.com/lylradio/", index: 0 },
    creator: { url: "https://www.mixcloud.com/lylradio/" },
  });
  expect(page.nextCursor).toBe("24");
});

test("Mixcloud's throttle is respected: Couch waits as long as it was told before asking again", async () => {
  const asked = serve(() =>
    Response.json(
      { error: { type: "RateLimitException", message: "Slow down", retry_after: 30 } },
      { status: 403, headers: { "Retry-After": "30" } },
    ),
  );
  await expect(browseMixcloud({ query: "lyl" })).rejects.toThrow(/Try again in 30 s/);
  await expect(browseMixcloud({ query: "nts" })).rejects.toThrow(/Try again in/);
  expect(asked).toHaveLength(1);
});
