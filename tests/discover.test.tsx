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
  detailHref: (href: string) => href,
  useDetailNavigation: () => ({ open: () => {} }),
}));
mock.module("../src/client/sections/find/SearchOnlineResults", () => ({
  providerNames: { youtube: "YouTube", bandcamp: "Bandcamp", soundcloud: "SoundCloud", twitch: "Twitch", streamingcommunity: "StreamingCommunity", raiplay: "RaiPlay", movies123: "123MoviesFree", animesaturn: "AnimeSaturn", animeunity: "AnimeUnity" },
  SearchOnlineResults: () => null,
}));
mock.module("../src/client/sections/discover/LiveTvPage", () => ({ channelMeta: () => "", useChannelActions: () => {}, useChannelLogo: () => {} }));
mock.module("../src/client/sections/discover/on-air", () => ({
  useOnAir: () => ({ stations: [{ id: "radio", name: "Station" }], favorites: {}, builtIn: {}, pending: false, show: () => undefined, meta: () => "" }),
  useStationMenu: () => () => [],
}));
const { DiscoverPage } = await import("../src/client/sections/discover/DiscoverPage");
const source = (id: string, name: string, kind: LiveSource["kind"] = "screen"): LiveSource => ({ id, deviceId: id, name, kind, audio: true, video: kind === "screen" });
const view = () => renderToStaticMarkup(<DiscoverPage />);
const first = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].filter(([tag]) => tag.includes("data-page-first"));

test("without shared inputs Discover starts on Radio and keeps the search-only Sources row", () => {
  liveSources = [];
  const html = view();
  expect(html).not.toContain('aria-label="Shared sources"');
  expect(first(html)).toHaveLength(1);
  expect(first(html)[0]![0]).toContain('aria-label="Play Station"');
  for (const provider of ["YouTube", "Bandcamp", "SoundCloud"]) expect(html).toContain(`aria-label="Search ${provider}"`);
});

test("one shared input leads Discover with the only page-first Play control and its menu", () => {
  liveSources = [source("studio", "Studio · Screen")];
  const html = view();
  expect(html.indexOf('aria-label="Shared sources"')).toBeLessThan(html.indexOf('aria-label="Radio"'));
  expect(first(html)).toHaveLength(1);
  expect(first(html)[0]![0]).toContain('aria-label="Play Studio · Screen"');
  expect(html).toContain('aria-label="Options for Studio · Screen"');
  expect(html.split('aria-label="Sources"')[1]).not.toContain("Studio");
});

test("screen and sound share the leading row, with only the first taking page entry", () => {
  liveSources = [source("studio", "Studio · Screen"), source("laptop", "Laptop · System audio", "system-audio")];
  const html = view();
  expect(first(html)).toHaveLength(1);
  expect(html.indexOf('aria-label="Play Studio · Screen"')).toBeLessThan(html.indexOf('aria-label="Play Laptop · System audio"'));
  expect(html).toContain('aria-label="Options for Laptop · System audio"');
});
