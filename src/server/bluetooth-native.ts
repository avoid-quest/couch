import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";

export function createNativeBluetooth(send?: (requestId: string, action: BluetoothAction) => void) {
  const pending = new Map<string, { resolve: (state: BluetoothState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const fail = (id: string, message: string) => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); item.reject(new Error(message)); } };
  return {
    request(action: BluetoothAction): Promise<BluetoothState> {
      if (!send) return Promise.reject(new Error("Bluetooth isn't available on this Couch."));
      if (pending.size >= 16 && action.op !== "cancel") return Promise.reject(new Error("Bluetooth is busy. Try again."));
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        pending.set(id, { resolve, reject, timer: setTimeout(() => fail(id, "Bluetooth didn't answer. Try again."), 6_000) });
        try { send(id, action); } catch { fail(id, "Bluetooth isn't available right now."); }
      });
    },
    receive(message: { requestId: string; state?: BluetoothState; error?: string }) {
      const item = pending.get(message.requestId);
      if (!item) return;
      if (message.error || !message.state) { fail(message.requestId, message.error ?? "Invalid Bluetooth reply."); return; }
      clearTimeout(item.timer); pending.delete(message.requestId); item.resolve(message.state);
    },
    close() { for (const id of pending.keys()) fail(id, "The Couch app disconnected."); },
  };
}
