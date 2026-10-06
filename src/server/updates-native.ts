import { isUpdateState, validateUpdateAction, type UpdateAction, type UpdateState } from "../shared/updates";

// The existing Main/Core parent port carries requests; reads remain available
// while a check or download runs in Main.
export function createNativeUpdates(send?: (requestId: string, action: UpdateAction) => void) {
  const pending = new Map<string, { resolve: (state: UpdateState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    request(action: UpdateAction): Promise<UpdateState> {
      try { validateUpdateAction(action); } catch (error) { return Promise.reject(error); }
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
      if (message.error || !isUpdateState(message.state)) request.reject(new Error(typeof message.error === "string" ? message.error.slice(0, 4096) : "Invalid update reply."));
      else request.resolve(message.state);
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Couch is restarting.")); }
      pending.clear();
    },
  };
}
