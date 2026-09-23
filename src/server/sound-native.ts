export type NativeSoundAction = { op: "inventory" | "route" } & { pid?: number } | { op: "default" | "volume" | "mute" | "profile"; output: string; value?: number; profile?: string };

export function createNativeSound(send?: (requestId: string, action: NativeSoundAction) => void) {
  const pending = new Map<string, { resolve: (state: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (id: string, message: string) => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); item.reject(new Error(message)); } };
  return {
    request(action: NativeSoundAction): Promise<unknown> {
      if (!send) return Promise.reject(new Error("Sound requires a native playback host."));
      if (pending.size >= 16) return Promise.reject(new Error("Sound controls are busy. Try again."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending.set(id, { resolve, reject, timer: setTimeout(() => fail(id, "The playback host did not answer the sound request."), 5_000) });
        try { send(id, action); } catch { fail(id, "The native sound connection is unavailable."); }
      });
    },
    receive(message: { requestId: string; state?: unknown; error?: string }) {
      const item = pending.get(message.requestId);
      if (!item) return;
      if (message.error || !message.state) { fail(message.requestId, message.error ?? "Invalid native sound reply."); return; }
      clearTimeout(item.timer); pending.delete(message.requestId); item.resolve(message.state);
    },
    close() { for (const id of pending.keys()) fail(id, "The native connection closed."); },
  };
}
