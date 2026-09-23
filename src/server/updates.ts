import { readFileSync } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { join } from "node:path";
import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateState, UpdateTransaction } from "../shared/updates";
import { ControllerError, settingField } from "./controllers";
import { UpdateError, type UpdateFeed, type UpdateRelease } from "./update-feed";

type Automation = {
  busy: () => boolean;
  idle: () => string | null;
  status: (requestId?: string) => Promise<UpdateTransaction | null>;
  install: (candidateId: string, requestId: string, guard: () => void) => Promise<UpdateTransaction>;
};
type Attempt = { candidateId: string; requestId: string };
const finished = new Set(["succeeded", "failed", "restored", "operator-required"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function createUpdates(directory: string, running: UpdateState["running"], feed?: UpdateFeed<UpdateRelease>, interval = 15 * 60_000, admitted = () => true, automation?: Automation) {
  const state: UpdateState = { running, installationUnavailable: feed?.installationUnavailable, channel: "stable", policy: "manual", status: feed ? "idle" : "unavailable", currentCheck: false, lastSuccessfulCheck: null, candidate: null, error: feed ? null : "Updates require a supported installed Couch app." };
  let attempt: Attempt | null = null;
  try {
    const saved = JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"));
    if (!["stable", "preview"].includes(saved.channel) || !["manual", "idle"].includes(saved.policy)) throw new Error();
    state.channel = saved.channel; state.policy = saved.policy;
    if (saved.attempt && /^[a-f0-9]{64}$/.test(saved.attempt.candidateId) && /^[a-f0-9]{32}$/.test(saved.attempt.requestId)) attempt = saved.attempt;
    state.lastSuccessfulCheck = typeof saved.lastSuccessfulCheck === "number" ? saved.lastSuccessfulCheck : null;
    const c = saved.candidate;
    if (c && /^[a-f0-9]{64}$/.test(c.id) && typeof c.notes === "string" && typeof c.version === "string" && typeof c.revision === "string" && typeof c.releaseId === "string" && [c.bytes, c.publishedAt].every(Number.isSafeInteger) && (c.expiresAt === undefined || Number.isSafeInteger(c.expiresAt))) state.candidate = c;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { state.status = "failed"; state.error = "Saved update settings could not be read. Select your channel again to save it."; }
  }
  let candidate: UpdateRelease | null = null;
  let job: Promise<void> | undefined;
  let changing = false, closed = false;
  let saving: Promise<void> | undefined;
  const shutdown = new AbortController();
  const persist = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = await open(join(directory, "settings.json.tmp"), "w", 0o600);
    try { await file.writeFile(JSON.stringify({ channel: state.channel, policy: state.policy, candidate: state.candidate, attempt, lastSuccessfulCheck: state.lastSuccessfulCheck })); await file.sync(); }
    finally { await file.close(); }
    await rename(join(directory, "settings.json.tmp"), join(directory, "settings.json"));
    const folder = await open(directory, "r");
    try { await folder.sync(); } finally { await folder.close(); }
  };
  const busy = () => !!job || changing || closed || !admitted() || !!automation?.busy();
  const start = (kind: "checking" | "downloading") => {
    if (!feed || busy()) return;
    const wasReady = state.status === "ready", previousId = candidate?.summary.id;
    state.status = kind; state.error = null; state.progress = null;
    if (kind === "checking") state.currentCheck = false;
    job = (async () => {
      const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(kind === "checking" ? 120_000 : 30 * 60_000)]);
      if (kind === "checking") {
        candidate = await feed.check(state.channel, signal);
        state.candidate = candidate?.summary ?? null;
        state.lastSuccessfulCheck = Date.now();
        await persist();
        state.currentCheck = true;
        state.status = candidate ? (candidate.staged ?? (wasReady && previousId === candidate.summary.id)) ? "ready" : "available" : "idle";
      } else {
        await feed.stage(candidate!, signal, progress => { state.progress = progress; });
        state.candidate = candidate!.summary;
        await persist();
        state.status = "ready";
      }
    })().catch(error => {
      if (!closed) {
        state.status = "failed";
        state.error = error instanceof UpdateError ? error.message : "Could not complete the update operation. Check this installation's storage and feed enrollment, then retry.";
      }
    }).finally(() => { job = undefined; });
  };
  let polling: Promise<void> | undefined;
  const automatic = () => polling ??= (async () => {
    if (!automation || closed || !admitted()) return;
    try {
      const latest = await automation.status();
      if ((!attempt || attempt.candidateId !== candidate?.summary.id) && latest && candidate && latest.candidateId === candidate.summary.id && !latest.idleDeferred && ["failed", "operator-required", "restored"].includes(latest.phase)) { state.waiting = "This release failed or required recovery. Use a newer release or review the result before a manual retry."; return; }
      if (state.policy !== "idle") { state.waiting = null; return; }
      if (busy()) { state.waiting = "Waiting for the current update operation."; return; }
      const id = candidate?.summary.id;
      if (attempt && attempt.candidateId === id) {
        const previous = await automation.status(attempt.requestId);
        if (previous && (!finished.has(previous.phase) || !previous.idleDeferred)) {
          state.waiting = finished.has(previous.phase) ? "This release already had an automatic attempt. Review its result or use Install now." : "Waiting for the accepted update transaction.";
          return;
        }
        if (previous?.idleDeferred) attempt = null;
      }
      if (state.policy !== "idle" || busy()) return;
      if (state.status === "available" && state.currentCheck && candidate && (candidate.summary.expiresAt === undefined || candidate.summary.expiresAt > Date.now())) start("downloading");
      if (state.status !== "ready" || !state.currentCheck || !id || (candidate!.summary.expiresAt !== undefined && candidate!.summary.expiresAt <= Date.now())) { state.waiting = "Waiting for a current verified download."; return; }
      state.waiting = automation.idle();
      if (state.waiting) return;
      if (!attempt || attempt.candidateId !== id) {
        const previous = attempt;
        changing = true; attempt = { candidateId: id, requestId: crypto.randomUUID().replaceAll("-", "") };
        try { saving = persist(); await saving; }
        catch (error) { attempt = previous; throw error; }
        finally { changing = false; saving = undefined; }
      }
      const guard = () => {
        if (closed || !admitted() || state.policy !== "idle" || automation.idle()) throw new ControllerError("Waiting for Couch to become idle again.", 409);
      };
      guard();
      await automation.install(id, attempt!.requestId, guard);
      state.waiting = "The native updater accepted the idle installation.";
    } catch { if (!closed) state.waiting = "Automatic installation is waiting. Check the update result and this installation's connection."; }
  })().finally(() => { polling = undefined; });
  const automaticTimer = automation ? setInterval(() => void automatic(), 30_000) : undefined;
  automaticTimer?.unref();
  const startup = feed ? setTimeout(() => start("checking"), 1_000) : undefined;
  const timer = feed ? setInterval(() => start("checking"), interval) : undefined;
  return {
    get state() { return structuredClone(state); },
    automatic,
    canRepair: () => !busy(),
    candidateReady: (id: string) => !busy() && state.status === "ready" && state.currentCheck && candidate?.summary.id === id && (candidate.summary.expiresAt === undefined || candidate.summary.expiresAt > Date.now()),
    async handle(request: Request, identity: () => ControllerIdentity | null) {
      const authorize = () => {
        if (!admitted()) throw new ControllerError("This installation is preparing an update. Controls are paused.", 503);
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
        if (caller.authority === "controller") throw new ControllerError("An administrator is required to manage updates.", 403);
      };
      try {
        authorize();
        const path = new URL(request.url).pathname;
        if (path === "/api/updates" && request.method === "GET") return json(state);
        if (!["/api/updates/channel", "/api/updates/policy", "/api/updates/check", "/api/updates/stage"].includes(path)) return json({ error: "Not found." }, 404);
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
        if (!feed) throw new ControllerError("Updates require a supported installed Couch app.", 409);
        const field = path.endsWith("/channel") ? "channel" : path.endsWith("/policy") ? "policy" : path.endsWith("/check") ? "check" : "candidateId";
        const value = await settingField(request, field);
        authorize();
        if (busy()) throw new ControllerError("An update operation is already running. Wait for it to finish.", 409);
        if (field === "policy") {
          if (value !== "manual" && value !== "idle") throw new ControllerError("Choose Manual or Auto when idle.");
          if (value === "idle" && !automation) throw new ControllerError(feed.installationUnavailable ?? "Complete the signed Couch installation before enabling automatic installation.", 409);
          const previous = state.policy;
          changing = true; state.policy = value;
          try { saving = persist(); await saving; state.waiting = value === "idle" ? "Waiting for a current verified download and ten idle minutes." : null; }
          catch (error) { state.policy = previous; throw error; }
          finally { changing = false; saving = undefined; }
        } else if (field === "channel") {
          if (value !== "stable" && value !== "preview") throw new ControllerError("Choose Stable or Preview.");
          const previous = { ...state };
          changing = true;
          try {
            state.channel = value; state.candidate = null; state.currentCheck = false; state.lastSuccessfulCheck = null; state.status = "idle"; state.error = null;
            saving = persist();
            await saving; candidate = null;
          } catch (error) { Object.assign(state, previous); throw error; }
          finally { changing = false; saving = undefined; }
          start("checking");
        } else if (field === "check") {
          if (value !== true) throw new ControllerError("Confirm Check now.");
          start("checking");
        } else {
          if (!candidate || !state.currentCheck || value !== candidate.summary.id || (candidate.summary.expiresAt !== undefined && candidate.summary.expiresAt <= Date.now())) throw new ControllerError("This candidate is no longer current. Use Check now before downloading.", 409);
          start("downloading");
        }
        return json(state, 202);
      } catch (error) {
        return json({ error: error instanceof ControllerError ? error.message : "Could not save update settings. Check this installation's storage and retry." }, error instanceof ControllerError ? error.status : 500);
      }
    },
    async close() { closed = true; clearTimeout(startup); clearInterval(timer); clearInterval(automaticTimer); shutdown.abort(); await Promise.allSettled([job, saving, polling]); },
  };
}
