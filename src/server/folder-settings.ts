import type { ControllerIdentity } from "../shared/controllers";
import type { ManagedFolder } from "../shared/folders";
import { ControllerError } from "./controllers";
import { FolderError, type FolderIdentity, type MediaFolders } from "./media-folders";
import { ADMIN_ONLY } from "./messages";

type FolderLibrary = {
  managedSources(): ManagedFolder[];
  addSource(path: string, authorize: () => void, identity: FolderIdentity): Promise<unknown>;
  scan(sourceId: string, authorize: () => void): Promise<unknown>;
  testSource(sourceId: string, authorize: () => void, confirm?: boolean): Promise<unknown>;
  removeSource(sourceId: string, authorize: () => void): void;
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });

async function body(request: Request, field: string): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new FolderError("Send a JSON object.", 415);
  if (Number(request.headers.get("Content-Length")) > 8192) throw new FolderError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new FolderError("Send a JSON object.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new FolderError("The request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new FolderError("Invalid JSON body."); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || !(field in value)) throw new FolderError(`Send only ${field}.`);
  return (value as Record<string, unknown>)[field];
}

export function createFolderSettings(library: FolderLibrary, folders: MediaFolders) {
  return {
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this remote first.", 401);
        if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
      };
      try {
        authorize();
        const { pathname, searchParams } = new URL(request.url);
        if (pathname === "/api/library/folders") {
          if (request.method !== "GET") return methods("GET");
          return json({ sources: library.managedSources() });
        }
        if (pathname === "/api/library/folders/browse") {
          if (request.method !== "GET") return methods("GET");
          const offset = searchParams.get("offset") ?? "0";
          if (!/^\d{1,6}$/.test(offset)) throw new FolderError("Invalid folder page.");
          const result = await folders.browse(searchParams.get("path"), Number(offset));
          authorize();
          return json(result);
        }
        if (pathname === "/api/library/sources") {
          if (request.method !== "POST") return methods("POST");
          const path = await body(request, "path");
          authorize();
          if (typeof path !== "string") throw new FolderError("Choose a permitted folder on the TV.");
          const selected = await folders.inspect(path);
          authorize();
          await library.addSource(selected.path, authorize, selected.identity);
          authorize();
          return json({ sources: library.managedSources() }, 201);
        }
        const source = /^\/api\/library\/sources\/([\w-]{1,80})(?:\/(scan|test|verify))?$/.exec(pathname);
        if (source) {
          const sourceId = source[1]!, action = source[2];
          if (!library.managedSources().some(folder => folder.id === sourceId)) throw new FolderError("Library folder not found.", 404);
          if (!action) {
            if (request.method !== "DELETE") return methods("DELETE");
            library.removeSource(sourceId, authorize);
            return json({ sources: library.managedSources() });
          }
          if (request.method !== "POST") return methods("POST");
          if (action === "scan") {
            // An accepted scan belongs to the coordinator and publishes its own completion.
            void library.scan(sourceId, authorize).catch(() => {});
            return json({ sources: library.managedSources() }, 202);
          }
          if (action === "verify" && await body(request, "confirmed") !== true) throw new FolderError("Confirm that this is the original TV folder before verifying it.");
          authorize();
          const result = await library.testSource(sourceId, authorize, action === "verify");
          authorize();
          return json({ source: result, sources: library.managedSources() });
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        if (error instanceof FolderError || error instanceof ControllerError) return json({ error: error.message }, error.status);
        return json({ error: "Couldn't update folders. Your sources and files are kept." }, 500);
      }
    },
  };
}
