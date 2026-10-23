// Empty Vite fixture only. Every request is intercepted; no updater or installed data is touched.
// Mount in <div id="fixture"></div>, import the app stylesheet, then await mountUpdateReviewAudit().
// Call the returned run() to check interactions, or longError()/playing(true)/huge() to inspect layouts; close() cleans up.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { UpdateCenterProvider } from "../src/client/session/update-center";
import { Toaster } from "../src/client/components/ui/sonner";
import { dismissAll } from "../src/client/toasts";
import { UpdateReview } from "../src/client/sections/updates/UpdateReview";
import { useUpdateCenter, type UpdateCenterValue } from "../src/client/session/update-center";
import { restartTimeout, updateBatchKey, type UpdateBatch } from "../src/client/session/update-batch";
import { applyTvNavigation, useNavigation } from "../src/client/navigation";
import { deviceId } from "../src/client/session/device-id";
import type { UpdateState } from "../src/shared/updates";
import { UPDATE_INTERRUPTS_PLAYBACK } from "../src/shared/updates";

const wait = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const release = (version: string, items: string[]) => ({ version, items, publishedAt: "2026-10-21", url: `https://github.com/avoid-quest/couch/releases/tag/v${version}` });
// Stable skips 29 releases from 0.3.1 to 0.4.0; Preview offers one release with 40 changes, the first very long and the
// second under 140 characters of wide capitals, which wraps to four lines on a phone.
const long = `Rework how Couch hands playback between devices: ${"the server keeps one clock for every output, the phone and TV agree on where playback is, and nothing restarts while it moves. ".repeat(6)}`.trimEnd();
const wide = "WMV, MKV, WEBM, M4A AND MOV MEDIA NOW PLAYS ON WINDOWS, MACOS AND WEBOS TVS WITH HDMI CEC POWER, VOLUME AND MUTE WORKING AGAIN";
const releases = {
  latest: [
    { version: "0.5.0", items: ["Future release must not appear in the staged update notes."], publishedAt: "2026-10-23", url: "https://github.com/avoid-quest/couch/releases/tag/v0.5.0" },
    { version: "0.4.0", items: ["Keep synced sound playing smoothly when a phone’s screen is locked.", "Share a screen or sound from the header and see who is watching."], publishedAt: "2026-10-22", url: "https://github.com/avoid-quest/couch/releases/tag/v0.4.0" },
    ...Array.from({ length: 28 }, (_, index) => release(`0.3.${30 - index}`, [`Reconnect remotes faster after a network change, fix ${30 - index}.`])),
    { version: "0.3.2", items: ["Restore the device’s volume after reconnecting."], publishedAt: "2026-10-21", url: "https://github.com/avoid-quest/couch/releases/tag/v0.3.2" },
    release("0.3.1", ["Installed release, kept in the history."]),
  ],
  preview: [
    release("0.4.0-preview.3", ["Future preview must not appear in the staged update notes."]),
    release("0.4.0-preview.2", [long, wide, ...Array.from({ length: 38 }, (_, index) => `Preview change ${index + 3}.`)]),
    release("0.4.0-preview.1", ["Installed preview."]),
  ],
};
// The shell's arrow handling, which moves focus for the remote's D-pad.
function Navigation() { useNavigation(() => {}); return null; }
function Settings() { const { targets } = useUpdateCenter(); return <div className="mt-10 max-w-2xl" data-page="Settings"><div data-nav-content><UpdateReview targets={targets} /></div></div>; }

export async function mountUpdateReviewAudit() {
  dismissAll();
  const originalFetch = window.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const root = createRoot(document.getElementById("fixture")!);
  const requests: string[] = [];
  let rejectInstall = false;
  let notesFail = false;
  let notesMissing = false;
  const targets = [{ id: "host", name: "Living room server", tv: false }, { id: "tv", name: "Living room TV with a deliberately long device name", tv: true }];
  const updates = Object.fromEntries(targets.map(target => [target.id, { version: "0.3.1", available: "0.4.0", channel: "latest", status: "ready", progress: null, checkedAt: 1, error: null }])) as Record<string, UpdateState>;
  const helpers = { status: "done", checkedAt: 1, items: [{ name: "yt-dlp", version: "2026.10.20", origin: "managed", status: "current", error: null }, { name: "ffmpeg", version: "8.0", origin: "system", status: "system", error: null }] };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/updates/targets") return Response.json(targets);
    if (url.pathname === "/api/updates/helpers" || url.pathname === "/api/updates/helpers/check") return Response.json(helpers);
    if (url.pathname === "/api/updates/releases") return notesFail ? Response.json({ error: "Release server unavailable" }, { status: 503 })
      : url.searchParams.get("page") === "2" ? Response.json({ more: false, releases: [release("0.3.0", ["Second page of the release history."])] })
      : notesMissing ? Response.json({ more: true, releases: [] })
      : Response.json({ more: url.searchParams.get("channel") === "latest", releases: releases[url.searchParams.get("channel") as "latest" | "preview"] });
    const id = url.searchParams.get("device")!;
    if (url.pathname === "/api/updates/install") {
      if (rejectInstall && !url.searchParams.has("interrupt")) return Response.json({ error: UPDATE_INTERRUPTS_PLAYBACK, interruptionRequired: true }, { status: 409 });
      updates[id] = { ...updates[id]!, version: updates[id]!.available ?? updates[id]!.version, available: null, status: "up-to-date" };
    }
    if (url.pathname === "/api/updates" || url.pathname === "/api/updates/check" || url.pathname === "/api/updates/install") return Response.json(updates[id]);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  let gate = { credentials: { origin: location.origin, token: "update-ui-fixture", installationId: `update-ui-${Date.now()}` }, identity: { authority: "administrator", device: { id: deviceId() } }, connected: true, localHost: false, tvPresentation: false, details: { name: "Living room", updates: true }, state: { installationName: "Living room", player: { status: "idle" }, playbacks: [] } } as unknown as SessionGateValue;
  const render = () => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><UpdateCenterProvider><Navigation /><main className="p-6"><Settings /></main><Toaster /></UpdateCenterProvider></QueryClientProvider></SessionGateContext>);
  render(); await wait(); await wait();
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
  const huge = async () => {
    for (const target of targets) { updates[target.id] = { ...updates[target.id]!, status: "ready", channel: "preview", version: "0.4.0-preview.1", available: "0.4.0-preview.2" }; client.setQueryData(["updates", target.id], { ...updates[target.id] }); }
    await wait();
  };
  // The action stays inside the visible part of its scroller, above the footer, whatever the notes' length.
  const reachable = (element: Element, scroller: Element | null) => {
    const box = element.getBoundingClientRect(), view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight - parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-bar") || "0") };
    return box.top >= view.top && box.bottom <= view.bottom + 1;
  };
  const changes = (scope: Element) => scope.querySelectorAll("article li").length;
  return {
    requests,
    async playing(tv = false) { gate = { ...gate, tvPresentation: tv, state: { ...gate.state!, playbacks: [{ id: "music", title: "Music", status: "paused", outputs: [{ deviceId: deviceId(), sound: true, picture: true }] }] } }; render(); await wait(); },
    async longError() { updates.tv!.error = "The update could not be downloaded from https://example.invalid/a/very/long/path/that/must/wrap/without/hiding/the/device/controls. Try again when this device reconnects."; client.setQueryData(["updates", "tv"], { ...updates.tv }); await wait(); },
    huge,
    async run() {
      assert(!requests.some(request => request.includes("/releases")), "Notes were fetched before opening");
      button("What’s new").click(); await wait(); await wait();
      const review = document.querySelector("main [data-update-review]")!;
      assert(!document.querySelector('[role="dialog"]'), "Release notes opened a second updates surface");
      // Many skipped releases: a few changes from the newest releases, then every change in the exact range on request.
      assert(changes(review) <= 5 && review.querySelectorAll("article").length <= 3, `Preview showed ${changes(review)} changes`);
      assert(review.textContent?.includes("Couch 0.4.0") && !review.textContent?.includes("Restore the device’s volume"), "Preview did not start at the offered release");
      const toggle = button("Read all 31 changes");
      toggle.focus(); applyTvNavigation("select"); await wait();
      assert(document.activeElement === toggle && toggle.getAttribute("aria-expanded") === "true" && reachable(toggle, null), "Read all moved the focus");
      assert(changes(review) === 31 && review.querySelectorAll("article").length === 30, "Read all did not show the whole range");
      assert(review.textContent?.includes("Restore the device’s volume"), "Installed-to-staged range omitted an intermediate release");
      assert(!review.textContent?.includes("Future release must") && !review.textContent?.includes("Installed release"), "Notes included a release outside the range");
      assert(review.querySelector('a[href$="/v0.3.2"]'), "A release lost its GitHub link");
      assert(document.documentElement.scrollHeight > innerHeight && reachable(button("Update 2 devices"), null), "Update scrolled away with the notes");
      // Down walks the notes one release at a time, each clear of the actions that stay in view; Up returns.
      const actions = review.querySelector("[data-nav-footer]")!;
      for (let step = 0; step < 12; step++) {
        applyTvNavigation("down"); await wait();
        assert(!actions.contains(document.activeElement) && document.activeElement!.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top, `Down reached ${document.activeElement?.textContent} beneath or in the actions`);
      }
      assert(scrollY > 0 && document.activeElement?.closest("article")?.textContent?.includes("Couch 0.3.20"), "Down skipped a release");
      for (let step = 0; step < 12; step++) { applyTvNavigation("up"); await wait(); }
      assert(document.activeElement === toggle && reachable(toggle, null), `Up did not return to Read all: ${document.activeElement?.textContent}, toggle top ${toggle.getBoundingClientRect().top}`);
      applyTvNavigation("select"); await wait();
      assert(changes(review) <= 5 && toggle.textContent === "Read all 31 changes" && document.activeElement === toggle, "Show fewer did not return to the preview");
      button("Release history").click(); await wait();
      assert(review.textContent?.includes("Installed release") && reachable(button("Update 2 devices"), null), "History hid the installed release or the actions");
      button("Load older releases").click(); await wait(); await wait();
      assert(review.textContent?.includes("Second page of the release history"), "Older releases did not load");
      button("What’s new").click(); await wait();
      // One huge release: five changes, the long one cut to 140 characters, the rest on request, with Update in view.
      await huge(); document.documentElement.style.setProperty("--bottom-bar", "64px");
      button("What’s new").click(); await wait();
      const items = () => [...review.querySelectorAll("article li")].map(item => item.textContent!);
      assert(changes(review) === 5 && [...items()[0]!].length <= 140 && items()[0]!.endsWith("…") && long.startsWith(items()[0]!.slice(0, -1)) && !review.textContent?.includes("Future preview"), "Huge release preview was not compact");
      const shown = review.querySelectorAll("article li")[1]!, lines = shown.getBoundingClientRect().height / parseFloat(getComputedStyle(shown).lineHeight);
      assert(items()[1] === wide && (innerWidth >= 640 || lines > 3.5), `A short change of wide capitals was cut or hidden (${lines} lines)`);
      const more = button("Read all 40 changes");
      more.click(); await wait();
      assert(changes(review) === 40 && items()[0] === long && items()[1] === wide, "Read all kept a change cut");
      review.querySelectorAll("article li")[30]!.scrollIntoView({ block: "center" }); await wait();
      assert(scrollY > 0 && reachable(button("Update 2 devices"), null), "Update scrolled away from the long Settings notes");
      const idle = gate;
      gate = { ...gate, state: { ...gate.state!, playbacks: [{ id: "music", title: "Music", status: "paused", outputs: [{ deviceId: "tv", sound: true, picture: true }] }] } }; render(); await wait();
      button("Update 2 devices").click(); await wait();
      assert(reachable(button("Stop playback and update"), null) && reachable(review.querySelector('.sticky [role="alert"]')!, null), "Playback confirmation was out of view");
      button("Cancel").click(); gate = idle; render(); await wait();
      more.click(); await wait();
      assert(changes(review) === 5 && more.textContent === "Read all 40 changes", "Show fewer did not return to the preview");
      button("What’s new").click(); document.documentElement.style.removeProperty("--bottom-bar"); scrollTo(0, 0); await wait();
      notesFail = true; client.removeQueries({ queryKey: ["updates", "releases"] });
      button("What’s new").click(); await wait();
      assert(document.body.textContent?.includes("You can still update") && !button("Update 2 devices").disabled, "Notes failure blocked updates");
      gate = { ...gate, state: { ...gate.state!, playbacks: [{ id: "music", title: "Music", status: "paused", outputs: [{ deviceId: "tv", sound: true, picture: true }] }] } }; render(); await wait();
      button("Update 2 devices").click(); await wait();
      assert(button("Stop playback and update") && !requests.some(request => request.includes("/install")), "Known playback was not confirmed before an install");
      button("Cancel").click();
      document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]').forEach(checkbox => checkbox.click()); await wait();
      assert(button("Update devices").disabled && !button("Update media tools"), "Deselecting apps turned Update into unrelated tool maintenance");
      button("Check for updates").click(); await wait(); await wait();
      assert(!button("Stop playback and update") && !requests.some(request => request.includes("/install")), "Media tools interrupted playback");
      assert(requests.some(request => request === "POST /api/updates/helpers/check"), "Check for updates did not maintain media tools");
      assert(!button("View results") && !button("Dismiss results"), "A successful check needs manual dismissal");
      document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]').forEach(checkbox => checkbox.click());
      gate = { ...gate, state: { ...gate.state!, playbacks: [] } }; render(); await wait();
      rejectInstall = true;
      button("Update 2 devices").click(); await wait(); await wait();
      assert(button("Stop playback and update"), "Server interruption did not offer explicit confirmation");
      assert(!requests.some(request => request.includes("interrupt=1")), "Interruption was authorized silently");
      assert(review.textContent?.includes("Update failed"), "A failed batch lost its retry state");
      button("Stop playback and update").click(); await wait(); await wait();
      assert(requests.some(request => request.includes("interrupt=1")), "Confirmed interruption was not sent");
      assert(!document.querySelector('[role="checkbox"]') && !button("What’s new") && review.textContent?.includes("Up to date"), "Successful apps did not return to the idle state");
      assert(document.querySelector('[data-sonner-toast]')?.textContent === "Updated 2 devices", "Success did not produce a brief toast");
      assert(localStorage.getItem(updateBatchKey(location.origin, gate.credentials!.installationId!, deviceId())) === null, "Success left a persisted result to dismiss");
      assert(!button("View results") && !button("Dismiss results") && !document.querySelector('[data-status-line]'), "Successful app updates leave a persistent notice");
      notesFail = false; notesMissing = true;
      await huge(); if (button("What’s new").getAttribute("aria-expanded") !== "true") button("What’s new").click(); await wait();
      await client.resetQueries({ queryKey: ["updates", "releases"] }); await wait();
      assert(!document.body.textContent?.includes("No release notes found") && button("Load older releases"), "An empty first page was reported as the end of release history");
      button("Load older releases").click(); await wait(); await wait();
      assert(document.body.textContent?.includes("No release notes found for Couch"), "Exhausted history did not report missing notes");
      return "Passed: in-page notes, bounded preview and full history, sticky actions and TV focus, safe playback confirmation, one check for tools/apps, retryable failures, automatic completion retirement and success toast.";
    },
    close() { root.unmount(); client.clear(); window.fetch = originalFetch; dismissAll(); },
  };
}

// A real provider restored after its per-app deadline still reads the running version once, without resending.
export async function runUpdateResumeRegression() {
  const originalFetch = window.fetch;
  for (const installed of [true, false]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(document.getElementById("fixture")!);
    const installationId = `resume-${crypto.randomUUID()}`;
    const key = updateBatchKey(location.origin, installationId, deviceId());
    const startedAt = Date.now() - restartTimeout - 1_000;
    const saved: UpdateBatch = { createdAt: startedAt, helpers: "updated", items: [
      { id: "tv", name: "TV", version: "0.4.0", status: "installing", startedAt },
      { id: "host", name: "Server", version: "0.4.0", status: "waiting" },
    ] };
    localStorage.setItem(key, JSON.stringify(saved));
    const ready: UpdateState = { version: "0.3.1", available: "0.4.0", channel: "latest", status: "ready", progress: null, checkedAt: 1, error: null };
    const states: Record<string, UpdateState> = { tv: installed ? { ...ready, version: "0.4.0", available: null, status: "up-to-date" } : ready, host: ready };
    const installs: string[] = [];
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.origin), id = url.searchParams.get("device")!;
      if (url.pathname === "/api/updates/targets") return Response.json([{ id: "tv", name: "TV", tv: true }, { id: "host", name: "Server", tv: false }]);
      if (url.pathname === "/api/updates/helpers") return Response.json({ status: "done", checkedAt: 1, items: [] });
      if (url.pathname === "/api/updates/install" && init?.method === "POST") { installs.push(id); states[id] = { ...ready, version: "0.4.0", available: null, status: "up-to-date" }; }
      if (url.pathname === "/api/updates" || url.pathname === "/api/updates/install") return Response.json(states[id]);
      throw new Error(`Unexpected resume fixture request: ${url}`);
    };
    let center: UpdateCenterValue | undefined;
    function Observe() { center = useUpdateCenter(); return null; }
    const gate = { credentials: { origin: location.origin, token: "resume-fixture", installationId }, connected: true, localHost: false, identity: { authority: "administrator", device: { id: deviceId() } } } as unknown as SessionGateValue;
    try {
      root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><UpdateCenterProvider><Observe /></UpdateCenterProvider></QueryClientProvider></SessionGateContext>);
      const deadline = Date.now() + 4_000;
      while ((!center || center.busy) && Date.now() < deadline) await wait();
      assert(center && !center.busy, "A restored update did not settle");
      assert(JSON.stringify(installs) === JSON.stringify(installed ? ["host"] : []), "A saved install was resent or an unconfirmed app advanced the batch");
      assert(installed ? center.batch === null && localStorage.getItem(key) === null : center.batch?.items[0]?.status === "failed", "The running version was not observed or successful progress was not retired");
      assert(installed || center.batch?.items[1]?.status === "waiting", "The remaining server restarted without confirmation");
    } finally {
      root.unmount(); client.clear(); localStorage.removeItem(key); window.fetch = originalFetch;
    }
  }
  return "Passed: delayed resume confirms the running version without resending; an old version still times out and stops later restarts.";
}
