// On an empty Vite page, import this module and call runPlayerTransitionRegression().
// Real shell, player and router; session state is a paused local fixture, with no Core.
import { createRoot } from "react-dom/client";
import { useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useLocation, useMatches } from "@tanstack/react-router";
import { AppShell } from "../src/client/sections/shell/AppShell";
import { PlayerPage } from "../src/client/sections/now/PlayerPage";
import { RemotePage } from "../src/client/sections/remote/RemotePage";
import { RemotePlayerSession } from "../src/client/session/remote-player-session";
import { readPlayerSearch } from "../src/client/session/player-control";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { deviceId } from "../src/client/session/device-id";

const wait = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const finished = (transition: ViewTransition | undefined) => Promise.race([
  transition?.finished,
  wait(3000).then(() => { throw new Error("Player transition did not finish within 3 seconds"); }),
]);
export async function runPlayerTransitionRegression(inspect?: (surface: string) => Promise<void>) {
  const host = document.getElementById("fixture")!;
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const id = deviceId();
  const tvId = "t".repeat(43);
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
  const route = createRootRoute({ component: () => <RemotePlayerSession><AppShell /><CommitProbe /></RemotePlayerSession> });
  const home = createRoute({ getParentRoute: () => route, path: "/", component: () => <h1>Transition fixture</h1> });
  const now = createRoute({ getParentRoute: () => route, path: "/now", validateSearch: readPlayerSearch,
    component: () => {
      const { queue } = now.useSearch();
      const navigate = now.useNavigate();
      return <PlayerPage queueOpen={queue === true} onQueueOpenChange={open => void navigate({ search: previous => ({ ...previous, queue: open || undefined }), replace: true, state: previous => previous })} />;
    } });
  const remote = createRoute({ getParentRoute: () => route, path: "/remote", component: RemotePage });
  const router = createRouter({ routeTree: route.addChildren([home, now, remote]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  const transitions: ViewTransition[] = [];
  const snapshots: { phase: string; names: ReturnType<typeof names> }[] = [];
  const failures: string[] = [];
  let journey = "";
  const timing: { phase: string; journey: string; url: string; presented: string[]; remote: boolean; bar: boolean; player: boolean }[] = [];
  const capture = (phase: string) => {
    if (!journey) return;
    timing.push({ phase, journey, url: router.state.location.href, presented: router.state.matches.map(match => match.routeId),
      remote: !!host.querySelector("[data-remote-page]"), bar: !!host.querySelector("[data-now-playing]"), player: !!host.querySelector("[data-player-band]") });
  };
  function CommitProbe() {
    useLocation();
    useMatches();
    useLayoutEffect(() => capture("commit"));
    return null;
  }
  const observer = new MutationObserver(() => capture("mutation"));
  observer.observe(host, { childList: true, subtree: true });
  let frame: number;
  const sampleFrame = () => { capture("frame"); frame = requestAnimationFrame(sampleFrame); };
  frame = requestAnimationFrame(sampleFrame);
  const start = document.startViewTransition.bind(document);
  const names = () => [...document.querySelectorAll<HTMLElement>("[data-player-band], [data-now-playing]")].map(element => ({
    element: element.hasAttribute("data-player-band") ? "player" : "bar", name: getComputedStyle(element).viewTransitionName,
    rendered: element.checkVisibility(),
  }));
  // Each shared control's own transition name, so it glides from the bar to its place in the band: the bar's Open player
  // into fullscreen's slot (couch-last).
  const shared = (selector: string) => [...host.querySelectorAll<HTMLElement>(`${selector} button, ${selector} [data-player-last]`)]
    .filter(element => element.checkVisibility()).map(element => getComputedStyle(element).viewTransitionName).filter(name => name !== "none");
  let barNames: string[] = [];
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
      if (i === 0) barNames = shared("[data-now-playing]");
      // The title and the bar's last slot open the player alike; below 360px the bar leaves the slot out for the title.
      const expand = host.querySelector<HTMLButtonElement>('[data-now-playing] [data-player-last]');
      (i === 1 && expand?.checkVisibility() ? expand : host.querySelector<HTMLButtonElement>('[aria-label="Open player: Transition fixture"]')!).click();
      await wait();
      await finished(transitions.at(-1));
      if (!host.querySelector("[data-player-band]")) throw new Error(`No fixture player: ${host.textContent}`);
      if (i === 0) {
        const bandNames = shared("[data-player-band]");
        if (!bandNames.includes("couch-last") || innerWidth >= 360 && !barNames.includes("couch-last")) failures.push("The bar's Open player and the band's last slot must share couch-last");
        const missing = barNames.filter(name => !bandNames.includes(name));
        if (missing.length) failures.push(`Bar controls with no place in the band: ${missing.join(", ")}`);
        await inspect?.("player");
      }
      await router.navigate({ to: "/", viewTransition: true });
      await finished(transitions.at(-1));
    }
    if (snapshots.length !== 12) failures.push("Three round trips must capture twelve snapshots");
    snapshots.forEach((snapshot, index) => {
      const named = snapshot.names.filter(element => element.rendered && element.name === "couch-player-band");
      const expected = index % 4 === 0 || index % 4 === 3 ? "bar" : "player";
      if (named.length !== 1 || named[0]?.element !== expected) failures.push(`${snapshot.phase} snapshot ${index} needs exactly one ${expected}`);
    });
    // Remote Up next and Back use ordinary navigation, not a view transition.
    // Observe actual commits/mutations as well as frames; URL and presented matches can differ.
    if (!gate.tvPresentation) {
      const remoteGate = { ...gate, state: { ...gate.state!, controlling: tvId,
        devices: [...(gate.state!.devices ?? []), { id: tvId, name: "Fixture TV", tv: true, online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }],
        outputs: [{ deviceId: tvId, picture: true, sound: true }],
        playbacks: gate.state!.playbacks?.map(playback => ({ ...playback, outputs: [{ deviceId: tvId, picture: true, sound: true }] })),
      } };
      root.render(<SessionGateContext value={remoteGate}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></SessionGateContext>);
      await wait();
      journey = "Home to Remote";
      const clickTab = (path: string) => {
        const tab = [...host.querySelectorAll<HTMLAnchorElement>(`[data-app-nav] a[href="${path}"]`)].find(element => element.checkVisibility());
        if (!tab) throw new Error(`No visible tab for ${path}`);
        tab.click();
      };
      clickTab("/remote");
      await wait(250);
      await inspect?.("remote");
      for (let i = 0; i < 3; i++) {
        journey = `Remote Up next to Now ${i}`;
        const upNext = host.querySelector<HTMLButtonElement>('[data-remote-page] button[aria-label="Up next"]');
        if (!upNext || upNext.disabled) throw new Error("Remote Up next is not ready");
        upNext.click();
        await wait(250);
        if (router.state.location.search.queue !== true || router.state.location.search.targetDeviceId !== tvId
          || !host.querySelector('[data-page="Now"][data-queue-open]')) failures.push("Remote Up next must open its target's queue");
        if (i === 0) await inspect?.("remote-player");
        journey = `Now Back to Remote ${i}`;
        const back = host.querySelector<HTMLButtonElement>('[aria-label="Back to Remote"]');
        if (!back) throw new Error("No Back to Remote button");
        back.click();
        await wait(250);
        if (router.state.location.pathname !== "/remote" || !host.querySelector("[data-remote-page]")) failures.push("Back must return to Remote");
      }
      journey = "Remote to Home";
      clickTab("/");
      await wait(250);
      if (!host.querySelector("[data-now-playing]")) failures.push("Home must restore the bar");
      if (transitions.length !== 6) failures.push("Remote navigation must not start view transitions");
      timing.forEach((sample, index) => {
        if (sample.remote && sample.bar) failures.push(`${sample.journey} ${sample.phase} ${index} mounted a bar on Remote`);
      });
    }
    return { passed: !failures.length, failures, snapshots, timing };
  } finally { observer.disconnect(); cancelAnimationFrame(frame); document.startViewTransition = start; root.unmount(); client.clear(); }
}
