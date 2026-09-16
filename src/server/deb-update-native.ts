import type { DebUpdateAction, DebUpdateReply, UpdateRequest } from "../shared/updates";
import { UpdateError, type UpdateFeed, type UpdateRelease } from "./update-feed";

// A reply-carried native rejection (the deb sidecar's own message), as opposed
// to a transport fault on the channel itself.
export class NativeUpdateError extends UpdateError {}

// Mirrors the AppImage worker over the deb sidecar channel; the native side
// rejects AppImage-only actions such as checkRepair and repair-current.
export function createNativeDebUpdates(send: (requestId: string, action: DebUpdateAction) => void) {
  const pending = new Map<string, { resolve: (reply: DebUpdateReply) => void; reject: (error: Error) => void; progress?: (value: { received: number; total: number }) => void }>();
  let mutation: string | undefined;
  const request = (action: DebUpdateAction, signal: AbortSignal, progress?: (value: { received: number; total: number }) => void): Promise<DebUpdateReply> => {
    signal.throwIfAborted();
    const readOnly = action.type === "status";
    if (!readOnly && mutation) return Promise.reject(new UpdateError("A package update operation is already running."));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const aborted = () => { if (readOnly) finish(); reject(new UpdateError("The update operation was interrupted. Use Check now before retrying.")); };
      const finish = () => { signal.removeEventListener("abort", aborted); pending.delete(id); if (mutation === id) mutation = undefined; };
      const current = { progress, resolve: (reply: DebUpdateReply) => { finish(); resolve(reply); }, reject: (error: Error) => { finish(); reject(error); } };
      pending.set(id, current);
      if (!readOnly) mutation = id;
      signal.addEventListener("abort", aborted, { once: true });
      try { send(id, action); } catch { current.reject(new UpdateError("The native package updater is unavailable.")); }
    });
  };
  const feed: UpdateFeed<UpdateRelease> = {
    async check(channel, signal) { return (await request({ type: "check", channel }, signal)).candidate ?? null; },
    async stage(candidate, signal, progress) {
      const reply = await request({ type: "stage", candidateId: candidate.summary.id }, signal, progress);
      if (reply.summary) Object.assign(candidate.summary, reply.summary);
      if (!reply.staged) throw new UpdateError("The native updater did not confirm a verified download.");
    },
  };
  return {
    feed,
    restart(confirmInterrupt: boolean) { return request({ type: "restart", confirmInterrupt }, AbortSignal.timeout(35_000)); },
    async request(value: UpdateRequest) {
      const signal = AbortSignal.timeout(35_000);
      if (value.op === "status") return request({ type: "status", ...(value.requestId ? { requestId: value.requestId } : {}) }, signal);
      return request({ type: "install", requestId: value.requestId, candidateId: value.op === "install" ? value.candidateId : value.expectedCurrentId, confirmInterrupt: value.confirmInterrupt, whenIdle: value.op === "install" && value.whenIdle === true, repair: value.op === "repair-current", repairRuntime: value.op === "repair-current" && value.repairRuntime }, signal);
    },
    complete(error: string | null) { return request({ type: "complete", error }, AbortSignal.timeout(10_000)); },
    receive(reply: DebUpdateReply) {
      const current = pending.get(reply.requestId);
      if (!current) { if (mutation === reply.requestId && !reply.accepted && !reply.progress) mutation = undefined; return; }
      if (reply.progress) { current.progress?.(reply.progress); return; }
      if (reply.accepted) { current.resolve(reply); mutation = reply.requestId; return; }
      if (reply.error) current.reject(new NativeUpdateError(reply.error)); else current.resolve(reply);
    },
    close() { for (const current of pending.values()) current.reject(new UpdateError("The native connection closed.")); },
  };
}
