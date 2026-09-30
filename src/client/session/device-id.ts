import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { toast } from "sonner";
import type { SessionState } from "../../shared/protocol";

let id: string | undefined;

/**
 * This Device's one ID: the X25519 key the Sendspin JS SDK stores for this
 * origin, which is also its Sendspin client_id. Tabs on one origin share it.
 * The SDK generates it with @noble/curves, so plain-HTTP LAN pages have it too.
 */
export function deviceId() {
  if (id) return id;
  try { id = loadSendspinClientIdentity().clientId; }
  catch { id = loadSendspinClientIdentity(null).clientId; } // Storage is blocked: this tab gets a key of its own.
  return id;
}

type Outputs = Pick<SessionState, "outputs" | "devices" | "controlling"> & { player: Pick<SessionState["player"], "status"> } | null | undefined;
/**
 * Where the controlled Playback plays: the Device to name (the controlled one while it serves it, else
 * the one showing the picture, else the first), how many more, and whether that is only this Device.
 */
export function playsOn(state: Outputs) {
  const outputs = state?.outputs ?? [];
  const ids = [...new Set(outputs.map(output => output.deviceId))];
  if (!ids.length) return null;
  const controlled = state!.controlling ?? deviceId();
  const id = ids.includes(controlled) ? controlled : (outputs.find(output => output.picture) ?? outputs[0]!).deviceId;
  const name = state!.devices?.find(device => device.id === id)?.name ?? "another device";
  const active = ["loading", "playing", "paused", "ended"].includes(state!.player.status);
  return { deviceId: id, name, more: ids.length - 1, elsewhere: active && !(ids.length === 1 && ids[0] === deviceId()) };
}

/** Whether this Device shows the looked-at Playback's picture. */
export const showsPicture = (state: Outputs) => !!state?.outputs?.some(output => output.deviceId === deviceId() && output.picture);

/**
 * One "Playing on {name}" toast when a play this window started lands on another Device: its
 * picture and sound are elsewhere. A fixed id keeps a play announced twice (control, then play) one toast.
 */
export function announcePlay(state: Pick<SessionState, "devices" | "controlling"> | null | undefined, target = state?.controlling) {
  const name = target && target !== deviceId() && state?.devices?.find(device => device.id === target)?.name;
  if (name) toast(`Playing on ${name}`, { id: "playing-on" });
}
