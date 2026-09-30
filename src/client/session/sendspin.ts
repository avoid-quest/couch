import type { SendspinPlayer } from "@sendspin/sendspin-js";
import { waitForTap } from "./renderer";
import { deviceStorage } from "./device-id";

// Synced sound (#644 ticket 10): while Core asks, this tab plays its Device's sound with the
// official Sendspin player. The SDK's stored key is the Device's ID, so Core knows the speaker.
// A tab that shows a synced picture connects too, only for the clock it follows (ticket 11).
let player: Promise<SendspinPlayer> | null = null;
let connected: SendspinPlayer | null = null;
let group: string | undefined;
let hearing = false;

export function listen(on: boolean, watch: boolean, name: string) {
  if (!on && !watch) {
    const current = player;
    player = connected = null;
    group = undefined;
    hearing = false;
    waitForTap(null);
    void current?.then(stopped => stopped.disconnect("user_request"));
    return;
  }
  const hear = on && !hearing;
  hearing = on;
  if (!on) waitForTap(null);
  const current: Promise<SendspinPlayer> = player ??= import("@sendspin/sendspin-js").then(({ SendspinPlayer }) => {
    // AES-GCM: Core runs on Electron's Node, whose BoringSSL has no ChaCha20-Poly1305.
    const created = new SendspinPlayer({ baseUrl: location.origin, clientName: name, productName: "Couch", suite: "aesgcm", storage: deviceStorage(),
      onStateChange: state => { if (player === current) group = state.groupState.group_id; } });
    if (player !== current) return created;
    connected = created;
    void created.connect().catch(() => {});
    return created;
  });
  if (!hear) return;
  void current.then(created => {
    if (player !== current || !hearing) return;
    // A browser that wants a gesture before it plays sound asks for a tap on its own screen (#644).
    let unlocked = false;
    void created.unlock().then(() => { unlocked = true; if (player === current) waitForTap(null); }, () => {});
    setTimeout(() => { if (!unlocked && player === current && hearing) waitForTap(() => void created.unlock()); }, 500);
  });
}

// Where the sound of Playback `id` is now, on this Device's synced clock: what a picture follows.
export function soundClock(id: string) {
  const progress = connected?.isConnected && connected.timeSyncInfo.synced && group === id ? connected.trackProgress : null;
  return progress ? { position: progress.positionMs / 1000, speed: progress.playbackSpeed } : null;
}
