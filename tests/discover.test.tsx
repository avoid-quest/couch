import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveSource } from "../src/shared/live-input";

let liveSources: LiveSource[] = [];
const gate = () => ({ connected: true, videoQualityPreference: { quality: "auto" }, state: { liveSources }, run: async () => true });
mock.module("../src/client/session/session-context", () => ({ useSessionGate: gate, useOptionalSessionGate: gate }));
mock.module("../src/client/sections/shell/shell-context", () => ({ useShell: () => ({ credentials: { origin: "http://localhost", token: "test" }, available: true }) }));
mock.module("@tanstack/react-query", () => ({ queryOptions: (options: unknown) => options, useQuery: () => ({ data: { sources: [] } }) }));
mock.module("../src/client/components/PlayOn", () => ({ PlayOnGroup: () => null, usePlayOn: () => ({ devices: [], on: (label: string) => label }) }));
mock.module("../src/client/detail-navigation", () => ({
  collectionLocation: ({ provider }: { provider: string }) => `/collection?provider=${provider}`,
  itemLocation: (kind: string, id: string) => `/item?kind=${kind}&id=${id}`,
  detailHref: (href: string) => href,
  useDetailNavigation: () => ({ open: () => {} }),
}));
mock.module("../src/client/sections/find/SearchOnlineResults", () => ({
  providerNames: { youtube: "YouTube", bandcamp: "Bandcamp", soundcloud: "SoundCloud", twitch: "Twitch", streamingcommunity: "StreamingCommunity", raiplay: "RaiPlay", movies123: "123MoviesFree", animesaturn: "AnimeSaturn", animeunity: "AnimeUnity" },
  SearchOnlineResults: () => null,
}));
mock.module("../src/client/sections/discover/LiveTvPage", () => ({ channelMeta: () => "", useChannelActions: () => {}, useChannelLogo: () => {} }));
let radioPending = false;
let radioError = false;
let radioStations = [{ id: "radio", name: "Station" }];
mock.module("../src/client/sections/discover/on-air", () => ({
  useOnAir: () => ({ stations: radioStations, favorites: { isPending: false, error: radioError ? new Error("Unavailable") : null }, builtIn: { isPending: radioPending }, pending: radioPending, show: () => undefined, meta: () => "" }),
  useStationMenu: () => () => [],
}));
const { defaultDiscoverRows } = await import("../src/client/sections/discover/discover-rows");
let preferences = defaultDiscoverRows;
mock.module("../src/client/sections/discover/discover-rows", () => ({ useDiscoverRows: () => ({ rows: preferences }) }));
const { DiscoverPage } = await import("../src/client/sections/discover/DiscoverPage");
const source = (id: string, name: string, kind: LiveSource["kind"] = "screen"): LiveSource => ({ id, deviceId: id, name, kind, audio: true, video: kind === "screen" });
const view = () => renderToStaticMarkup(<DiscoverPage />);
const first = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].filter(([tag]) => tag.includes("data-page-first"));

test("without shared inputs Discover starts on Radio and keeps the search-only Sources row", () => {
  liveSources = [];
  const html = view();
  expect(html).not.toContain('aria-label="Shared sources"');
  expect(first(html).length).toBeGreaterThan(0);
  expect(first(html)[0]![0]).toContain('aria-label="Play Station"');
  for (const provider of ["YouTube", "Bandcamp", "SoundCloud"]) expect(html).toContain(`aria-label="Search ${provider}"`);
});

test("one shared input leads Discover with the first page-entry Play control and its menu", () => {
  liveSources = [source("studio", "Studio · Screen")];
  const html = view();
  expect(html.indexOf('aria-label="Shared sources"')).toBeLessThan(html.indexOf('aria-label="Radio"'));
  expect(first(html).length).toBeGreaterThan(0);
  expect(first(html)[0]![0]).toContain('aria-label="Play Studio · Screen"');
  expect(html).toContain('aria-label="Options for Studio · Screen"');
  expect(html.split('aria-label="Sources"')[1]).not.toContain("Studio");
});

test("screen and sound share the leading row, with the first taking page entry", () => {
  liveSources = [source("studio", "Studio · Screen"), source("laptop", "Laptop · System audio", "system-audio")];
  const html = view();
  expect(first(html).length).toBeGreaterThan(0);
  expect(html.indexOf('aria-label="Play Studio · Screen"')).toBeLessThan(html.indexOf('aria-label="Play Laptop · System audio"'));
  expect(html).toContain('aria-label="Options for Laptop · System audio"');
});


test("saved order and visibility choose Discover's first available section without dropping unavailable sources", () => {
  preferences = [{ id: "sources", shown: true }, ...defaultDiscoverRows.filter(row => row.id !== "sources").map(row => ({ ...row, shown: row.id !== "radio" }))];
  liveSources = [];
  let html = view();
  expect(first(html)[0]![0]).toContain('aria-label="Search YouTube"');
  expect(html).not.toContain('aria-label="Radio"');
  expect(html).not.toContain('aria-label="Shared sources"');
  liveSources = [source("studio", "Studio")];
  html = view();
  expect(html.indexOf('aria-label="Sources"')).toBeLessThan(html.indexOf('aria-label="Shared sources"'));
  expect(first(html)[0]![0]).toContain('aria-label="Search YouTube"');
  preferences = defaultDiscoverRows;
});

test("all hidden leaves customization reachable and does not render source queries", () => {
  preferences = defaultDiscoverRows.map(row => ({ ...row, shown: false }));
  const html = view();
  expect(html).toContain("All sections are hidden");
  expect(html).toContain('href="/settings/device/discover"');
  expect(html).not.toContain('aria-label="Shared sources"');
  expect(html).not.toContain('aria-label="Radio"');
  expect(html).not.toContain('aria-label="Sources"');
  expect(first(html)).toHaveLength(0);
  preferences = defaultDiscoverRows;
});


test("Radio waits for both station reads before showing an error", () => {
  radioStations = [];
  radioError = true;
  radioPending = true;
  try {
    const loading = view();
    expect(loading).toContain("Loading Radio");
    expect(loading).not.toContain("Couldn&#x27;t load Radio");
    radioPending = false;
    expect(view()).toContain("Couldn&#x27;t load Radio");
    radioStations = [{ id: "radio", name: "Station" }];
    expect(view()).toContain('aria-label="Play Station"');
    expect(view()).not.toContain("Couldn&#x27;t load Radio");
  } finally {
    radioPending = false;
    radioError = false;
    radioStations = [{ id: "radio", name: "Station" }];
  }
});
