import { lstatSync } from "node:fs";

export type MaintenanceBuild = { version: string; revision: string; dataFormat: number };
type Candidate = MaintenanceBuild & { candidateId: string };
type Context = Partial<Candidate> & { updateId: string; nonce: string; phase: string; disrupted: boolean; committed: boolean; confirmInterrupt: boolean };
type Options = {
  build: MaintenanceBuild;
  context: () => Promise<unknown>;
  player: () => string;
  quiesce: () => Promise<{ progressSaved: boolean; admissionClosed: boolean }>;
  database: () => Promise<void>;
  native: (nonce: string) => Promise<MaintenanceBuild>;
  frontend: () => MaintenanceBuild | null;
};
const error = () => new Error("The TV could not verify its private maintenance state.");
const phases = new Set(["accepted", "preflight", "installing", "quiescing", "trial", "committing", "operator-required", "restoring"]);
const token = (value: unknown) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const sameBuild = (left: MaintenanceBuild, right: MaintenanceBuild) => left.version === right.version && left.revision === right.revision && left.dataFormat === right.dataFormat;

// An environment variable or a browser request cannot activate phone updates.
// The root SSH activation command creates this persistent flag.
export function manualUpdatesEnabled() {
  try {
    const directory = lstatSync("/etc/couch");
    const flag = lstatSync("/etc/couch/manual-updates.enabled");
    if (!directory.isDirectory() || directory.uid !== 0 || directory.mode & 0o022 || !flag.isFile() || flag.uid !== 0 || flag.mode & 0o022) throw error();
    return true;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error();
  }
}

export function createMaintenance(options: Options) {
  let mode: "starting" | "open" | "trial" | "quiescing" | "failed" = "starting";
  let verified: { updateId: string; nonce: string } | undefined;
  const context = async (): Promise<Context | null> => {
    const response = await options.context() as { ok?: unknown; context?: unknown };
    if (!response || response.ok !== true || !("context" in response)) throw error();
    if (response.context === null) return null;
    const value = response.context as Context;
    if (!value || !token(value.updateId) || !token(value.nonce) || !phases.has(value.phase) || typeof value.disrupted !== "boolean" || typeof value.committed !== "boolean" || typeof value.confirmInterrupt !== "boolean") throw error();
    return value;
  };
  const fail = () => { mode = "failed"; verified = undefined; };
  return {
    admitted: () => mode === "open",
    fail,
    async initialize() {
      try {
        const active = await context();
        if (mode !== "starting") throw error();
        if (active && (active.phase !== "trial" || active.committed || !sameBuild(options.build, active as Candidate))) throw error();
        mode = active ? "trial" : "open";
      } catch { fail(); throw error(); }
    },
    async handle(raw: unknown) {
      let nonce: string | undefined;
      try {
        if (!raw || typeof raw !== "object" || Object.keys(raw).sort().join(",") !== "candidate,confirmInterrupt,nonce,op,protocol,updateId") throw error();
        const request = raw as { op: string; protocol: string; updateId: string; nonce: string; candidate: Candidate; confirmInterrupt: boolean };
        if (request.protocol !== "maintenance-v1" || !["capabilities", "quiesce", "readiness", "commit"].includes(request.op) || !token(request.nonce)) throw error();
        const active = await context();
        if (!active || active.updateId !== request.updateId || active.nonce !== request.nonce || active.confirmInterrupt !== request.confirmInterrupt || !request.candidate || Object.keys(request.candidate).sort().join(",") !== "candidateId,dataFormat,revision,version" || ["candidateId", "version", "revision", "dataFormat"].some(key => active[key as keyof Candidate] !== request.candidate[key as keyof Candidate])) throw error();
        nonce = request.nonce;
        if (mode === "failed" || mode === "starting") throw error();
        let result: object;
        if (request.op === "capabilities" || request.op === "quiesce") {
          if (!request.confirmInterrupt && ["loading", "playing", "paused"].includes(options.player())) throw new Error("Confirm interruption of the current playback before installing.");
          if (request.op === "capabilities") {
            if (active.phase !== "preflight" || active.disrupted) throw error();
            result = { build: options.build, nativeReadiness: "libmpv-v1" };
          } else {
            if (active.phase !== "quiescing" || !active.disrupted) throw error();
            mode = "quiescing";
            result = await options.quiesce();
          }
        } else if (request.op === "readiness") {
          if (mode !== "trial" || active.phase !== "trial" || active.committed || !sameBuild(options.build, request.candidate)) throw error();
          await options.database();
          const nativeBuild = await options.native(nonce);
          const frontendBuild = options.frontend();
          if (mode !== "trial" || !sameBuild(nativeBuild, options.build) || !frontendBuild || !sameBuild(frontendBuild, options.build)) throw error();
          // Recheck root authority after asynchronous native/database work.
          const current = await context();
          if (!current || current.updateId !== active.updateId || current.nonce !== nonce || current.phase !== "trial" || current.committed) throw error();
          verified = { updateId: active.updateId, nonce };
          result = { build: options.build, nativeBuild, frontendBuild, database: "ok", nativeReadiness: "libmpv-v1", frontendReady: true };
        } else {
          if (mode !== "trial" || active.phase !== "committing" || !active.committed || verified?.updateId !== active.updateId || verified.nonce !== nonce || !sameBuild(options.build, request.candidate)) throw error();
          mode = "open";
          result = { admissionOpen: true };
        }
        return { protocol: "maintenance-v1", nonce, ok: true, ...result };
      } catch (reason) {
        // A failed checkpoint is permanent for this process. A readiness poll
        // may retry while the frontend or native owner is still starting.
        if (mode === "quiescing") fail();
        return { protocol: "maintenance-v1", ...(nonce ? { nonce } : {}), ok: false, error: reason instanceof Error && reason.message.startsWith("Confirm interruption") ? reason.message : "The TV could not complete this maintenance request." };
      }
    },
  };
}
