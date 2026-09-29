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

/** The other Device that plays the current Playback, if it isn't this one. */
export function playingElsewhere(state: { renderer?: SessionState["renderer"]; player: Pick<SessionState["player"], "status"> } | null | undefined) {
  const renderer = state?.renderer;
  return renderer && renderer.deviceId !== deviceId() && ["loading", "playing", "paused", "ended"].includes(state.player.status) ? renderer : null;
}
