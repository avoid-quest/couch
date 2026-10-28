import { boundedBytes } from "./iptv-feeds";
import { publicFetch } from "./public-network";

export const artworkSizeLimit = 8 * 1024 * 1024;
// Raster pictures only: a browser decodes them and nothing in them runs (no SVG).
const pictures = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
type Picture = { type: string; bytes: Uint8Array };

/**
 * The pictures Core read lately, newest last, within a byte budget that counts each address and picture, so a picture
 * lit on several pages or Devices is fetched from its host once. Only whole, valid pictures are kept; an empty one, or
 * one over a quarter of the budget, never is.
 */
export function createArtworkCache(budget = 24 * 1024 * 1024, maxAge = Infinity) {
  const entries = new Map<string, { type: string; bytes: Uint8Array; cost: number; expiresAt: number }>();
  const pending = new Map<string, { promise: Promise<Picture | null>; controller: AbortController; readers: number }>();
  let size = 0;
  const cache = {
    get(key: string) {
      const entry = entries.get(key);
      if (entry && entry.expiresAt <= Date.now()) { entries.delete(key); size -= entry.cost; return; }
      // Read again, it is the newest.
      if (entry) { entries.delete(key); entries.set(key, entry); }
      return entry;
    },
    set(key: string, type: string, bytes: Uint8Array) {
      const cost = key.length + bytes.byteLength;
      if (!bytes.byteLength || cost > budget / 4) return;
      const old = entries.get(key);
      if (old) { entries.delete(key); size -= old.cost; }
      // A copy of its own, so a small picture doesn't hold on to the shared buffer it was read into.
      entries.set(key, { type, bytes: new Uint8Array(bytes), cost, expiresAt: Date.now() + maxAge }); size += cost;
      for (const [oldest, entry] of entries) { if (size <= budget) break; entries.delete(oldest); size -= entry.cost; }
    },
    async read(key: string, load: (signal: AbortSignal) => Promise<Picture | null>, signal: AbortSignal): Promise<Picture | null> {
      signal.throwIfAborted();
      const kept = cache.get(key);
      if (kept) return kept;
      let work = pending.get(key);
      if (!work) {
        const controller = new AbortController();
        const promise = load(controller.signal).then(picture => {
          controller.signal.throwIfAborted();
          if (picture) cache.set(key, picture.type, picture.bytes);
          return picture;
        }).finally(() => { if (pending.get(key)?.controller === controller) pending.delete(key); });
        work = { promise, controller, readers: 0 };
        pending.set(key, work);
      }
      work.readers++;
      let abort!: () => void;
      try {
        return await new Promise<Picture | null>((resolve, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          work.promise.then(resolve, reject);
        });
      } finally {
        signal.removeEventListener("abort", abort);
        // One device leaving must not cancel the other readers. With none left, a new reader starts afresh.
        if (--work.readers === 0 && pending.get(key) === work) {
          pending.delete(key);
          work.controller.abort();
        }
      }
    },
    get size() { return size; },
  };
  return cache;
}
const shared = createArtworkCache();

/**
 * Artwork's bytes for a paired Device to read its colours (src/client/artwork-light.ts). Most artwork hosts don't allow
 * a page to read their pictures (no CORS), so Core fetches the public address and returns the picture from its own
 * origin. The page still shows artwork straight from its host; this is only read.
 */
export async function artworkResponse(request: Request, authorize: () => void, fetcher: typeof fetch = publicFetch, cache = shared): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  try { authorize(); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Pair this device first." }, { status: 401 }); }
  let target: URL;
  try { target = new URL(new URL(request.url).searchParams.get("url") ?? ""); } catch { return Response.json({ error: "Send the artwork's address." }, { status: 400 }); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return Response.json({ error: "Send a public web address." }, { status: 400 });
  const picture = (type: string, bytes: Uint8Array) => new Response(Buffer.from(bytes), { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, max-age=86400" } });
  try {
    const result = await cache.read(target.href, async cancellation => {
      const signal = AbortSignal.any([cancellation, AbortSignal.timeout(10_000)]);
      const upstream = await fetcher(target, { signal, headers: { accept: [...pictures].join(", ") } });
      const type = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!upstream.ok || !pictures.has(type)) { await upstream.body?.cancel(); return null; }
      const bytes = await boundedBytes(upstream, artworkSizeLimit, signal);
      return bytes.byteLength ? { type, bytes } : null;
    }, request.signal);
    return result ? picture(result.type, result.bytes) : Response.json({ error: "That address has no picture." }, { status: 502 });
  } catch {
    return Response.json({ error: "Couldn't read that picture." }, { status: 502 });
  }
}
