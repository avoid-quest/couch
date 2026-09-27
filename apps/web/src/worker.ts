import { currentCatalog, fillDownloads } from "./release-catalog";

interface Env { ASSETS: { fetch: (request: Request) => Promise<Response> } }

// Cloudflare keeps each release feed answer for a minute.
const cached = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    if (!/^\/download\/?$/.test(new URL(request.url).pathname) || !response.headers.get("content-type")?.includes("text/html")) return response;
    const page = new Response(fillDownloads(response, await currentCatalog(cached)).body, response);
    page.headers.set("cache-control", "public, max-age=60");
    return page;
  },
};
