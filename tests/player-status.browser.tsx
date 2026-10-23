// Import on an empty Vite page with #fixture. Uses the production player and routing.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AppShell } from "../src/client/sections/shell/AppShell";
import { PlayerPage } from "../src/client/sections/now/PlayerPage";
import { SessionGateContext } from "../src/client/session/gate-context";
import { UpdateCenterProvider } from "../src/client/session/update-center";
import type { SessionGateValue } from "../src/client/session/session-context";
import { isTvPresentation } from "../src/client/session/presentation";
import { deviceId } from "../src/client/session/device-id";
import type { PlayerState } from "../src/shared/protocol";

const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
export async function mountPlayerReview() {
  const root = createRoot(document.getElementById("fixture")!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const id = deviceId();
  const entry = { id: "concert", title: "Khruangbin: Tiny Desk Concert", source: "web:https://www.youtube.com/watch?v=vWLJeqLPfSU", duration: 900,
    thumbnail: "https://i.ytimg.com/vi/vWLJeqLPfSU/hqdefault.jpg", subtitle: "NPR Music", creator: {title: "NPR Music", url: "https://www.youtube.com/@nprmusic"},
    collection: {title: "Tiny Desk concerts", url: "https://www.youtube.com/playlist?list=PL1B627337ED6F55F0", index: 0} };
  let gate = {
    credentials: { origin: location.origin, token: "fixture", installationId: "fixture" }, connected: true, status: "connected", nativeHost: false, localHost: false,
    tvPresentation: isTvPresentation(), queryClient: client, identity: { authority: "controller", device: { id, name: "Studio" } },
    videoQualityPreference: { quality: "auto" }, run: async () => true, setError: () => {}, seekBy: () => {},
    state: {
      installationName: "Studio", playback: "p", controlling: id, currentEntryId: entry.id,
      queue: [entry, {...entry, id: "next", title: "The next concert", collection: {...entry.collection, index: 1}}],
      player: { status: "paused", playbackId: "p", speed: 1, volume: 50, position: 120, duration: 900, seekable: true, tracks: [], error: null },
      devices: [{ id, name: "Studio", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }],
      outputs: [{ deviceId: id, picture: false, sound: true }],
      playbacks: [{ id: "p", title: entry.title, status: "paused", audioOnly: true, outputs: [{ deviceId: id, picture: false, sound: true }] }],
      liveSources: [], preferences: {}, activeProfile: { id: "default", name: "Default" }, profiles: [],
    },
  } as unknown as SessionGateValue;
  const route = createRootRoute({ component: () => <UpdateCenterProvider><AppShell /></UpdateCenterProvider> });
  const home = createRoute({ getParentRoute: () => route, path: "/", component: () => <h1>Home</h1> });
  const now = createRoute({ getParentRoute: () => route, path: "/now", component: PlayerPage });
  const collection = createRoute({ getParentRoute: () => route, path: "/collection", component: () => <h1>Related content</h1> });
  const router = createRouter({ routeTree: route.addChildren([home, now, collection]), history: createMemoryHistory({initialEntries: ["/now"]}) });
  const render = () => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider></SessionGateContext>);
  render(); await wait(500);
  return {
    async state(status: PlayerState["status"], options: {connected?: boolean; buffering?: boolean; retry?: boolean; video?: boolean} = {}) {
      gate = {...gate, connected: options.connected ?? true, state: {...gate.state!,
        radioRetry: options.retry ? {retryAt: Date.now() + 5000, attempt: 2, maximum: 5} : undefined,
        outputs: [{deviceId: id, picture: options.video ?? false, sound: true}],
        playbacks: [{...gate.state!.playbacks![0]!, audioOnly: !options.video}],
        player: {...gate.state!.player, status, buffering: options.buffering, error: status === "error" ? "The source stopped responding. Try again or play the next item." : null},
      }};
      render(); await wait();
    },
    router,
    close() { root.unmount(); client.clear(); },
  };
}

export async function runPlayerStatusRegression() {
  const review = await mountPlayerReview();
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  try {
    let positions: { x: number; y: number }[] | undefined;
    for (const status of ["playing", "paused", "loading", "error", "ended", "unavailable"] as const) {
      await review.state(status);
      const buttons = [...document.querySelectorAll<HTMLElement>('[aria-label="Playback controls"] button')];
      assert(buttons.length === 3, `${status}: transport slots missing`);
      const current = buttons.map(button => {
        const rect = button.getBoundingClientRect();
        assert(rect.width >= 44 && rect.height >= 44, `${status}: transport touch target too small`);
        assert(rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, `${status}: transport outside viewport`);
        return { x: Math.round(rect.x), y: Math.round(rect.y) };
      });
      if (positions) assert(JSON.stringify(current) === JSON.stringify(positions), `${status}: transport moved`);
      positions = current;
      // Playing and Paused are the transport's to say; every other status follows the artwork's title, never in the band.
      if (status === "playing" || status === "paused") assert(!document.querySelector('[data-player-status]'), `${status}: plain status repeats the transport`);
      else assert(document.querySelector('[data-player-audio-copy] [data-player-status]') && !document.querySelector('[data-player-band] [data-player-status]'), `${status}: status left the artwork's copy`);
      assert(document.querySelector('[data-player-summary]'), `${status}: artwork summary disappeared`);
    }
    // The band's tools, left to right as shown, and the centre of what is shown in a slot.
    const phone = innerWidth < 640;
    const labels = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].filter(button => button.getClientRects().length)
      .toSorted((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(button => button.getAttribute("aria-label"));
    const centre = (selector: string) => { const element = [...document.querySelectorAll(selector)].find(item => item.getClientRects().length); if (!element) return NaN; const rect = element.getBoundingClientRect(); return Math.round(rect.left + rect.width / 2); };
    const topTools = () => labels('[data-player-top] button:not([aria-label^="Back"])');
    // The band's tools are the bar's, sound, then content, then view: Volume (not on phones), Where it plays, Up next, the
    // gear. The top line holds no tools. Beside artwork there is no fullscreen, so its last slot stays empty, holding the
    // bar's x; on phones, whose bar has no tools to line up with, the slot goes and the tools end at the gutter.
    const barTools = [...phone ? [] : ["Volume"], "Where it plays", "Up next", "Playback"];
    assert(JSON.stringify(topTools()) === JSON.stringify([]), `Top line tools: ${topTools().join(", ")}`);
    assert(JSON.stringify(labels("[data-player-tools] button")) === JSON.stringify(barTools), `Artwork band tools out of the bar's order: ${labels("[data-player-tools] button").join(", ")}`);
    if (phone) assert(!document.querySelector("[data-player-tools] span[data-player-last]")?.getClientRects().length, "Artwork band keeps an empty slot on a phone");
    else assert(centre("[data-player-tools] span[data-player-last]") > centre('[data-player-tools] [aria-label="Playback"]'), "Artwork band lost fullscreen's empty slot after the gear");
    for (const button of document.querySelectorAll<HTMLElement>('.player-control-row button')) {
      const rect = button.getBoundingClientRect();
      assert(rect.left >= 0 && rect.right <= innerWidth, "A player tool requires horizontal scrolling");
    }
    await review.state("loading", {buffering: true, video: true});
    // Phones leave Volume out of the row (display: none), so only the shown controls are measured.
    const controls = [...document.querySelectorAll<HTMLElement>('.player-control-row button')].filter(button => button.getClientRects().length).map(button => button.getBoundingClientRect());
    // Play/Pause is the band's one large control, so the row is one line by its centres.
    const middle = (rect: DOMRect) => rect.y + rect.height / 2;
    assert(controls.every(rect => Math.abs(middle(rect) - middle(controls[0]!)) < 1), "Player controls wrap onto another row");
    assert(controls.every(rect => rect.left >= 0 && rect.right <= innerWidth && rect.width >= 44), "Video controls overflow or shrink touch targets");
    const ordered = controls.toSorted((a, b) => a.left - b.left);
    assert(ordered.every((rect, index) => index === 0 || rect.left >= ordered[index - 1]!.right), "Player touch targets overlap");
    // Over a video the band's tools are the now-playing bar's, then fullscreen last, bottom right, in the slot where the
    // bar has Open player. Subtitles and Audio live in the gear's menu, not a button of their own.
    assert(JSON.stringify(labels("[data-player-tools] button")) === JSON.stringify([...barTools, "Enter fullscreen"]), `Player tools out of the bar's order: ${labels("[data-player-tools] button").join(", ")}`);
    assert(JSON.stringify(topTools()) === JSON.stringify([]), `Top line tools: ${topTools().join(", ")}`);
    // The transport is centred, as in the bar; phones, with no room to centre it beside four tools, lead with it.
    const transport = [...document.querySelectorAll<HTMLElement>('[aria-label="Playback controls"] button')].map(button => button.getBoundingClientRect());
    assert(phone ? transport[0]!.left < 16 : Math.abs((transport[0]!.left + transport.at(-1)!.right) / 2 - innerWidth / 2) < 1, "Band transport is out of place");
    // Over a picture buffering is a spinner centred on it, its words for screen readers only.
    assert(document.querySelector('.player-page > [data-player-status] [role="status"]')?.textContent?.includes("Buffering") && !document.querySelector('[data-player-band] [data-player-status]'), "Buffering not announced over the picture");
    // The gear's menu opens above the whole band, and the controls stay up while it is open over a playing video.
    await review.state("playing", {video: true});
    const gear = document.querySelector<HTMLButtonElement>('[data-player-tools] button[aria-label="Playback"]')!;
    gear.click(); await wait(400);
    assert(document.querySelector('[data-player-menu]')!.getBoundingClientRect().bottom <= document.querySelector('[data-player-band]')!.getBoundingClientRect().top, "Playback menu does not open above the band");
    await wait(4300);
    assert(document.querySelector('[data-player-top="shown"]') && document.querySelector('[data-player-band="shown"]'), "Controls hid under the open Playback menu");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await wait(300);
    assert(!document.querySelector('[data-player-menu][data-state="open"]') && document.activeElement === gear, "Esc did not close the menu onto the gear");
    await review.state("loading", {retry: true});
    assert(document.querySelector('[aria-label="Try again"]:not(:disabled)'), "Scheduled retry has no immediate remedy");
    const status = document.querySelector('[data-player-status]')!;
    assert(status.querySelector('[role="status"]')?.textContent === "Reconnecting…", "Retry status is not announced");
    const countdown = status.querySelector('[aria-live="off"]');
    assert(countdown?.textContent?.includes("Trying again in") && !countdown.closest('[role="status"]'), "Retry countdown repeats in the live region");
    await review.state("playing", {connected: false});
    assert(document.querySelector('[data-player-status]')?.textContent?.includes("Offline"), "Offline not announced");
    await review.state("paused");
    const link = [...document.querySelectorAll<HTMLAnchorElement>('[data-player-summary] [data-media-context] a')].find(link => link.textContent === "NPR Music");
    assert(link && !link.closest('button'), "Creator relationship is missing or nested in a button");
    link!.click(); await wait();
    assert(review.router.state.location.href.includes(encodeURIComponent("https://www.youtube.com/@nprmusic")), "One click did not reach creator");
    return "Player states keep fixed controls; buffering, retry, offline and one-click creator navigation passed.";
  } finally { review.close(); }
}
