import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PlaybackCommand, PlayerState } from "../../shared/protocol";

type Options = { origin: string; ready: (nonce: string) => void; lease: (nonce: string) => void; error: () => void };

// The native watchdog owns lease expiry. Only a Core acknowledgement renews it.
export function createNativeRenderer(observe: (state: PlayerState) => void, options: Options) {
  let disposed = false;
  let generation: string | null = null;
  let unlisten: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let queue = Promise.resolve();
  const startup = setTimeout(() => fail(), 8_000);
  const fail = () => { if (!disposed) { close(); options.error(); } };
  const enqueue = (operation: (generation: string) => Promise<void>) => {
    queue = queue.then(async () => {
      if (disposed || generation === null) return;
      deadline = setTimeout(fail, 8_000);
      try { await operation(generation); } finally { clearTimeout(deadline); }
    }).catch(fail);
  };
  const close = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(startup);
    clearTimeout(deadline);
    clearInterval(renewal);
    unlisten?.();
    // Do not wait behind an in-flight command to revoke native playback.
    if (generation !== null) void invoke("native_receiver_end", { generation }).catch(() => {});
  };
  void (async () => {
    const unsubscribe = await listen<{ generation: string; state: PlayerState }>("native-receiver-player", event => {
      if (!disposed && event.payload.generation === generation) observe(event.payload.state);
    });
    if (disposed) { unsubscribe(); return; }
    unlisten = unsubscribe;
    const lease = await invoke<{ generation: string; nonce: string }>("native_receiver_begin", { origin: options.origin });
    generation = lease.generation;
    if (disposed) { await invoke("native_receiver_end", { generation }); return; }
    clearTimeout(startup);
    options.ready(lease.nonce);
  })().catch(fail);
  return {
    renew(nonce: string) {
      enqueue(async generation => {
        await invoke("native_receiver_renew", { generation, nonce });
        if (!disposed && renewal === undefined) renewal = setInterval(() => enqueue(async generation => {
          const nonce = await invoke<string>("native_receiver_request", { generation });
          if (!disposed) options.lease(nonce);
        }), 2_000);
      });
    },
    command(command: PlaybackCommand) { enqueue(async generation => { await invoke("native_receiver_command", { generation, command }); }); },
    report() { enqueue(async generation => { await invoke("native_receiver_report", { generation }); }); },
    play() {},
    close,
  };
}
