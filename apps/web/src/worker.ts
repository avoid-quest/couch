import { currentCatalog } from "./release-catalog";

interface Env { ASSETS: { fetch: (request: Request) => Promise<Response> } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/api/releases") return env.ASSETS.fetch(request);
    return Response.json(await currentCatalog(), { headers: { "cache-control": "public, max-age=60" } });
  },
};
