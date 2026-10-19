import { readFileSync, renameSync, writeFileSync } from "node:fs";

// The window's own lifecycle in <data>/renderer-status.json, for `couch-session
// diagnose`: whether this run's page works, apart from Core's health and from
// what plays. "page-loaded" means the document and its scripts loaded; "ready"
// means the page's app shell then mounted and said so (shellReady). A page that
// never does, such as an older Couch's, stays page-loaded. A "remote" page that
// failed is another Couch that can't be reached, not a broken local app.
export type RendererState = "starting" | "loading" | "page-loaded" | "ready" | "failed" | "unresponsive" | "gone";
type Contents = { on(event: string, listener: (...args: any[]) => void): unknown };

// This process as Linux knows it: its boot and its start in clock ticks since that boot.
// With the PID they name one process, whose clock changes or a reused PID can't fake;
// a diagnosis compares them with the running service's (packaging/tv/diagnose.js).
function kernelIdentity() {
  try {
    const stat = readFileSync("/proc/self/stat", "utf8");
    // Fields after the parenthesized name, which may hold spaces; the start time is the 22nd.
    const processStart = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return Number.isSafeInteger(processStart) && bootId ? { bootId, processStart } : {};
  } catch { return {}; }
}

export function rendererStatus(path: string, run: { run: string; version: string }, page: () => "local" | "remote") {
  const identity = { ...run, pid: process.pid, ...kernelIdentity(), startedAt: new Date().toISOString() };
  let state: RendererState = "starting", navigation = 0, committed = false, failed = false, beforeHang: RendererState = "starting";
  const set = (next: RendererState, reason?: string) => {
    state = next;
    // Status never stops the app; the next change tries again.
    try {
      writeFileSync(`${path}.tmp`, JSON.stringify({ ...identity, navigation, state, page: page(), at: new Date().toISOString(), ...reason ? { reason } : {} }));
      renameSync(`${path}.tmp`, path);
    } catch {}
  };
  set("starting");
  return {
    // Main couldn't reach another Couch, so no page started loading.
    unreachable() { if (!failed) { failed = true; set("failed", "unreachable"); } },
    // The main frame's mounted app shell. Main checks the sender is this window's
    // main frame; only the document the current navigation committed can count,
    // never one it replaced or a failed load's error page.
    acknowledge() {
      if (!committed || failed || !["loading", "page-loaded"].includes(state)) return false;
      set("ready");
      return true;
    },
    watch(contents: Contents) {
      contents.on("did-start-navigation", (_event, _url, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) { navigation++; committed = failed = false; set("loading"); }
      });
      // Main-frame cross-document commits only; the replaced document is gone.
      contents.on("did-navigate", () => { committed = true; });
      // Chromium can finish loading its error page after a failure; that stays failed.
      contents.on("did-fail-load", (_event, code: number, description: string, _url, mainFrame: boolean) => {
        // ERR_ABORTED is a navigation replaced by another one.
        if (mainFrame && code !== -3) { failed = true; set("failed", `${code} ${description}`.replace(/[^\w -]/g, "").slice(0, 80)); }
      });
      // The shell may mount before the load event finishes.
      contents.on("did-finish-load", () => { if (!failed && state === "loading") set("page-loaded"); });
      contents.on("render-process-gone", (_event, details: { reason: string }) => { failed = true; set("gone", details.reason.replace(/[^\w-]/g, "").slice(0, 40)); });
      contents.on("unresponsive", () => { if (state !== "unresponsive") beforeHang = state; set("unresponsive"); });
      contents.on("responsive", () => { if (state === "unresponsive") set(beforeHang); });
    },
  };
}
