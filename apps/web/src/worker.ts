import releases from "./releases.json";

// The update feed serves the newest published version per channel and answers
// 400 while a fresh publication propagates, so retry before falling back.
type Channel = "stable" | "preview";
type Snapshot = Record<Channel, { version: string; url: string } | null>;
interface Env { ASSETS: { fetch: (request: Request) => Promise<Response> } }
const feed = "https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-deb/0.0.0";

async function channel(channel: Channel): Promise<Snapshot[Channel]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(channel === "preview" ? `${feed}?channel=preview` : feed, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    if (response?.ok) {
      const release = await response.json().catch(() => undefined);
      if (release && typeof release.version === "string" && typeof release.url === "string") return { version: release.version, url: release.url };
      return null;
    }
    response?.body?.cancel();
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 8_000));
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/api/releases") return env.ASSETS.fetch(request);
    const [stable, preview] = await Promise.all([channel("stable"), channel("preview")]);
    const live: Snapshot = { stable: stable ?? (releases as Snapshot).stable, preview: preview ?? (releases as Snapshot).preview };
    return Response.json(live, { headers: { "cache-control": "max-age=60" } });
  },
};
