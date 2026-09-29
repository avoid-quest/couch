import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { waitForTap } from "./renderer";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player. The SDK's stored key is the Device's ID, so Core knows the speaker.
let player: Promise<SendspinPlayer> | null = null;

export function listen(on: boolean, name: string) {
  if (!on) {
    const current = player;
    player = null;
    waitForTap(null);
    void current?.then(stopped => stopped.disconnect("user_request"));
    return;
  }
  if (player) return;
  const current: Promise<SendspinPlayer> = player = import("@sendspin/sendspin-js").then(({ SendspinPlayer }) => {
    // AES-GCM: Core runs on Electron's Node, whose BoringSSL has no ChaCha20-Poly1305.
    const created = new SendspinPlayer({ baseUrl: location.origin, clientName: name, productName: "Couch", suite: "aesgcm" });
    if (player !== current) return created;
    void created.connect().catch(() => {});
    // A browser that wants a gesture before it plays sound asks for a tap on its own screen (#644).
    let unlocked = false;
    void created.unlock().then(() => { unlocked = true; if (player === current) waitForTap(null); }, () => {});
    setTimeout(() => { if (!unlocked && player === current) waitForTap(() => void created.unlock()); }, 500);
    return created;
  });
}
