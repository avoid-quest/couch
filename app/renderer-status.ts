import { renameSync, writeFileSync } from "node:fs";

// The window's own lifecycle in <data>/renderer-status.json, for `couch-session
// diagnose`: whether this run's page loaded, apart from Core's health and from
// what plays. "ready" means the page and its scripts loaded. A "remote" page that
// failed is another Couch that can't be reached, not a broken local app.
export type RendererState = "starting" | "loading" | "ready" | "failed" | "unresponsive" | "gone";
type Contents = { on(event: string, listener: (...args: any[]) => void): unknown };

export function rendererStatus(path: string, run: { run: string; version: string }, page: () => "local" | "remote") {
  const identity = { ...run, pid: process.pid, startedAt: new Date().toISOString() };
  let state: RendererState = "starting", failed = false, beforeHang: RendererState = "starting";
  const set = (next: RendererState, reason?: string) => {
    state = next;
    // Status never stops the app; the next change tries again.
    try {
      writeFileSync(`${path}.tmp`, JSON.stringify({ ...identity, state, page: page(), at: new Date().toISOString(), ...reason ? { reason } : {} }));
      renameSync(`${path}.tmp`, path);
    } catch {}
  };
  set("starting");
  return {
    // Main couldn't reach another Couch, so no page started loading.
    unreachable() { if (!failed) { failed = true; set("failed", "unreachable"); } },
    watch(contents: Contents) {
      contents.on("did-start-navigation", (_event, _url, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) { failed = false; set("loading"); }
      });
      // Chromium can finish loading its error page after a failure; that stays failed.
      contents.on("did-fail-load", (_event, code: number, description: string, _url, mainFrame: boolean) => {
        // ERR_ABORTED is a navigation replaced by another one.
        if (mainFrame && code !== -3) { failed = true; set("failed", `${code} ${description}`.replace(/[^\w -]/g, "").slice(0, 80)); }
      });
      contents.on("did-finish-load", () => { if (!failed) set("ready"); });
      contents.on("render-process-gone", (_event, details: { reason: string }) => set("gone", details.reason.replace(/[^\w-]/g, "").slice(0, 40)));
      contents.on("unresponsive", () => { if (state !== "unresponsive") beforeHang = state; set("unresponsive"); });
      contents.on("responsive", () => { if (state === "unresponsive") set(beforeHang); });
    },
  };
}
