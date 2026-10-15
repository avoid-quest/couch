// Core asks Main to switch TV mode over the parent port. Main saves the choice,
// replies, then restarts the app, which restarts Core.
export function createNativeTvMode(send?: (requestId: string, enabled: boolean) => void) {
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    request(enabled: boolean): Promise<void> {
      if (!send) return Promise.reject(new Error("TV mode needs the Couch app."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("The Couch app didn't respond. Try again.")); }, 5_000);
        pending.set(id, { resolve, reject, timer });
        try { send(id, enabled); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    receive(message: { requestId: string; error?: string }) {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(String(message.error).slice(0, 4096)));
      else request.resolve();
    },
    close() {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Couch is restarting.")); }
      pending.clear();
    },
  };
}
