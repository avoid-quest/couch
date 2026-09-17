import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";
import { ProviderError, providerItemId } from "./http";
import { isStreamingCommunityHost } from "../../shared/streamingcommunity";
import { streamingCommunityPreview } from "../streamingcommunity";
import { browseStreamingCommunity } from "./streamingcommunity";
import { browseYouTube } from "./youtube";
import { browseTwitch } from "./twitch";
import { browseRaiPlay } from "./raiplay";
import { browseBandcamp } from "./bandcamp";
import { ControllerError } from "../controllers";

type Adapter = (request: BrowseRequest, signal?: AbortSignal) => Promise<ProviderPage>;
const adapters = (streamingCommunityOrigin: () => string): Record<ProviderId, Adapter> => ({
  youtube: browseYouTube, twitch: browseTwitch, raiplay: browseRaiPlay, bandcamp: browseBandcamp,
  streamingcommunity: (request, signal) => browseStreamingCommunity(request, signal, streamingCommunityOrigin()),
});
const providerIds = new Set(Object.keys(adapters(() => "")));
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function publicUrl(value: unknown, provider?: ProviderId): string {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new ProviderError("Invalid provider URL.", 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Invalid provider URL.", 400); }
  const domains: Partial<Record<ProviderId, string[]>> = { youtube: ["youtube.com", "youtu.be"], twitch: ["twitch.tv"], raiplay: ["raiplay.it"], bandcamp: ["bandcamp.com"] };
  const hostAllowed = (candidate: ProviderId) => candidate === "streamingcommunity" ? isStreamingCommunityHost(url.hostname) : domains[candidate]!.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || provider && !hostAllowed(provider)) throw new ProviderError("Use a public URL from this provider.", 400);
  return url.href;
}

function savedItem(value: unknown): ProviderItem {
  if (!object(value) || !providerIds.has(String(value.provider)) || !["media", "collection", "channel"].includes(String(value.kind))
    || typeof value.title !== "string" || !value.title.trim() || value.title.length > 200 || /[\u0000-\u001f\u007f]/.test(value.title)) throw new ProviderError("Invalid saved item.", 400);
  const provider = value.provider as ProviderId;
  const url = publicUrl(value.url, provider);
  const item: ProviderItem = { id: providerItemId(provider, url), provider, kind: value.kind as ProviderItem["kind"], title: value.title.trim(), url };
  if (value.thumbnail !== undefined) item.thumbnail = publicUrl(value.thumbnail);
  for (const key of ["description", "subtitle"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || value[key].length > (key === "description" ? 2000 : 300) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value[key])) throw new ProviderError("Invalid saved item metadata.", 400);
    item[key] = value[key];
  }
  if (value.duration !== undefined) {
    if (typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0) throw new ProviderError("Invalid media duration.", 400);
    item.duration = value.duration;
  }
  if (value.live !== undefined) {
    if (typeof value.live !== "boolean") throw new ProviderError("Invalid live status.", 400);
    item.live = value.live;
  }
  return item;
}

export function createProviders({ databasePath, onChange = () => {}, streamingCommunityOrigin = () => "https://streamingcommunityz.academy", browse = adapters(streamingCommunityOrigin) }: { databasePath: string; onChange?: () => void; streamingCommunityOrigin?: () => string; browse?: Record<ProviderId, Adapter> }) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath, { create: true, strict: true });
  db.run("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.run("CREATE TABLE IF NOT EXISTS provider_favorites (id TEXT PRIMARY KEY, item TEXT NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(provider_favorites)").all().some(column => column.name === "position")) {
    db.transaction(() => {
      db.run("ALTER TABLE provider_favorites ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
      // Existing installs keep their newest-first reading order as the start order.
      const rows = db.query<{ id: string }, []>("SELECT id FROM provider_favorites ORDER BY rowid DESC").all();
      for (const [index, row] of rows.entries()) db.query("UPDATE provider_favorites SET position = ? WHERE id = ?").run(index + 1, row.id);
    })();
  }
  const cache = new Map<string, { page: ProviderPage; expires: number }>();
  const shutdown = new AbortController();
  let active = 0;
  let closed = false;
  const wrongMethod = (allow: string) => Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: allow } });

  return {
    async handle(request: Request, authorize = () => {}): Promise<Response> {
      const { pathname, searchParams } = new URL(request.url);
      try {
        if (closed) throw new ProviderError("The provider catalog is closing.", 503);
        if (pathname === "/api/providers/favorites") {
          if (request.method === "GET") return Response.json({ favorites: db.query<{ item: string }, []>("SELECT item FROM provider_favorites ORDER BY position, rowid").all().flatMap(row => { try { return [savedItem(JSON.parse(row.item))]; } catch { return []; } }) });
          if (request.method !== "POST") return wrongMethod("GET, POST");
          if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") throw new ProviderError("Send a JSON object.", 400);
          const body: unknown = await request.json().catch(() => { throw new ProviderError("Invalid JSON body.", 400); });
          authorize();
          if (!object(body)) throw new ProviderError("Send a JSON object.", 400);
          const item = savedItem(body.item);
          if (closed) throw new ProviderError("The provider catalog is closing.", 503);
          if (!db.query("SELECT 1 FROM provider_favorites WHERE id = ?").get(item.id) && db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM provider_favorites").get()!.count >= 500) throw new ProviderError("Remove a saved item before adding more than 500.", 400);
          db.query("INSERT INTO provider_favorites (id, item, position) VALUES (?, ?, (SELECT COALESCE(MIN(position), 1) - 1 FROM provider_favorites)) ON CONFLICT(id) DO UPDATE SET item = excluded.item").run(item.id, JSON.stringify(item));
          onChange();
          return Response.json({ item });
        }
        if (pathname === "/api/providers/favorites/reorder") {
          if (request.method !== "POST") return wrongMethod("POST");
          if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") throw new ProviderError("Send a JSON object.", 400);
          const body: unknown = await request.json().catch(() => { throw new ProviderError("Invalid JSON body.", 400); });
          authorize();
          const order = object(body) && Array.isArray(body.order) ? body.order : null;
          const ids = order?.every((id): id is string => typeof id === "string" && id.length <= 100) ? order : null;
          if (!ids || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw new ProviderError("Send the saved items in their new order.", 400);
          if (ids.some(id => !db.query("SELECT 1 FROM provider_favorites WHERE id = ?").get(id))) throw new ProviderError("Saved items changed. Try the move again.", 409);
          db.transaction(() => {
            for (const [index, id] of ids.entries()) db.query("UPDATE provider_favorites SET position = ? WHERE id = ?").run(index + 1, id);
          })();
          onChange();
          return Response.json({ ok: true });
        }
        const favorite = /^\/api\/providers\/favorites\/([\w-]{1,100})$/.exec(pathname);
        if (favorite) {
          if (request.method !== "DELETE") return wrongMethod("DELETE");
          if (db.query("DELETE FROM provider_favorites WHERE id = ?").run(favorite[1]!).changes) onChange();
          return new Response(null, { status: 204 });
        }
        const preview = /^\/api\/providers\/streamingcommunity\/titles\/(\d{1,8})$/.exec(pathname);
        if (preview) {
          if (request.method !== "GET") return wrongMethod("GET");
          return Response.json(await streamingCommunityPreview(Number(preview[1]), streamingCommunityOrigin(), AbortSignal.any([request.signal, shutdown.signal])));
        }
        const match = /^\/api\/providers\/(youtube|twitch|raiplay|bandcamp|streamingcommunity)\/items$/.exec(pathname);
        if (!match) return Response.json({ error: "Not found." }, { status: 404 });
        if (request.method !== "GET") return wrongMethod("GET");
        const provider = match[1] as ProviderId;
        const query = searchParams.get("q")?.trim() ?? "";
        const url = searchParams.get("url")?.trim() ?? "";
        const cursor = searchParams.get("cursor") ?? "";
        if (query.length > 200 || url.length > 4096 || cursor.length > 4096 || [query, url, cursor].some(value => /[\u0000-\u001f\u007f]/.test(value))) throw new ProviderError("The browse request is invalid or too long.", 400);
        const key = JSON.stringify([provider, query, url, cursor]);
        const cached = cache.get(key);
        if (cached && cached.expires > Date.now()) return Response.json(cached.page);
        if (active >= 6) throw new ProviderError("The catalog is busy. Try again shortly.", 503);
        active++;
        try {
          const page = await browse[provider]({ ...(query ? { query } : {}), ...(url ? { url } : {}), ...(cursor ? { cursor } : {}) }, AbortSignal.any([request.signal, shutdown.signal]));
          if (closed) throw new ProviderError("The provider catalog is closing.", 503);
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, { page, expires: Date.now() + (provider === "twitch" ? 20_000 : 60_000) });
          return Response.json(page);
        } finally { active--; }
      } catch (error) {
        if (error instanceof ProviderError || error instanceof ControllerError) return Response.json({ error: error.message }, { status: error.status });
        return Response.json({ error: "The provider could not complete this request. Try again shortly." }, { status: 502 });
      }
    },
    close() { if (closed) return; closed = true; shutdown.abort(); cache.clear(); db.close(); },
  };
}
