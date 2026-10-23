// Empty Vite fixture only. Production routes and shell; all updater requests are intercepted.
import { mountUiAudit } from "./ui-audit.browser";
import { deviceId } from "../src/client/session/device-id";
import { updateBatchKey } from "../src/client/session/update-batch";
import { dismissAll } from "../src/client/toasts";
import { applyTvNavigation } from "../src/client/navigation";
import type { UpdateState } from "../src/shared/updates";
import type { HelperUpdates } from "../src/shared/helper-updates";

const wait = () => new Promise(resolve => setTimeout(resolve, 200));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const settled = async (condition: () => boolean) => {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) await wait();
  assert(condition(), `Updater did not settle: ${condition.toString()}`);
};
const current: UpdateState = { version: "0.4.0-preview.2", available: null, channel: "preview", status: "up-to-date", progress: null, checkedAt: 1, error: null };
const cue = () => document.querySelector<HTMLElement>("[data-update-cue]");
const toast = () => document.querySelector('[data-sonner-toast]:not([data-removed="true"])')?.textContent;

export async function mountUpdateShellAudit(completed = false) {
  dismissAll();
  const key = updateBatchKey(location.origin, "visual-fixture", deviceId());
  const previous = localStorage.getItem(key);
  if (completed) localStorage.setItem(key, JSON.stringify({ createdAt: Date.now(), helpers: "updated", items: [] }));
  else localStorage.removeItem(key);
  const audit = await mountUiAudit();
  let targets = [{ id: "host", name: "Living room", tv: false }, { id: "tv", name: "Bedroom TV", tv: true }];
  const states: Record<string, UpdateState> = { host: { ...current }, tv: { ...current } };
  let toolResult: "current" | "updated" | "error" = "current";
  let toolReadsFail = false;
  let failedChecks: string[] = [];
  let tools: HelperUpdates = { status: "done", checkedAt: 1, items: [{ name: "yt-dlp", version: "2026.10.20", origin: "managed", status: "current", error: null }] };
  const requests: string[] = [];
  const uiFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href), id = url.searchParams.get("device")!;
    if (!url.pathname.startsWith("/api/updates")) return uiFetch(input, init);
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname === "/api/updates/targets") return Response.json(targets);
    if (url.pathname === "/api/updates/helpers/check") {
      tools = { ...tools, status: "checking" };
      return Response.json(tools);
    }
    if (url.pathname === "/api/updates/helpers") {
      if (toolReadsFail) return Response.json({ error: "This Couch does not support media tool maintenance." }, { status: 404 });
      if (tools.status === "checking") tools = { status: "done", checkedAt: Date.now(), items: [{ ...tools.items[0]!, status: toolResult, error: toolResult === "error" ? "Couldn’t download yt-dlp. Try again." : null }] };
      return Response.json(tools);
    }
    if (url.pathname === "/api/updates/releases") return Response.json({ more: false, releases: [{ version: "0.4.0-preview.3", publishedAt: "2026-10-23", url: "https://github.com/avoid-quest/couch/releases", items: ["Keep updates in one place and clear completed results automatically."] }] });
    if (url.pathname === "/api/updates/install") states[id] = { ...states[id]!, version: states[id]!.available!, available: null, status: "up-to-date" };
    if (url.pathname === "/api/updates/check" && failedChecks.includes(id)) return Response.json({ error: "Couldn’t check this device. Try again." }, { status: 503 });
    if (url.pathname === "/api/updates/channel") states[id] = { ...states[id]!, channel: JSON.parse(String(init?.body)).channel };
    return Response.json(states[id]);
  };
  await audit.updateSession(gate => ({ ...gate, details: { ...gate.details!, updates: true }, state: { ...gate.state!, playbacks: [] } }));
  audit.client.setQueryData(["updates", "targets"], targets);
  for (const id of ["host", "tv"]) audit.client.setQueryData(["updates", id], states[id]);
  audit.client.setQueryData(["updates", "helpers"], tools);
  await wait();
  return {
    ...audit, requests, key,
    async ready(ids = ["tv"]) {
      for (const id of ids) { states[id] = { ...current, status: "ready", available: "0.4.0-preview.3" }; audit.client.setQueryData(["updates", id], states[id]); }
      await wait();
    },
    async current() { for (const id of ["host", "tv"]) { states[id] = { ...current }; audit.client.setQueryData(["updates", id], states[id]); } await wait(); },
    tools(result: typeof toolResult) { toolResult = result; },
    async toolsUnavailable(value: boolean) { toolReadsFail = value; await audit.client.refetchQueries({ queryKey: ["updates", "helpers"] }); await wait(); },
    checksFail(value: boolean, ids = targets.map(target => target.id)) { failedChecks = value ? ids : []; },
    async disconnect(id: string) {
      targets = targets.filter(target => target.id !== id);
      await audit.client.refetchQueries({ queryKey: ["updates", "targets"] }); await wait();
    },
    close() { audit.close(); dismissAll(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); },
  };
}

export async function runDisconnectedUpdateRegression() {
  const audit = await mountUpdateShellAudit();
  try {
    await audit.go("/settings/couch/updates");
    audit.checksFail(true, ["tv"]);
    await audit.click("Check for updates");
    await settled(() => !!document.body.textContent?.includes("Couldn’t check this device"));
    await settled(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Check for updates" && !button.disabled));
    await audit.go("/saved");
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playbacks: [] } }));
    assert(cue()?.getAttribute("aria-label") === "Update failed", "A connected device's failed check is hidden");
    await audit.disconnect("tv");
    assert(!cue(), "A disconnected device leaves an orphaned failure cue");
    await audit.go("/settings/couch/updates");
    assert(!document.body.textContent?.includes("Bedroom TV"), "The disconnected updater is still listed");
    await audit.click("Check for updates");
    await settled(() => toast() === "Everything is up to date");
    await audit.go("/saved");
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playbacks: [] } }));
    assert(!cue(), "A successful check of the remaining devices keeps an orphaned failure cue");
    return "Passed: failed checks stay visible only for current update targets; remaining devices can be checked successfully.";
  } finally { audit.close(); }
}

export async function runUpdateShellRegression() {
  const audit = await mountUpdateShellAudit(true);
  try {
    await audit.go("/");
    assert(!cue() && !toast() && localStorage.getItem(audit.key) === null, "A restored successful check was not retired quietly");
    assert(!document.body.textContent?.includes("Dismiss results"), "A successful check requires dismissal");
    await audit.updateSession(gate => ({ ...gate, error: "Couldn’t play this item." }));
    const first = [...document.querySelectorAll<HTMLElement>('[data-page-first]')].find(element => element.checkVisibility())!;
    first.focus();
    for (let step = 0; step < 4 && document.activeElement?.getAttribute("aria-label") !== "Dismiss" && !document.activeElement?.closest(".app-header-controls"); step++) { applyTvNavigation("up"); await wait(); }
    assert(document.activeElement?.getAttribute("aria-label") === "Dismiss", "A remote cannot reach the notice above Home");
    await audit.updateSession(gate => ({ ...gate, error: null, status: "build-mismatch" }));
    first.focus();
    for (let step = 0; step < 4 && document.activeElement?.textContent !== "Try again" && !document.activeElement?.closest(".app-header-controls"); step++) { applyTvNavigation("up"); await wait(); }
    assert(document.activeElement?.textContent === "Try again", "A remote cannot recover after the Couch was updated");
    await audit.updateSession(gate => ({ ...gate, status: "connected" }));
    const stage = document.querySelector<HTMLElement>('[data-stage="home"]')!;
    const before = stage.getBoundingClientRect().top;
    const height = document.querySelector(".app-header")!.getBoundingClientRect().height;
    await audit.ready();
    await audit.toolsUnavailable(true);
    const link = cue()!, box = link.getBoundingClientRect();
    assert(link.getAttribute("aria-label") === "Update ready" && link.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), "Home's update cue is missing or covered");
    await audit.current();
    assert(!cue(), "An older server's background tool read is presented as a failed update");
    await audit.ready(); await audit.toolsUnavailable(false);
    assert(Math.abs(stage.getBoundingClientRect().top - before) < 1 && document.querySelector(".app-header")!.getBoundingClientRect().height === height, "Update availability shifts Home's artwork or header");
    // The cue is in the header's regular keyboard/remote order.
    const available = cue()!;
    available.focus(); applyTvNavigation("right"); await wait(); applyTvNavigation("left"); await wait();
    assert(document.activeElement === available, "The update cue is not reachable by remote");
    await audit.go("/saved");
    assert(cue()?.getAttribute("aria-label") === "Update ready", "Saved uses a different update entry");
    await audit.click("Update ready");
    await settled(() => !!document.querySelector("[data-update-review]"));
    assert(!cue() && !document.querySelector('[role="dialog"]'), "The cue opened a duplicate update surface");
    assert(document.querySelectorAll('[data-settings-page="updates"], [data-settings-page="device-updates"]').length === 1, "Settings has duplicate Updates entries");
    assert(!document.querySelector('[role="checkbox"]'), "One available update needs a selection step");
    assert([...document.querySelectorAll("button")].some(button => button.textContent === "Update Bedroom TV"), "One update does not name its device");
    assert(!document.body.textContent?.includes("Device settings"), "Channel settings still use a separate device picker");
    await audit.click("What’s new");
    assert(!document.querySelector('[role="dialog"]'), "Release notes opened another update surface");
    await audit.current();
    assert(!document.body.textContent?.includes("What’s new") && !document.body.textContent?.includes("Update media tools"), "Idle Updates still contains unrelated actions");
    await audit.click("Check for updates");
    await settled(() => toast() === "Everything is up to date");
    assert(!audit.requests.some(request => request.includes("/install")), "Check for updates restarted an app");
    assert(document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])').length === 1, "A check produced duplicate success feedback");
    const deadline = Date.now() + 7_000;
    while (toast() && Date.now() < deadline) await wait();
    assert(!toast(), "Successful check feedback did not disappear on its own");
    audit.tools("updated");
    await audit.click("Check for updates");
    await settled(() => toast() === "Media tools updated");
    await audit.ready(["host", "tv"]);
    await audit.go("/saved");
    assert(cue()?.getAttribute("aria-label") === "2 updates ready", "The cue does not count ready devices");
    await audit.click("2 updates ready");
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playbacks: [] } }));
    await audit.click("Update 2 devices");
    await settled(() => toast() === "Updated 2 devices");
    assert(localStorage.getItem(audit.key) === null && !document.querySelector('[role="checkbox"]'), "Successful installs left a persistent batch or selection");
    await audit.go("/");
    assert(!cue(), "Successful updates left a permanent header cue");
    dismissAll(); audit.tools("error");
    await audit.go("/settings/couch/updates");
    await audit.click("Check for updates");
    await settled(() => !!document.body.textContent?.includes("Couldn’t download yt-dlp"));
    assert(!toast(), "A failed check showed a success toast");
    await audit.go("/saved");
    assert(cue()?.getAttribute("aria-label") === "Update failed", "A failed check lost its route to recovery");
    await audit.click("Update failed"); audit.tools("current");
    await audit.click("Check for updates");
    await settled(() => toast() === "Everything is up to date");
    assert(!document.body.textContent?.includes("Couldn’t download yt-dlp"), "A successful retry retained stale failure details");
    dismissAll(); audit.checksFail(true);
    await audit.click("Check for updates");
    await settled(() => !!document.body.textContent?.includes("Couldn’t check this device"));
    await settled(() => [...document.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Check for updates" && !button.disabled));
    audit.checksFail(false);
    await audit.client.refetchQueries({ queryKey: ["updates", "host"] });
    await audit.client.refetchQueries({ queryKey: ["updates", "tv"] });
    await wait();
    assert(!document.body.textContent?.includes("Couldn’t check this device"), "Recovered device reads retain a stale check error");
    await audit.ready(); await audit.toolsUnavailable(true);
    await audit.click("Update Bedroom TV");
    await settled(() => toast() === "Updated Bedroom TV. Media tools weren’t checked.");
    assert(localStorage.getItem(audit.key) === null, "A skipped tools check leaves a completed result to dismiss");
    await audit.toolsUnavailable(false);
    await audit.ready(["host", "tv"]);
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, playbacks: [] } }));
    const installs = audit.requests.filter(request => request.includes("/install")).length;
    await audit.click("Update 2 devices");
    await audit.updateSession(gate => ({ ...gate, identity: { ...gate.identity!, authority: "controller" } }));
    await settled(() => audit.router.state.location.pathname === "/settings/device");
    assert(JSON.parse(localStorage.getItem(audit.key)!).helpers === "failed", "Losing admin leaves an active update spinning indefinitely");
    assert(audit.requests.filter(request => request.includes("/install")).length === installs, "An update continued restarting apps after admin was revoked");
    assert(!document.querySelector('[data-settings-page="updates"], [data-settings-page="device-updates"]'), "A browser without admin still has an unusable Updates page");
    return "Passed: one update destination and header cue, unchanged Home geometry, single-device action, clear availability, one check for tools/apps, timed success toasts, retired batch storage, visible failures and retry, role changes.";
  } finally { audit.close(); }
}
