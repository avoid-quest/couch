// Import on an empty Vite page and call runRadioCacheRegression().
// Exercises both navigation orders with the real detail and related-station components.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { ItemPage } from "../src/client/sections/details/ItemPage";
import { RelatedRadio } from "../src/client/components/RelatedRadio";
import { ShellContext } from "../src/client/sections/shell/shell-context";
import type { ShellValue } from "../src/client/sections/shell/AppShell";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
export async function runRadioCacheRegression(keepMounted = false) {
  const originalFetch = window.fetch;
  const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", sourceId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const station = { id, sourceId, name: "Fixture FM", url: "https://audio.example/fm", homepage: null, countryCode: "IT", codec: "MP3", bitrate: 128 };
  const reads: string[] = [];
  window.fetch = async input => {
    const { pathname } = new URL(String(input), location.href); reads.push(pathname);
    if (pathname === `/api/radio/stations/${id}`) return Response.json({ station });
    if (pathname === "/api/radio/playlists") return Response.json({ playlists: [{ id: sourceId, name: "My stations" }] });
    if (pathname.includes("/playlists/")) return Response.json({ stations: [station, { ...station, id: "cccccccc-cccc-4ccc-cccc-cccccccccccc", name: "Nearby FM" }] });
    return Response.json({ favorites: [], stations: [], items: [] });
  };
  const host = document.body.appendChild(document.createElement("main"));
  host.className = "mx-auto max-w-6xl p-6 text-foreground font-sans";
  const root = createRoot(host);
  const gate = { connected: true, run: async () => true, state: { devices: [], liveSources: [] } } as unknown as SessionGateValue;
  const shell = { credentials: { origin: location.origin, token: "fixture" }, available: true, section: "Home", sectionUrl: () => "/", enqueueRadio: async () => true } as unknown as ShellValue;
  let client: QueryClient | undefined;
  const dispose = () => { root.unmount(); client?.clear(); host.remove(); window.fetch = originalFetch; };
  try {
    for (const first of ["related", "details"] as const) {
      flushSync(() => root.render(null));
      client?.clear();
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const detailHref = `/item?kind=radio&id=${id}`;
      const route = createRootRoute({ component: Outlet });
      const related = createRoute({ getParentRoute: () => route, path: "/related", component: () => <RelatedRadio stationId={id} /> });
      const details = createRoute({ getParentRoute: () => route, path: "/item", component: ItemPage });
      const router = createRouter({ routeTree: route.addChildren([related, details]), history: createMemoryHistory({ initialEntries: [first === "related" ? "/related" : detailHref] }) });
      await router.load();
      root.render(<SessionGateContext value={gate}><ShellContext value={shell}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></ShellContext></SessionGateContext>);
      await settle();
      await router.navigate({ href: first === "related" ? detailHref : "/related" }); await settle();
      if (first === "related") assert(host.querySelector("h1")?.textContent === station.name, "Queue → station lost the details body");
      else assert(host.textContent?.includes("Nearby FM"), "Station → queue lost its playlist metadata");
      assert(!reads.includes("/api/radio/stations"), "A playlist station incorrectly fell back to the directory");
      await router.navigate({ href: detailHref }); await settle();
    }
    assert(document.documentElement.scrollWidth <= window.innerWidth, "Station details overflow the viewport");
    const result = { passed: true, stationReads: reads.filter(path => path === `/api/radio/stations/${id}`).length, directoryReads: 0, detailTitle: host.querySelector("h1")?.textContent, viewport: [innerWidth, innerHeight] };
    if (!keepMounted) dispose();
    return { ...result, dispose };
  } catch (error) { dispose(); throw error; }
}
