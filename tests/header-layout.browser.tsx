// Bundle into an isolated browser with the production stylesheet. No Core, capture permissions or installed data.
// The driver varies viewport, --interface-scale and caption geometry, then calls set() without remounting the shell.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellChrome, type ShellValue } from "../src/client/sections/shell/AppShell";
import { ShellContext } from "../src/client/sections/shell/shell-context";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { UpdateCenterProvider } from "../src/client/session/update-center";
import { Stage, StageTitle } from "../src/client/components/Stage";
import { isTvPresentation } from "../src/client/session/presentation";
import { deviceId, saveLocalDeviceName } from "../src/client/session/device-id";
import type { SearchScope } from "../src/client/search-palette";

type Options = { sharing: boolean; viewers: number; long: boolean; nativeHost: boolean; offline: boolean; updates: boolean; sound: boolean; section: "Home" | "Remote" };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const noop = () => {};

export async function mountHeaderLayout() {
  await saveLocalDeviceName("Couch Dev QA");
  const root = createRoot(document.getElementById("root")!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const originalFetch = window.fetch;
  window.fetch = async () => Response.json([]);
  // Synthetic source preview, never getDisplayMedia/getUserMedia.
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#243b42"; ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = "#dfb58a"; ctx.fillRect(16, 16, 112, 148);
  ctx.fillStyle = "#e8e8e8"; ctx.font = "18px sans-serif"; ctx.fillText("Source preview", 142, 55);
  const stream = canvas.captureStream(0);
  const soundStream = new MediaStream();
  let options: Options = { sharing: false, viewers: 0, long: false, nativeHost: true, offline: false, updates: false, sound: false, section: "Home" };
  let update!: (value: Options) => void;
  let setScope!: (value: SearchScope | null) => void;
  const tvPresentation = isTvPresentation();
  document.body.classList.toggle("tv-presentation", tvPresentation);
  localStorage.setItem("couch.show-share", "true");
  const source = () => ({ id: "header-source", deviceId: "header-device", kind: options.sound ? "microphone" : "screen", name: options.long ? "A very long shared window name · Couch QA Controller · Screen" : "Couch QA Controller · Screen", audio: true, video: !options.sound });
  const current = () => options.sharing ? { source: source(), stream: options.sound ? soundStream : stream, since: Date.now(), quality: "1080p", muted: false, surface: "window" } : null;
  const endLive = async () => { options = { ...options, sharing: false }; update(options); };

  function Fixture() {
    const [config, setConfig] = useState(options);
    const [searchScope, setSearchScope] = useState<SearchScope | null>(null);
    update = setConfig; setScope = setSearchScope;
    const viewers = Array.from({ length: config.viewers }, (_, i) => ({ id: `viewer-${i}`, name: `Living room ${i + 1}`, online: true, volume: 50, muted: false, sharing: { audio: true, video: true } }));
    const gate = {
      nativeHost: config.nativeHost, localHost: false, tvPresentation, connected: true, status: config.offline ? "reconnecting" : "connected", pairingRequired: false, error: null,
      credentials: { origin: location.origin, token: "fixture", installationId: "header-fixture" }, details: { name: "Couch Dev QA" }, identity: { authority: "administrator" },
      state: { installationName: config.long ? "A very long Couch installation name" : "Couch Dev QA", devices: [{ id: deviceId(), name: "Couch Dev QA", tv: true }, ...viewers], queue: [], player: { status: "idle" },
        liveSources: config.sharing ? [source()] : [], playbacks: [{ id: "sharing", status: "playing", liveSourceId: "header-source", outputs: viewers.map(viewer => ({ deviceId: viewer.id, picture: true, sound: true })) }] },
      localLiveSourceId: config.sharing ? "header-source" : null, liveSharing: { current, routes: async () => ({}), setMuted: noop, setQuality: async () => {} },
      endLive, run: async () => true, setError: noop, videoQualityPreference: { quality: "auto" }, seekBy: noop,
    } as unknown as SessionGateValue;
    const shell = { section: config.section, statusLabel: "Connected", active: false, current: null, recentRadio: [], searchScope, setSearchScope,
      sectionUrl: (name: string) => name === "Home" ? "/" : `/${name.toLowerCase()}`, changeSection: noop, focusSearch: noop, openPlayer: noop,
    } as unknown as ShellValue;
    return <QueryClientProvider client={client}><SessionGateContext value={gate}><UpdateCenterProvider><ShellContext value={shell}>
      <ShellChrome><div data-page="Home">
        <Stage thumbnail="" shape="square" title="Your next film" size="home"><StageTitle title="Your next film" /><p className="mt-3 text-body text-muted-foreground">In your library</p></Stage>
        <div style={{ height: 700 }} /><button id="header-focus-target">Focus target</button><div style={{ height: 900 }} />
      </div></ShellChrome>
    </ShellContext></UpdateCenterProvider></SessionGateContext></QueryClientProvider>;
  }
  const rootRoute = createRootRoute({ component: Fixture });
  const routeTree = rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: "/" })]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  root.render(<RouterProvider router={router} />);
  await frame(); await frame();
  return {
    async set(next: Partial<Options>) {
      options = { ...options, ...next }; update(options);
      // UpdateCue uses the real provider, seeded locally without API work.
      client.setQueryData(["updates", "targets"], options.updates ? [{ id: "fixture-update", name: "TV" }] : []);
      client.setQueryData(["updates", "fixture-update"], { status: "ready", available: { version: "0.5.0" } });
      await frame();
    },
    async tokens(enabled: boolean) { setScope(enabled ? { kind: "films", source: "StreamingCommunity" } : null); await frame(); },
    async open(open: boolean) {
      const input = document.querySelector<HTMLInputElement>("#media-search")!;
      if (open) { input.focus(); if (tvPresentation) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }
      else { input.blur(); document.querySelector<HTMLElement>("#header-focus-target")!.focus({ preventScroll: true }); }
      await frame();
    },
    async stop() { await endLive(); await frame(); },
    close() { root.unmount(); stream.getTracks().forEach(track => track.stop()); client.clear(); window.fetch = originalFetch; },
  };
}

export async function runHeaderSharingRegression() {
  const fixture = await mountHeaderLayout();
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  try {
    const share = document.querySelector(".app-header-share-entry")!.getBoundingClientRect();
    const search = document.querySelector(".app-header-search")!.getBoundingClientRect();
    assert(share.right <= search.left, "Share must stay to the left of search");
    const primary = document.querySelector<HTMLElement>(".app-header-controls")!;
    const zoom = Number(getComputedStyle(document.getElementById("root")!).zoom);
    const pageGutter = parseFloat(getComputedStyle(document.querySelector(".app-page .isolate")!).paddingRight);
    assert(parseFloat(getComputedStyle(primary).paddingRight) === pageGutter, "Captions must not reserve a right rail beside Search");
    const clock = primary.querySelector("time");
    const right = clock ? clock.getBoundingClientRect().left - parseFloat(getComputedStyle(primary).columnGap) * zoom
      : primary.getBoundingClientRect().right - pageGutter * zoom;
    assert(Math.abs(search.right - right) < 1, "Search must fill the primary row to its right gutter or TV clock");
    assert(!primary.querySelector('[aria-label="Keyboard shortcuts"]'), "Shortcuts must not occupy the primary row");
    await fixture.tokens(true);
    await fixture.open(true);
    const input = document.querySelector<HTMLInputElement>("#media-search")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Keep this draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
    input.setSelectionRange(2, 7);
    const geometry = () => JSON.stringify([...document.querySelectorAll('.app-header-couch, .app-header-search, .app-header-search [data-slot="input-group"], #media-search, [data-app-nav] a')]
      .map(element => element.getBoundingClientRect().toJSON()));
    const before = geometry();
    for (const viewers of [0, 1, 2, 100]) for (const long of [false, true]) {
      await fixture.set({ sharing: true, viewers, long });
      assert(geometry() === before, "Sharing changed primary navigation or search geometry");
      assert(document.querySelector("#media-search") === input, "Sharing remounted search");
      assert(input.value === "Keep this draft" && document.activeElement === input && input.selectionStart === 2 && input.selectionEnd === 7, "Sharing lost draft, focus or selection");
      assert(document.querySelectorAll("[data-search-token]").length === 2, "Sharing lost scope tokens");
      const capsule = document.querySelector<HTMLElement>("[data-live-sharing]")!;
      assert(capsule.getBoundingClientRect().top >= input.getBoundingClientRect().bottom, "Sharing joined the primary row");
      assert(capsule.hasAttribute("data-tv-local-only"), "Sharing lost its TV local-only marker");
      assert(!!capsule.querySelector<HTMLVideoElement>("video")?.srcObject, "Sharing lost its source preview");
      assert(!!capsule.querySelector(`[aria-label="${viewers} watching"]`) === !!viewers, "Sharing lost its viewer count");
    }
    await fixture.set({ offline: true, updates: true });
    assert(geometry() === before, "Status text changed primary navigation or search geometry");
    document.querySelector<HTMLButtonElement>('[title="Stop sharing"]')!.click();
    await frame();
    assert(!document.querySelector("[data-live-sharing]") && geometry() === before, "Stop changed primary geometry or left an active row");
    assert(document.activeElement === input && input.value === "Keep this draft", "Stop lost the search draft or focus");
    return "Passed: sharing, names, 0/1/2/100 viewers, status and Stop preserve primary geometry, mounted search, draft, tokens, focus and selection.";
  } finally { fixture.close(); }
}
