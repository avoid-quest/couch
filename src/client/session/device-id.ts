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
/** The other Device that plays the looked-at Playback, if it isn't this one (#644 ticket 9). */
export function playingElsewhere(state: Outputs) {
  const output = state?.outputs?.[0];
  if (!output || output.deviceId === deviceId() || !["loading", "playing", "paused", "ended"].includes(state.player.status)) return null;
  return { deviceId: output.deviceId, name: state.devices?.find(device => device.id === output.deviceId)?.name ?? "another Device" };
}

/** Whether this Device shows the looked-at Playback's picture. */
export const showsPicture = (state: Outputs) => !!state?.outputs?.some(output => output.deviceId === deviceId() && output.picture);
