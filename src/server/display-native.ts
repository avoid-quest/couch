import type { DisplayAction, DisplayState } from "../shared/display";

export function createNativeDisplay(send?: (requestId: string, action: DisplayAction) => void) {
  let pending: { id: string; resolve: (state: DisplayState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  const fail = (message: string) => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = null; } };
  return {
    request(action: DisplayAction): Promise<DisplayState> {
      if (!send) return Promise.reject(new Error("Display selection requires the native Ubuntu appliance."));
      if (pending) return Promise.reject(new Error("A display request is pending. Try again."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending = { id, resolve, reject, timer: setTimeout(() => fail("The native display did not respond. An unconfirmed preview still expires on the TV."), 5_000) };
        try { send(id, action); } catch { fail("The native display is unavailable."); }
      });
    },
    receive(message: { requestId: string; state?: DisplayState; error?: string }) {
      if (!pending || pending.id !== message.requestId) return;
      if (message.error || !message.state) { fail(message.error ?? "Invalid native display reply."); return; }
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.resolve(message.state);
    },
    close() { fail("The native connection closed."); },
  };
}
