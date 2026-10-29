import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveSource } from "../src/shared/live-input";
import type { ProviderItem } from "../src/shared/providers";

let liveSources: LiveSource[] = [];
const gate = () => ({ connected: true, videoQualityPreference: { quality: "auto" }, state: { liveSources }, run: async () => true });
mock.module("../src/client/session/session-context", () => ({ useSessionGate: gate, useOptionalSessionGate: gate }));
mock.module("../src/client/sections/shell/shell-context", () => ({ useShell: () => ({ credentials: { origin: "http://localhost", token: "test" }, available: true }) }));
let favorites: ProviderItem[] = [];
let controlledName: string | null = null;
let failedQueries: { queryKey: unknown[]; state: { status: string; dataUpdatedAt: number; errorUpdatedAt: number } }[] = [];
mock.module("@tanstack/react-query", () => ({ queryOptions: (options: unknown) => options, infiniteQueryOptions: (options: unknown) => options, notifyManager: { batchCalls: (callback: unknown) => callback },
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey.join("/") === "providers/favorites" ? { favorites } : { sources: [] } }),
  useQueryClient: () => ({ getQueryCache: () => ({ findAll: () => failedQueries, subscribe: () => () => {} }) }) }));
mock.module("../src/client/components/PlayOn", () => ({ PlayOnGroup: () => null, usePlayOn: () => ({ devices: [], on: (label: string) => controlledName ? `${label} on ${controlledName}` : label }) }));
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
mock.module("../src/client/sections/home/LiveTvPage", () => ({ channelMeta: () => "", useChannelActions: () => {}, useChannelLogo: () => {} }));
const { SavedSourceShelf, SharedSources, SourcesLine, sourceHomes } = await import("../src/client/sections/home/HomeSources");
const { useLiveSourceHits } = await import("../src/client/sections/find/useLiveSourceHits");
const source = (id: string, name: string, kind: LiveSource["kind"] = "screen"): LiveSource => ({ id, deviceId: id, name, kind, audio: true, video: kind === "screen" });
// Home's sources, as Home sets them after your own rows: shared inputs, a shelf of what's saved from each source with a
// home, and the Sources line (Discover folded into Home).
function Sources() {
  const hits = useLiveSourceHits("");
  return <>{!!hits.length && <SharedSources hits={hits} />}{sourceHomes.map(provider => <SavedSourceShelf key={provider} provider={provider} items={favorites.filter(item => item.provider === provider)} />)}<SourcesLine /></>;
}
const view = () => renderToStaticMarkup(<Sources />);
const first = (html: string) => [...html.matchAll(/<(?:button|a)\b[^>]*>/g)].filter(([tag]) => tag.includes("data-page-first"));

test("without shared inputs Home's sources start on the Sources line, a chip for every source", () => {
  liveSources = [];
  const html = view();
  expect(html).not.toContain('aria-label="Shared sources"');
  expect(first(html)[0]![0]).toContain('href="/collection?provider=twitch"');
  const sources = html.split('aria-label="Sources"').slice(1).join("");
  for (const provider of ["YouTube", "Bandcamp", "SoundCloud"]) expect(sources).toContain(`aria-label="Search ${provider}"`);
  for (const provider of ["twitch", "raiplay", "streamingcommunity"]) expect(sources).toContain(`href="/collection?provider=${provider}"`);
});

test("source shelves hold only what's saved from each source, never the source's own home", () => {
  liveSources = [];
  let html = view();
  expect(html).not.toContain('aria-label="Twitch"');
  favorites = [
    { id: "a", provider: "twitch", kind: "channel", title: "Followed streamer", url: "https://www.twitch.tv/followed" },
    { id: "b", provider: "raiplay", kind: "collection", title: "A saved programme", url: "https://www.raiplay.it/programmi/saved" },
  ];
  try {
    html = view();
    const twitch = html.split('<section aria-label="Twitch"')[1]!.split("</section>")[0]!;
    expect(twitch).toContain('href="/collection?provider=twitch"');
    expect(twitch).toContain('aria-label="Open Followed streamer"');
    expect(twitch).not.toContain("A saved programme");
    expect(html).toContain('aria-label="RaiPlay"');
    expect(html).not.toContain('aria-label="StreamingCommunity"');
  } finally { favorites = []; }
});
test("a source shelf puts live channels first, dims offline ones, and leaves out a page's saved sections", () => {
  liveSources = [];
  favorites = [
    { id: "off", provider: "twitch", kind: "channel", title: "Asleep", url: "https://www.twitch.tv/asleep", subtitle: "Offline", live: false },
    { id: "on", provider: "twitch", kind: "channel", title: "Streaming", url: "https://www.twitch.tv/streaming", subtitle: "Just Chatting · 1,204 viewers", live: true },
    { id: "section", provider: "raiplay", kind: "collection", title: "In Diretta", url: "https://www.raiplay.it/#block=PublishingBlock-1" },
  ];
  try {
    const html = view();
    const twitch = html.split('<section aria-label="Twitch"')[1]!.split("</section>")[0]!;
    expect(twitch.indexOf("Open Streaming")).toBeLessThan(twitch.indexOf("Open Asleep"));
    expect(twitch).toContain("Just Chatting, 1,204 viewers");
    expect(twitch).toContain("rounded-full");
    expect(twitch.split("Open Asleep")[1]).toContain("grayscale");
    expect(html).not.toContain("In Diretta");
    expect(html).not.toContain('aria-label="RaiPlay"');
  } finally { favorites = []; }
});

test("a source whose last answer failed is muted on the Sources line, and says so to a screen reader", () => {
  liveSources = [];
  failedQueries = [{ queryKey: ["search", "provider-page", "streamingcommunity", {}], state: { status: "error", dataUpdatedAt: 0, errorUpdatedAt: 2 } },
    { queryKey: ["search", "providers", "raiplay", {}], state: { status: "error", dataUpdatedAt: 0, errorUpdatedAt: 1 } },
    { queryKey: ["search", "provider-page", "raiplay", {}], state: { status: "success", dataUpdatedAt: 3, errorUpdatedAt: 0 } }];
  try {
    const sources = view().split('aria-label="Sources"').slice(1).join("");
    expect(sources.split('aria-label="Open StreamingCommunity, couldn&#x27;t load"')[1]!.split("</li>")[0]).toContain("Couldn&#x27;t load");
    expect(sources.split('aria-label="Open RaiPlay"')[1]!.split("</li>")[0]).not.toContain("Couldn&#x27;t load");
  } finally { failedQueries = []; }
});

test("one shared input leads the sources with the first page-entry Play control and its menu", () => {
  liveSources = [source("studio", "Studio · Screen")];
  const html = view();
  expect(html.indexOf('aria-label="Shared sources"')).toBeLessThan(html.indexOf('aria-label="Sources"'));
  expect(first(html).length).toBeGreaterThan(0);
  expect(first(html)[0]![0]).toContain('aria-label="Play Studio · Screen"');
  expect(html).toContain('aria-label="Options for Studio · Screen"');
  expect(html.split('aria-label="Sources"').slice(1).join("")).not.toContain("Studio");
});

test("screen and sound share the leading row, with the first taking page entry", () => {
  liveSources = [source("studio", "Studio · Screen"), source("laptop", "Laptop · System audio", "system-audio")];
  const html = view();
  expect(first(html).length).toBeGreaterThan(0);
  expect(html.indexOf('aria-label="Play Studio · Screen"')).toBeLessThan(html.indexOf('aria-label="Play Laptop · System audio"'));
  expect(html).toContain('aria-label="Options for Laptop · System audio"');
});

test("concert Join names local participation even when ordinary Play controls another device", () => {
  controlledName = "TV";
  liveSources = [{ ...source("concert", "Concert", "microphone"), intent: "live" }, source("studio", "Studio · Screen")];
  try {
    const html = view();
    expect(html).toContain('aria-label="Join Concert"');
    expect(html).not.toContain('aria-label="Join Concert on TV"');
    expect(html).toContain('aria-label="Play Studio · Screen on TV"');
  } finally { controlledName = null; }
});
