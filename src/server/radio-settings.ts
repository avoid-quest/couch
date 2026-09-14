import type { ControllerIdentity } from "../shared/controllers";
import type { RadioPlaylistSummary } from "../shared/radio";
import { ControllerError } from "./controllers";
import { RadioError, type createRadio } from "./radio";

export function createRadioSettings(radio: Pick<ReturnType<typeof createRadio>, "playlists" | "addPlaylist" | "refreshPlaylist" | "removePlaylist" | "avoid" | "avoidProgrammes">) {
  return {
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const path = new URL(request.url).pathname;
      const browsing = ["/api/radio/playlists", "/api/radio/avoid", "/api/radio/avoid/programmes"].includes(path) && request.method === "GET";
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
        if (caller.authority === "controller") throw new ControllerError("An administrator is required to manage radio sources.", 403);
      };
      const methods = (allow: string) => new Response(null, { status: 405, headers: { Allow: allow } });
      try {
        if (!identity()) throw new ControllerError("Pair this device before connecting.", 401);
        if (path === "/api/radio/avoid" || path === "/api/radio/avoid/programmes") {
          if (request.method !== "GET") return methods("GET");
          const result = path.endsWith("/programmes") ? { programmes: await radio.avoidProgrammes(request.signal) } : await radio.avoid(new URL(request.url).searchParams.get("refresh") === "true");
          if (!identity()) throw new ControllerError("Pair this device before connecting.", 401);
          return Response.json(result);
        }
        if (browsing) {
          const playlists: RadioPlaylistSummary[] = radio.playlists().map(({ id, name, stationCount, updatedAt, error }) => ({
            id, name, stationCount, updatedAt, error: error ? "This source needs attention in Settings > Sources. Cached stations are still available." : null,
          }));
          return Response.json({ playlists });
        }
        authorize();
        if (path === "/api/radio/sources") {
          if (request.method !== "GET") return methods("GET");
          return Response.json({ sources: radio.playlists() });
        }
        if (path === "/api/radio/playlists") {
          if (request.method !== "POST") return methods("GET, POST");
          if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new RadioError("Send a JSON object.", 415);
          const value: unknown = await request.json().catch(() => { throw new RadioError("Invalid JSON body."); });
          authorize();
          if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "name" && key !== "url")
            || !("name" in value) || typeof value.name !== "string" || !("url" in value) || typeof value.url !== "string") throw new RadioError("Enter a playlist name and an HTTP or HTTPS M3U URL.");
          const playlist = await radio.addPlaylist({ name: value.name, url: value.url }, authorize);
          authorize();
          return Response.json({ playlist }, { status: 201 });
        }
        const match = /^\/api\/radio\/playlists\/([\w-]{1,80})(\/refresh)?$/.exec(path);
        if (!match) return Response.json({ error: "Not found." }, { status: 404 });
        if (match[2]) {
          if (request.method !== "POST") return methods("POST");
          const playlist = await radio.refreshPlaylist(match[1]!, authorize);
          authorize();
          return Response.json({ playlist });
        }
        if (request.method !== "DELETE") return methods("DELETE");
        radio.removePlaylist(match[1]!);
        return new Response(null, { status: 204 });
      } catch (error) {
        // A shared refresh belongs to its first caller. Each waiter must still
        // have authority before receiving that caller's private failure details.
        if (!browsing) { try { authorize(); } catch (rejected) { error = rejected; } }
        if (error instanceof ControllerError || error instanceof RadioError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "Could not update radio sources. Try again." }, { status: 500 });
      }
    },
  };
}
