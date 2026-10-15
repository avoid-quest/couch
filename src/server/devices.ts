import { randomInt } from "node:crypto";
import { normalizeDeviceName, type Device, type DeviceIdentity } from "../shared/devices";
import type { Store } from "./store";
import { ADMIN_ONLY } from "./messages";

export class ControllerError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function deviceName(value: unknown) {
  try { return normalizeDeviceName(value); }
  catch (error) { throw new ControllerError((error as Error).message); }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });

export async function settingField(request: Request, field: string) {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ControllerError("Send a JSON object.", 415);
  if (Number(request.headers.get("Content-Length")) > 8192) throw new ControllerError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ControllerError("Send a JSON object.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new ControllerError("The request is too large.", 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ControllerError) throw error;
    throw new ControllerError("Couldn't read the request.");
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ControllerError("Invalid JSON body."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !(field in value)) throw new ControllerError(`Send only ${field}.`);
  return (value as Record<string, unknown>)[field];
}

export function createDevices({ store, onChange, onRevoke = () => {}, recoveryCode, pairingCode }: { store: Store; onChange: (device?: Device) => void; onRevoke?: (id: string) => void | Promise<void>; recoveryCode?: string; pairingCode?: string }) {
  if (recoveryCode !== undefined && !/^[a-f\d]{32,256}$/i.test(recoveryCode)) throw new ControllerError("Check the admin code.");
  if (recoveryCode) store.createControllerClaim(recoveryCode, true);
  let setup: { code: string; expiresAt: number } | null = null;
  let claimWindow = Date.now();
  let claimAttempts = 0;
  const claimAvailable = () => {
    if (!store.administratorExists()) return true;
    const recovery = recoveryCode ? store.controllerClaim(recoveryCode) : null;
    return !!recovery && !recovery.consumed && recovery.expiresAt > Date.now();
  };

  return {
    claimAvailable,
    async handle(request: Request, identity: () => DeviceIdentity | null): Promise<Response> {
      const requireIdentity = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this device first.", 401);
        return caller;
      };
      const administrator = () => {
        const caller = requireIdentity();
        if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
        return caller;
      };
      try {
        const caller = requireIdentity();
        const path = new URL(request.url).pathname;
        if (path === "/api/devices/me") {
          if (request.method !== "GET") return methods("GET");
          return json({ ...caller, claimAvailable: claimAvailable() });
        }
        // Every Device sees every Device (#644: look at any Device from any window).
        if (path === "/api/devices") {
          if (request.method !== "GET") return methods("GET");
          return json({ devices: store.devices() });
        }
        if (path === "/api/devices/pairing-code") {
          if (request.method !== "GET") return methods("GET");
          administrator();
          if (!pairingCode) throw new ControllerError("Pairing is unavailable.", 503);
          return json({ code: pairingCode });
        }
        const target = /^\/api\/devices\/([\w-]{1,80})(?:\/(name|role))?$/.exec(path);
        if (target && !["claim", "claim-code"].includes(target[1]!)) {
          const id = target[1]!;
          // A device names only itself (administrators name the host through /api/settings); admins manage the rest.
          const authorize = () => {
            const current = requireIdentity();
            if (target[2] !== "name") administrator();
            else if (current.device?.id !== id) throw new ControllerError("Change this name on that device.", 403);
          };
          authorize();
          if (!target[2]) {
            if (request.method !== "DELETE") return methods("DELETE");
            store.revokeDevice(id);
            await onRevoke(id);
            onChange();
            return json({ ok: true });
          }
          if (request.method !== "POST") return methods("POST");
          const value = await settingField(request, target[2]);
          authorize();
          const device = target[2] === "name" ? store.renameDevice(id, value) : store.setDeviceRole(id, value);
          onChange(device);
          return json({ device });
        }
        if (path === "/api/devices/claim-code") {
          if (request.method !== "GET") return methods("GET");
          if (caller.authority !== "host") throw new ControllerError("The setup code is available on the TV only.", 403);
          if (store.administratorExists()) throw new ControllerError("This Couch already has an admin.", 409);
          if (!setup || setup.expiresAt <= Date.now()) {
            const code = String(randomInt(1_000_000_000, 10_000_000_000));
            const claim = store.createControllerClaim(code, false);
            setup = { code, expiresAt: claim.expiresAt };
          }
          return json(setup);
        }
        if (path === "/api/devices/claim") {
          if (request.method !== "POST") return methods("POST");
          if (caller.authority === "host") throw new ControllerError("Become admin from a paired device.");
          if (Date.now() - claimWindow >= 60_000) { claimWindow = Date.now(); claimAttempts = 0; }
          if (++claimAttempts > 20) throw new ControllerError("Too many claim attempts. Try again in a minute.", 429);
          const code = await settingField(request, "code");
          const current = requireIdentity();
          if (!current.device || current.authority !== "controller") throw new ControllerError("This device is already an admin.", 409);
          if (typeof code !== "string" || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code)) throw new ControllerError("This admin code is wrong or expired.", 401);
          const device = store.consumeControllerClaim(current.device.id, code);
          onChange();
          return json({ device });
        }
        if (path === "/api/settings/setup") {
          if (request.method !== "POST") return methods("POST");
          const requireOwner = () => {
            administrator();
          };
          requireOwner();
          const expected = await settingField(request, "step");
          requireOwner();
          const step = store.advanceSetup(expected);
          onChange();
          return json({ step });
        }
        if (path === "/api/settings") {
          if (request.method === "GET") return json({ name: store.installationName() });
          if (request.method !== "POST") return methods("GET, POST");
          administrator();
          const name = await settingField(request, "name");
          administrator();
          const saved = store.renameInstallation(name);
          onChange();
          return json({ name: saved });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        return json({ error: error instanceof ControllerError ? error.message : "Couldn't update devices. Try again." }, error instanceof ControllerError ? error.status : 500);
      }
    },
  };
}
