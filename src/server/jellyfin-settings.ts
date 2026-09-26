import type { ControllerIdentity } from "../shared/controllers";
import { ControllerError } from "./controllers";
import type { JellyfinSource } from "./jellyfin";
import { ADMIN_ONLY } from "./messages";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });

async function credentials(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ControllerError("Send a JSON object.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ControllerError("Enter a server URL, username, and password.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) { await reader.cancel(); throw new ControllerError("The connection details are too long.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ControllerError("Send a JSON object."); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["url", "username", "password"].includes(key))) throw new ControllerError("Enter only a server URL, username, and password.");
  const { url, username, password } = input as Record<string, unknown>;
  if (typeof url !== "string" || !url.trim() || url.length > 2048 || typeof username !== "string" || !username.trim() || username.length > 200 || typeof password !== "string" || password.length > 4096) throw new ControllerError("Enter a server URL, username, and password.");
  return { url, username, password };
}

export function createJellyfinSettings({ jellyfin, invalidate }: { jellyfin: Pick<JellyfinSource, "status" | "connection" | "connect" | "disconnect" | "test">; invalidate: () => void }) {
  return {
    async handle(request: Request, identity: () => ControllerIdentity | null) {
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this remote first.", 401);
        if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
        if (request.signal.aborted) throw new ControllerError("The request was cancelled.", 409);
      };
      try {
        const path = new URL(request.url).pathname;
        if (path === "/api/jellyfin" && request.method === "GET") return json(jellyfin.status());
        authorize();
        if (path === "/api/jellyfin/connection") {
          if (request.method !== "GET") return methods("GET");
          return json(jellyfin.connection());
        }
        if (path === "/api/jellyfin/test") {
          if (request.method !== "POST") return methods("POST");
          let status;
          try { status = await jellyfin.test(); }
          catch (error) { authorize(); return json({ error: error instanceof Error ? error.message : "Couldn't test the Jellyfin connection." }, 502); }
          authorize();
          return json(status);
        }
        if (path !== "/api/jellyfin") return json({ error: "Not found." }, 404);
        if (request.method === "POST") {
          const input = await credentials(request);
          authorize();
          await jellyfin.connect(input, authorize, invalidate);
        } else if (request.method === "DELETE") {
          await jellyfin.disconnect(authorize, invalidate);
        } else return methods("GET, POST, DELETE");
        return json(jellyfin.status());
      } catch (error) {
        try { authorize(); } catch (reason) { error = reason; }
        return json({ error: error instanceof ControllerError ? error.message : "Couldn't update Jellyfin. Check the address, username and password." }, error instanceof ControllerError ? error.status : 502);
      }
    },
  };
}
