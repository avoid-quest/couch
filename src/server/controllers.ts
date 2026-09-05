import { randomInt } from "node:crypto";
import type { ControllerIdentity } from "../shared/controllers";
import type { Store } from "./store";

export class ControllerError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function controllerName(value: unknown) {
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) throw new ControllerError("Use a name with 1 to 60 characters.");
  const name = value.trim().normalize("NFC");
  if (!name || [...name].length > 60) throw new ControllerError("Use a name with 1 to 60 characters.");
  return name;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });

async function body(request: Request, field: string) {
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
    throw new ControllerError("Could not read the request.");
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ControllerError("Invalid JSON body."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !(field in value)) throw new ControllerError(`Send only ${field}.`);
  return (value as Record<string, unknown>)[field];
}

export function createControllers({ store, onChange, onRevoke = () => {}, recoveryCode }: { store: Store; onChange: () => void; onRevoke?: (id: string) => void; recoveryCode?: string }) {
  if (recoveryCode !== undefined && !/^[a-f\d]{32,256}$/i.test(recoveryCode)) throw new ControllerError("The administrator recovery code must contain 32 to 256 hexadecimal characters.");
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
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const requireIdentity = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
        return caller;
      };
      const administrator = () => {
        const caller = requireIdentity();
        if (caller.authority === "controller") throw new ControllerError("An administrator is required.", 403);
        return caller;
      };
      try {
        const caller = requireIdentity();
        const path = new URL(request.url).pathname;
        if (path === "/api/controllers/me") {
          if (request.method !== "GET") return methods("GET");
          return json({ ...caller, claimAvailable: claimAvailable() });
        }
        if (path === "/api/controllers") {
          if (request.method !== "GET") return methods("GET");
          administrator();
          return json({ controllers: store.controllers() });
        }
        const device = /^\/api\/controllers\/([\w-]{1,80})(?:\/(name|role))?$/.exec(path);
        if (device && !["claim", "claim-code"].includes(device[1]!)) {
          administrator();
          const id = device[1]!;
          if (!device[2]) {
            if (request.method !== "DELETE") return methods("DELETE");
            store.revokeController(id);
            onRevoke(id);
            onChange();
            return json({ ok: true });
          }
          if (request.method !== "POST") return methods("POST");
          const value = await body(request, device[2]);
          administrator();
          const controller = device[2] === "name" ? store.renameController(id, value) : store.setControllerRole(id, value);
          onChange();
          return json({ controller });
        }
        if (path === "/api/controllers/claim-code") {
          if (request.method !== "GET") return methods("GET");
          if (caller.authority !== "host") throw new ControllerError("The setup code is available on the TV only.", 403);
          if (store.administratorExists()) throw new ControllerError("This TV already has an administrator.", 409);
          if (!setup || setup.expiresAt <= Date.now()) {
            const code = String(randomInt(1_000_000_000, 10_000_000_000));
            const claim = store.createControllerClaim(code, false);
            setup = { code, expiresAt: claim.expiresAt };
          }
          return json(setup);
        }
        if (path === "/api/controllers/claim") {
          if (request.method !== "POST") return methods("POST");
          if (caller.authority === "host") throw new ControllerError("Claim administration from a paired remote.");
          if (Date.now() - claimWindow >= 60_000) { claimWindow = Date.now(); claimAttempts = 0; }
          if (++claimAttempts > 20) throw new ControllerError("Too many claim attempts. Try again in a minute.", 429);
          const code = await body(request, "code");
          const current = requireIdentity();
          if (!current.controller || current.authority !== "controller") throw new ControllerError("This remote is already an administrator.", 409);
          if (typeof code !== "string" || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code)) throw new ControllerError("The administrator code is invalid or expired.", 401);
          const controller = store.consumeControllerClaim(current.controller.id, code);
          onChange();
          return json({ controller });
        }
        if (path === "/api/settings") {
          if (request.method === "GET") return json({ name: store.installationName() });
          if (request.method !== "POST") return methods("GET, POST");
          administrator();
          const name = await body(request, "name");
          administrator();
          const saved = store.renameInstallation(name);
          onChange();
          return json({ name: saved });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        return json({ error: error instanceof ControllerError ? error.message : "Could not update controller settings. Try again." }, error instanceof ControllerError ? error.status : 500);
      }
    },
  };
}
