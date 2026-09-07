import type { AppImageUpdateAction, AppImageUpdateReply } from "../shared/updates";
import { UpdateError, type UpdateFeed, type UpdateRelease } from "./update-feed";

export function createNativeAppImageUpdates(send: (requestId: string, action: AppImageUpdateAction) => void) {
  let pending: { id: string; resolve: (reply: AppImageUpdateReply) => void; reject: (error: Error) => void; progress?: (value: { received: number; total: number }) => void } | undefined;
  const request = (action: AppImageUpdateAction, signal: AbortSignal, progress?: (value: { received: number; total: number }) => void): Promise<AppImageUpdateReply> => {
    signal.throwIfAborted();
    if (pending) return Promise.reject(new UpdateError("An AppImage update operation is already running."));
    return new Promise((resolve, reject) => {
      const aborted = () => { reject(new UpdateError("The update operation was interrupted. Use Check now before retrying.")); };
      const finish = () => signal.removeEventListener("abort", aborted);
      pending = { id: crypto.randomUUID(), progress, resolve: reply => { finish(); resolve(reply); }, reject: error => { finish(); reject(error); } };
      signal.addEventListener("abort", aborted, { once: true });
      try { send(pending.id, action); } catch { const current = pending; pending = undefined; current.reject(new UpdateError("The native AppImage updater is unavailable.")); }
    });
  };
  const feed: UpdateFeed<UpdateRelease> = {
    installationUnavailable: "Signed AppImage downloads are available. Installation is not enabled for this AppImage yet; keep SSH available for recovery.",
    async check(channel, signal) { return (await request({ type: "check", channel }, signal)).candidate ?? null; },
    async stage(candidate, signal, progress) {
      if (!(await request({ type: "stage", candidateId: candidate.summary.id }, signal, progress)).staged) throw new UpdateError("The native updater did not confirm a verified download.");
    },
  };
  return {
    feed,
    // Reserved for the qualified repair installer. No browser can select a URL or expected version.
    async checkRepair(signal: AbortSignal) { return (await request({ type: "checkRepair" }, signal)).candidate ?? null; },
    receive(reply: AppImageUpdateReply) {
      if (!pending || reply.requestId !== pending.id) return;
      if (reply.progress) { pending.progress?.(reply.progress); return; }
      const current = pending; pending = undefined;
      if (reply.error) current.reject(new UpdateError(reply.error)); else current.resolve(reply);
    },
    close() { const current = pending; pending = undefined; current?.reject(new UpdateError("The native connection closed.")); },
  };
}
