import { boundedBytes } from "./iptv-feeds";
import { publicFetch } from "./public-network";

export const artworkSizeLimit = 8 * 1024 * 1024;
// Raster pictures only: a browser decodes them and nothing in them runs (no SVG).
const pictures = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/**
 * Artwork's bytes for a paired Device to read its colours (src/client/artwork-light.ts). Most artwork hosts don't allow
 * a page to read their pictures (no CORS), so Core fetches the public address and returns the picture from its own
 * origin. The page still shows artwork straight from its host; this is only read.
 */
export async function artworkResponse(request: Request, authorize: () => void, fetcher: typeof fetch = publicFetch): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  try { authorize(); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Pair this device first." }, { status: 401 }); }
  let target: URL;
  try { target = new URL(new URL(request.url).searchParams.get("url") ?? ""); } catch { return Response.json({ error: "Send the artwork's address." }, { status: 400 }); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return Response.json({ error: "Send a public web address." }, { status: 400 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    const upstream = await fetcher(target, { signal, headers: { accept: [...pictures].join(", ") } });
    const type = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!upstream.ok || !pictures.has(type)) { await upstream.body?.cancel(); return Response.json({ error: "That address has no picture." }, { status: 502 }); }
    const bytes = await boundedBytes(upstream, artworkSizeLimit, signal);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return Response.json({ error: "Couldn't read that picture." }, { status: 502 });
  }
}
