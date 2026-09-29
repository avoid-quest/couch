import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
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

type Outputs = { outputs?: SessionState["outputs"]; devices?: SessionState["devices"]; player: Pick<SessionState["player"], "status"> } | null | undefined;
/**
 * Where the looked-at Playback plays when that isn't only this Device (#644 ticket 9): the first
 * other Device's name plus how many more serve it ("Playing on Studio Mac +2"), or "Playing here +2"
 * when this Device is one of them (ticket 12).
 */
export function playingElsewhere(state: Outputs) {
  const ids = [...new Set(state?.outputs?.map(output => output.deviceId))];
  const others = ids.filter(id => id !== deviceId());
  if (!others.length || !["loading", "playing", "paused", "ended"].includes(state!.player.status)) return null;
  const first = state!.devices?.find(device => device.id === others[0])?.name ?? "another device";
  const here = others.length < ids.length;
  const name = here ? `here +${others.length}` : ids.length > 1 ? `${first} +${ids.length - 1}` : first;
  return { deviceId: others[0]!, here, name, label: here ? `Playing ${name}` : `Playing on ${name}` };
}

/** Whether this Device shows the looked-at Playback's picture. */
export const showsPicture = (state: Outputs) => !!state?.outputs?.some(output => output.deviceId === deviceId() && output.picture);
