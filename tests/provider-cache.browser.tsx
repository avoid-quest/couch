// Import on an empty Vite page and call runProviderCacheRegression().
// Real query observers and SearchOnlineResults; local responses and a controlled query clock.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider, InfiniteQueryObserver, QueryObserver, focusManager, timeoutManager } from "@tanstack/react-query";
import { SearchOnlineResults, type SearchResultSummary } from "../src/client/sections/find/SearchOnlineResults";
import { providerBrowseQuery, providerPageQuery } from "../src/client/api/providers";

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const settle = () => new Promise(resolve => window.setTimeout(resolve, 40));
export async function runProviderCacheRegression() {
  const originalFetch = window.fetch, realNow = Date.now;
  let now = realNow(), timerId = 0, live = true, generation = 0;
  const intervals = new Map<number, { run: () => void; delay: number }>();
  const timers = {
    setTimeout: (run: () => void, delay: number) => window.setTimeout(run, delay),
    clearTimeout: (id: number | undefined) => window.clearTimeout(id),
    setInterval: (run: () => void, delay: number) => { const id = ++timerId; intervals.set(id, { run, delay }); return id; },
    clearInterval: (id: number | undefined) => { if (id !== undefined) intervals.delete(id); },
  };
  timeoutManager.setTimeoutProvider(timers);
  Date.now = () => now;
  focusManager.setFocused(true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host);
  const credentials = { origin: location.origin, token: "fixture" };
  const reads: Array<{ provider: string; cursor: string }> = [];
  let summary: SearchResultSummary | undefined;
  const report = (_source: string, result: SearchResultSummary) => { summary = result; };
  window.fetch = async input => {
    const url = new URL(String(input), location.href);
    const provider = url.pathname.match(/\/api\/providers\/(\w+)\/items$/)?.[1];
    if (!provider) return Response.json({ items: [], favorites: [] });
    const cursor = url.searchParams.get("cursor") ?? "";
    reads.push({ provider, cursor });
    return Response.json({ items: [{ id: `${provider}-${cursor || "first"}`, provider, kind: live ? "media" : "channel", title: live ? "Live fixture" : "Offline fixture", live, url: "https://www.twitch.tv/fixture" }], nextCursor: cursor ? undefined : `next-${generation}` });
  };
  const render = (active = true, connected = true, provider: "twitch" | "bandcamp" = "twitch", paged = false) => flushSync(() => root.render(
    <QueryClientProvider client={client}><SearchOnlineResults {...credentials} provider={provider} query="fixture" quality="best" active={active} connected={connected} canPlay={false} paged={paged} onEnqueued={() => {}} onResults={report} /></QueryClientProvider>
  ));
  const advance = async () => {
    now += 20_000;
    for (const timer of [...intervals.values()]) { assert(timer.delay === 20_000, "Unexpected polling cadence"); timer.run(); }
    await settle();
  };
  try {
    // Both query shapes refresh a stale remount after 25 seconds.
    for (const infinite of [false, true]) {
      live = true;
      const options = infinite ? providerBrowseQuery(credentials, "twitch", { query: `remount-${infinite}` }) : providerPageQuery(credentials, "twitch", { query: `remount-${infinite}` });
      if (infinite) await client.fetchInfiniteQuery(options as ReturnType<typeof providerBrowseQuery>);
      else await client.fetchQuery(options as ReturnType<typeof providerPageQuery>);
      live = false; now += 25_000;
      const before = reads.length;
      const observer = infinite ? new InfiniteQueryObserver(client, options as ReturnType<typeof providerBrowseQuery>) : new QueryObserver(client, options as ReturnType<typeof providerPageQuery>);
      const stop = observer.subscribe(() => {}); await settle();
      assert(reads.length === before + 1, "Twitch remount retained stale live data");
      const data = observer.getCurrentResult().data as any;
      assert((infinite ? data.pages[0] : data).items[0].live === false, "Remount did not show offline");
      stop(); client.clear();
    }
    live = true; render(); await settle();
    assert(summary?.hits?.[0]?.live, "Initial live result missing");
    const query = new InfiniteQueryObserver(client, providerBrowseQuery(credentials, "twitch", { query: "fixture" }));
    await query.fetchNextPage(); await settle();
    const beforeRefresh = reads.length;
    live = false; generation++;
    await advance();
    assert(reads.length === beforeRefresh + 2, "Active infinite query must refresh both retained pages");
    assert(reads.at(-2)?.cursor === "" && reads.at(-1)?.cursor === "next-1", "Refresh reused an obsolete cursor");
    assert(summary?.hits?.[0]?.live === false, "Mounted results did not change to offline");
    render(false); await settle();
    let before = reads.length; await advance(); assert(reads.length === before, "Inactive source polled");
    render(true, false); await settle();
    before = reads.length; await advance(); assert(reads.length === before, "Disconnected view polled");
    render(); await settle(); focusManager.setFocused(false);
    before = reads.length; await advance(); assert(reads.length === before, "Background view polled");
    focusManager.setFocused(true); await settle();
    before = reads.length; await advance(); assert(reads.length === before + 2, "Foreground refresh did not resume");
    render(true, true, "twitch", true); await settle();
    before = reads.length; await advance(); assert(reads.length === before + 1, "Opened Twitch page did not poll exactly once");
    render(true, true, "bandcamp"); await settle();
    before = reads.length; await advance(); assert(reads.length === before, "Other provider polled");
    flushSync(() => root.render(null)); await settle();
    before = reads.length; await advance(); assert(reads.length === before, "Unmounted view polled");
    return { passed: true, requests: reads.length, intervalMs: 20_000, refreshedCursors: ["", "next-1"], suppressed: ["inactive", "disconnected", "background", "other provider", "unmounted"] };
  } finally {
    root.unmount(); host.remove(); client.clear();
    window.fetch = originalFetch; Date.now = realNow; focusManager.setFocused(undefined);
    // Keep one timer provider for the test lifetime, then restore its native methods.
    intervals.clear();
    timers.setInterval = (run, delay) => window.setInterval(run, delay);
    timers.clearInterval = id => window.clearInterval(id);
  }
}
