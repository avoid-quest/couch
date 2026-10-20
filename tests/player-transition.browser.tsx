// On an empty Vite page, import this module and call runPlayerTransitionRegression().
// Real shell, player and router; session state is a paused local fixture, with no Core.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/client/sections/shell/AppShell";
import { PlayerPage } from "../src/client/sections/now/PlayerPage";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { deviceId } from "../src/client/session/device-id";

const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const finished = (transition: ViewTransition | undefined) => Promise.race([
  transition?.finished,
  wait(3000).then(() => { throw new Error("Player transition did not finish within 3 seconds"); }),
]);
export async function runPlayerTransitionRegression(inspect?: () => Promise<void>) {
  const host = document.getElementById("fixture")!;
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const id = deviceId();
  const gate = {
    credentials: { origin: location.origin, token: "fixture", installationId: "fixture" },
    connected: true, status: "connected", nativeHost: false, localHost: false,
    tvPresentation: document.documentElement.hasAttribute("data-tv"),
    queryClient: client, identity: { authority: "controller", device: { id, name: "Fixture" } },
    videoQualityPreference: { quality: "auto" }, run: async () => true, setError: () => {}, seekBy: () => {},
    state: {
      installationName: "Transition fixture", playback: "p", controlling: id, currentEntryId: "e",
      queue: [{ id: "e", title: "Transition fixture", source: "https://example.com/fixture.mp4", duration: 120 }],
      player: { status: "paused", playbackId: "p", speed: 1, volume: 50, tracks: [] },
      devices: [{ id, name: "Fixture", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }],
      outputs: [{ deviceId: id, picture: true, sound: true }],
      playbacks: [{ id: "p", title: "Transition fixture", status: "paused", outputs: [{ deviceId: id, picture: true, sound: true }] }],
      liveSources: [], preferences: {}, activeProfile: { id: "default", name: "Default" }, profiles: [],
    },
  } as unknown as SessionGateValue;
  const route = createRootRoute({ component: AppShell });
  const home = createRoute({ getParentRoute: () => route, path: "/", component: () => <h1>Transition fixture</h1> });
  const now = createRoute({ getParentRoute: () => route, path: "/now", component: PlayerPage });
  const router = createRouter({ routeTree: route.addChildren([home, now]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  const transitions: ViewTransition[] = [];
  const snapshots: { phase: string; names: ReturnType<typeof names> }[] = [];
  const failures: string[] = [];
  const start = document.startViewTransition.bind(document);
  const names = () => [...document.querySelectorAll<HTMLElement>("[data-player-band], [data-now-playing]")].map(element => ({
    element: element.hasAttribute("data-player-band") ? "player" : "bar", name: getComputedStyle(element).viewTransitionName,
    rendered: element.checkVisibility(),
  }));
  document.startViewTransition = ((update: () => Promise<void>) => {
    snapshots.push({ phase: "before", names: names() });
    const transition = start(async () => { await update(); snapshots.push({ phase: "after", names: names() }); });
    transitions.push(transition);
    transition.ready.catch(error => failures.push(`${error.name}: ${error.message}`));
    return transition;
  }) as typeof document.startViewTransition;
  try {
    root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></SessionGateContext>);
    await wait(500);
    if (!host.querySelector("[data-now-playing]")) throw new Error(`No fixture bar: ${host.textContent}`);
    for (let i = 0; i < 3; i++) {
      host.querySelector<HTMLButtonElement>('[aria-label="Open player: Transition fixture"]')!.click();
      await wait();
      await finished(transitions.at(-1));
      if (!host.querySelector("[data-player-band]")) throw new Error(`No fixture player: ${host.textContent}`);
      if (i === 0) await inspect?.();
      await router.navigate({ to: "/", viewTransition: true });
      await finished(transitions.at(-1));
    }
    if (snapshots.length !== 12) failures.push("Three round trips must capture twelve snapshots");
    snapshots.forEach((snapshot, index) => {
      const named = snapshot.names.filter(element => element.rendered && element.name === "couch-player-band");
      const expected = index % 4 === 0 || index % 4 === 3 ? "bar" : "player";
      if (named.length !== 1 || named[0]?.element !== expected) failures.push(`${snapshot.phase} snapshot ${index} needs exactly one ${expected}`);
    });
    return { passed: !failures.length, failures, snapshots };
  } finally { document.startViewTransition = start; root.unmount(); client.clear(); }
}
