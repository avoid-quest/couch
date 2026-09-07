import type { MaintenanceBuild } from "../shared/build";

export function createNativeReadiness(send: (nonce: string) => void, timeout = 2_500) {
  let pending: { nonce: string; resolve: (build: MaintenanceBuild) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const failure = () => new Error("The native player did not pass startup readiness.");
  return {
    collect() {
      if (pending) return Promise.reject(failure());
      return new Promise<MaintenanceBuild>((resolve, reject) => {
        const nonce = crypto.randomUUID().replaceAll("-", "");
        const timer = setTimeout(() => { pending = undefined; reject(failure()); }, timeout);
        pending = { nonce, resolve, reject, timer };
        try { send(nonce); } catch { clearTimeout(timer); pending = undefined; reject(failure()); }
      });
    },
    receive(nonce: string, ok: boolean, build: unknown) {
      if (!pending || pending.nonce !== nonce) return;
      const current = pending;
      pending = undefined;
      clearTimeout(current.timer);
      const value = build as MaintenanceBuild;
      if (ok !== true || !value || typeof value.version !== "string" || !/^[a-f0-9]{40}$/.test(value.revision) || value.dataFormat !== 1) { current.reject(failure()); return; }
      current.resolve({ version: value.version, revision: value.revision, dataFormat: value.dataFormat });
    },
    close() { if (pending) { clearTimeout(pending.timer); pending.reject(failure()); pending = undefined; } },
  };
}
