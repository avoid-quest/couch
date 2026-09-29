import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";

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
