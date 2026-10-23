// Empty Vite fixture only. Every request is intercepted; no updater or installed data is touched.
// Mount in <div id="fixture"></div>, import the app stylesheet, then await mountUpdateReviewAudit().
// Call the returned run() to check interactions, or longError()/playing(true) to inspect layouts; close() cleans up.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { UpdateCenterProvider } from "../src/client/session/update-center";
import { UpdateNotice } from "../src/client/sections/updates/UpdateNotice";
import { UpdateReview } from "../src/client/sections/updates/UpdateReview";
import { useUpdateCenter } from "../src/client/session/update-center";
import { applyTvNavigation } from "../src/client/navigation";
import { deviceId } from "../src/client/session/device-id";
import type { UpdateState } from "../src/shared/updates";
import { UPDATE_INTERRUPTS_PLAYBACK } from "../src/shared/updates";

const wait = () => new Promise(resolve => setTimeout(resolve, 150));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
function Settings() { const { targets } = useUpdateCenter(); return <div className="mt-10 max-w-2xl"><UpdateReview targets={targets} /></div>; }

export async function mountUpdateReviewAudit() {
  const originalFetch = window.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const root = createRoot(document.getElementById("fixture")!);
  const requests: string[] = [];
  let rejectInstall = false;
  let notesFail = false;
  const targets = [{ id: "host", name: "Living room server", tv: false }, { id: "tv", name: "Living room TV with a deliberately long device name", tv: true }];
  const updates = Object.fromEntries(targets.map(target => [target.id, { version: "0.3.1", available: "0.4.0", channel: "latest", status: "ready", progress: null, checkedAt: 1, error: null }])) as Record<string, UpdateState>;
  const helpers = { status: "done", checkedAt: 1, items: [{ name: "yt-dlp", version: "2026.10.20", origin: "managed", status: "current", error: null }, { name: "ffmpeg", version: "8.0", origin: "system", status: "system", error: null }] };
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/updates/targets") return Response.json(targets);
    if (url.pathname === "/api/updates/helpers" || url.pathname === "/api/updates/helpers/check") return Response.json(helpers);
    if (url.pathname === "/api/updates/releases") return notesFail ? Response.json({ error: "Release server unavailable" }, { status: 503 }) : Response.json({ more: false, releases: [
      { version: "0.5.0", items: ["Future release must not appear in the staged update notes."], publishedAt: "2026-10-23", url: "https://github.com/avoid-quest/couch/releases/tag/v0.5.0" },
      { version: "0.4.0", items: ["Keep synced sound playing smoothly when a phone’s screen is locked.", "Share a screen or sound from the header and see who is watching."], publishedAt: "2026-10-22", url: "https://github.com/avoid-quest/couch/releases/tag/v0.4.0" },
      { version: "0.3.2", items: ["Restore the device’s volume after reconnecting."], publishedAt: "2026-10-21", url: "https://github.com/avoid-quest/couch/releases/tag/v0.3.2" },
    ] });
    const id = url.searchParams.get("device")!;
    if (url.pathname === "/api/updates/install") {
      if (rejectInstall && !url.searchParams.has("interrupt")) return Response.json({ error: UPDATE_INTERRUPTS_PLAYBACK, interruptionRequired: true }, { status: 409 });
      updates[id] = { ...updates[id]!, version: "0.4.0", available: null, status: "up-to-date" };
    }
    if (url.pathname === "/api/updates" || url.pathname === "/api/updates/install") return Response.json(updates[id]);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  let gate = { credentials: { origin: location.origin, token: "update-ui-fixture", installationId: `update-ui-${Date.now()}` }, identity: { authority: "administrator", device: { id: deviceId() } }, connected: true, localHost: false, tvPresentation: false, details: { name: "Living room", updates: true }, state: { installationName: "Living room", player: { status: "idle" }, playbacks: [] } } as unknown as SessionGateValue;
  const render = () => root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><UpdateCenterProvider><main className="p-6"><UpdateNotice /><Settings /></main></UpdateCenterProvider></QueryClientProvider></SessionGateContext>);
  render(); await wait(); await wait();
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!;
  return {
    requests,
    async playing(tv = false) { gate = { ...gate, tvPresentation: tv, state: { ...gate.state!, playbacks: [{ id: "music", title: "Music", status: "paused", outputs: [{ deviceId: deviceId(), sound: true, picture: true }] }] } }; render(); await wait(); },
    async longError() { updates.tv!.error = "The update could not be downloaded from https://example.invalid/a/very/long/path/that/must/wrap/without/hiding/the/device/controls. Try again when this device reconnects."; client.setQueryData(["updates", "tv"], { ...updates.tv }); await wait(); },
    async run() {
      assert(!requests.some(request => request.includes("/releases")), "Notes were fetched before opening");
      const opener = button("Review update"); opener.focus(); opener.click(); await wait(); await wait();
      const dialog = document.querySelector('[role="dialog"]')!;
      assert(dialog?.contains(document.activeElement), "Dialog did not take focus");
      assert(dialog.textContent?.includes("Restore the device’s volume"), "Installed-to-staged range omitted an intermediate release");
      assert(!dialog.textContent?.includes("Future release must"), "Notes included a later unstaged update");
      applyTvNavigation("back"); await wait();
      assert(document.activeElement === opener, "TV Back did not restore opener focus");
      button("Later").click(); await wait();
      assert(!button("Review update") && button("What’s new"), "Later removed the settings entry");
      notesFail = true; client.removeQueries({ queryKey: ["updates", "releases"] });
      button("What’s new").click(); await wait();
      assert(document.body.textContent?.includes("You can still update") && !button("Update 2 devices").disabled, "Notes failure blocked updates");
      gate = { ...gate, state: { ...gate.state!, playbacks: [{ id: "music", title: "Music", status: "paused", outputs: [{ deviceId: "tv", sound: true, picture: true }] }] } }; render(); await wait();
      button("Update 2 devices").click(); await wait();
      assert(button("Stop playback and update") && !requests.some(request => request.includes("/install")), "Known playback was not confirmed before an install");
      button("Cancel").click();
      document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]').forEach(checkbox => checkbox.click()); await wait();
      button("Update media tools").click(); await wait(); await wait();
      assert(!button("Stop playback and update") && !requests.some(request => request.includes("/install")), "Media tools interrupted playback");
      button("Dismiss results").click();
      document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]').forEach(checkbox => checkbox.click());
      gate = { ...gate, state: { ...gate.state!, playbacks: [] } }; render(); await wait();
      rejectInstall = true;
      button("Update 2 devices").click(); await wait(); await wait();
      assert(button("Stop playback and update"), "Server interruption did not offer explicit confirmation");
      assert(!requests.some(request => request.includes("interrupt=1")), "Interruption was authorized silently");
      assert(button("View results"), "A failed batch disappeared after Later");
      button("Stop playback and update").click(); await wait(); await wait();
      assert(requests.some(request => request.includes("interrupt=1")), "Confirmed interruption was not sent");
      assert(document.body.textContent?.includes("2 of 2 devices updated"), "Confirmed installed versions were not reported");
      return "Passed: lazy/exact notes, note failure independence, TV focus and Back, Later/settings, API409 confirmation, persistent failed results, confirmed completion.";
    },
    close() { root.unmount(); client.clear(); window.fetch = originalFetch; },
  };
}
