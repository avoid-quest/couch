import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { defaultDeviceName, isDeviceId } from "../shared/devices";
import { ControllerError, deviceName } from "./devices";
import type { Store } from "./store";

export const TV_PAIRING_TTL = 10 * 60_000;

type Pending = { secret: string; id: string; name: string; expiresAt: number; token?: string };

/**
 * A TV asks to pair and shows its code; an admin approves that code from a paired device; the TV, which alone holds
 * the request's secret, collects its token. Requests live in memory and expire unused after ten minutes.
 */
export function createTvPairing(store: Store, onPaired: () => void) {
  const pending = new Map<string, Pending>();
  let window = Date.now(), attempts = 0;
  const find = (code: unknown) => {
    const request = typeof code === "string" ? pending.get(code) : undefined;
    if (request && request.expiresAt > Date.now()) return request;
    if (request) pending.delete(code as string);
    throw new ControllerError("This code expired. Use the one the TV shows now.", 404);
  };
  return {
    /** Unauthenticated, so rate-limited like /api/pair. */
    request(id: unknown, name: unknown) {
      if (Date.now() - window >= 60_000) { window = Date.now(); attempts = 0; }
      if (++attempts > 20) throw new ControllerError("Too many pairing attempts. Try again in a minute.", 429);
      if (!isDeviceId(id)) throw new ControllerError("Update Couch on this device, then pair again.");
      if (store.device(id)) throw new ControllerError("This device is already paired.", 409);
      const label = name === undefined || name === "" ? defaultDeviceName(id) : deviceName(name);
      for (const [code, request] of pending) if (request.expiresAt <= Date.now()) pending.delete(code);
      let code: string;
      do code = String(randomInt(100000, 1000000)); while (pending.has(code));
      const request = { secret: randomBytes(32).toString("base64url"), id, name: label, expiresAt: Date.now() + TV_PAIRING_TTL };
      pending.set(code, request);
      return { code, secret: request.secret, expiresAt: request.expiresAt };
    },
    /** The TV's poll: waiting until approved, then its credentials, once. */
    collect(code: unknown, secret: unknown) {
      const request = find(code);
      if (typeof secret !== "string" || secret.length !== request.secret.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(request.secret))) throw new ControllerError("This pairing request belongs to another device.", 401);
      if (!request.token) return { waiting: true };
      pending.delete(code as string);
      return { token: request.token, device: store.deviceForToken(request.token), installationId: store.installationId() };
    },
    /** For admins only: what they are about to pair. */
    describe: (code: unknown) => ({ name: find(code).name }),
    /** For admins only, the same trust as reading the pairing code. */
    approve(code: unknown) {
      const request = find(code);
      if (request.token || store.device(request.id)) throw new ControllerError(`${request.name} is already paired.`, 409);
      request.token = store.pair(request.id, request.name);
      // An approval near expiry still gives the TV a minute to collect, or it would be paired without its token.
      request.expiresAt = Math.max(request.expiresAt, Date.now() + 60_000);
      onPaired();
      return { device: store.deviceForToken(request.token) };
    },
  };
}
