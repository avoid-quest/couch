import type { UpdateAction, UpdateOutcome, UpdateState } from "../shared/app-bridge";

const validOutcome = (last: UpdateOutcome | null) => last === null || typeof last === "object" && last !== null
  && (last.version === null || typeof last.version === "string" && last.version.length <= 80)
  && ["installed", "installed-unverified", "rolled-back", "failed", "skipped", "up-to-date", "waiting"].includes(last.outcome)
  && typeof last.at === "number" && Number.isFinite(last.at)
  && (last.error === null || typeof last.error === "string" && last.error.length <= 4096)
  && (last.failed === undefined || last.failed === null || typeof last.failed === "string" && last.failed.length <= 80);

const validState = (state: unknown): state is UpdateState => {
  if (!state || typeof state !== "object") return false;
  const value = state as UpdateState;
  return typeof value.version === "string" && value.version.length <= 80 && ["latest", "preview"].includes(value.channel)
    && ["idle", "checking", "up-to-date", "downloading", "ready", "installing", "error"].includes(value.status)
    && (value.available === null || typeof value.available === "string" && value.available.length <= 80)
    && (value.error === null || typeof value.error === "string" && value.error.length <= 4096)
    && (value.progress === null || typeof value.progress === "number" && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100)
    && (value.checkedAt === null || typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt))
    && (value.automatic === undefined || value.automatic !== null && typeof value.automatic === "object"
      && typeof value.automatic.installed === "boolean" && (value.automatic.active === undefined || typeof value.automatic.active === "boolean") && validOutcome(value.automatic.last));
};

// The existing Main/Core parent port carries requests; reads remain available
// while a check or download runs in Main.
export function createNativeUpdates(send?: (requestId: string, action: UpdateAction) => void) {
  const pending = new Map<string, { resolve: (state: UpdateState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    request(action: UpdateAction): Promise<UpdateState> {
      if (!send) return Promise.reject(new Error("Updates are available in the installed Couch app."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Couch's updater didn't respond. Try again.")); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        try { send(id, action); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    receive(message: { requestId: string; state?: UpdateState; error?: string }) {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (message.error || !validState(message.state)) request.reject(new Error(typeof message.error === "string" ? message.error.slice(0, 4096) : "Invalid update reply."));
      else request.resolve(message.state);
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Couch is restarting.")); }
      pending.clear();
    },
  };
}
