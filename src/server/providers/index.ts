import { Database } from "../sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowseRequest, ProviderId, ProviderItem, ProviderPage } from "../../shared/providers";
import { ProviderError, providerItemId } from "./http";
import { isStreamingCommunityHost, streamingCommunityOrigin as defaultStreamingCommunityOrigin } from "../../shared/streamingcommunity";
import { streamingCommunityPreview } from "../streamingcommunity";
import { browseStreamingCommunity } from "./streamingcommunity";
import { browseYouTube } from "./youtube";
import { browseTwitch } from "./twitch";
import { browseRaiPlay } from "./raiplay";
import { browseBandcamp } from "./bandcamp";
import { browseSoundCloud } from "./soundcloud";
import { browseMovies123, loadMovies123List } from "./movies123";
import { movies123PageUrl } from "../../shared/movies123";
import { loadBandcampAlbum } from "./bandcamp";
import { loadRaiPlayProgramme } from "./raiplay";
import { loadYouTubePlaylist } from "./youtube";
import { loadStreamingCommunityList } from "./streamingcommunity";
import { ExtractionError } from "../yt-dlp";
import { ControllerError } from "../devices";

type Adapter = (request: BrowseRequest, signal?: AbortSignal) => Promise<ProviderPage>;
const adapters = (streamingCommunityOrigin: () => Promise<string>): Record<ProviderId, Adapter> => ({
  youtube: browseYouTube, twitch: browseTwitch, raiplay: browseRaiPlay, bandcamp: browseBandcamp, soundcloud: browseSoundCloud,
  streamingcommunity: async (request, signal) => browseStreamingCommunity(request, signal, await streamingCommunityOrigin()),
  movies123: browseMovies123,
});
const providerIds = new Set(Object.keys(adapters(async () => "")));
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function publicUrl(value: unknown, provider?: ProviderId): string {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new ProviderError("Invalid provider URL.", 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Invalid provider URL.", 400); }
  const domains: Partial<Record<ProviderId, string[]>> = { youtube: ["youtube.com", "youtu.be"], twitch: ["twitch.tv"], raiplay: ["raiplay.it"], bandcamp: ["bandcamp.com"], soundcloud: ["soundcloud.com"] };
  const hostAllowed = (candidate: ProviderId) => candidate === "streamingcommunity" ? isStreamingCommunityHost(url.hostname) : candidate === "movies123" ? !!movies123PageUrl(url.href) : domains[candidate]!.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
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

// A saved or browsed list expands at queue time so the queue itself stays flat.
export async function loadProviderList(provider: ProviderId, url: string, signal?: AbortSignal): Promise<ProviderPage> {
  if (provider === "soundcloud") throw new ProviderError("Choose an individual SoundCloud track.", 400);
  if (provider === "youtube") return loadYouTubePlaylist(url, signal);
  if (provider === "bandcamp") return loadBandcampAlbum(url, signal);
  if (provider === "raiplay") return loadRaiPlayProgramme(url, signal);
  if (provider === "streamingcommunity") return loadStreamingCommunityList(url, signal);
  if (provider === "movies123") return loadMovies123List(url, signal);
  const page = await browseTwitch({ url }, signal);
  const items = page.items.filter(item => item.kind === "media");
  if (!items.length) throw new ProviderError("This Twitch list has no supported media.", 404);
  return { ...page, items };
}

export function createProviders({ databasePath, onChange = () => {}, streamingCommunityOrigin = async () => defaultStreamingCommunityOrigin, browse = adapters(streamingCommunityOrigin) }: { databasePath: string; onChange?: () => void; streamingCommunityOrigin?: () => Promise<string>; browse?: Record<ProviderId, Adapter> }) {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE IF NOT EXISTS provider_favorites (id TEXT PRIMARY KEY, item TEXT NOT NULL)");
  if (!db.query<{ name: string }, []>("PRAGMA table_info(provider_favorites)").all().some(column => column.name === "position")) {
    db.transaction(() => {
      db.exec("ALTER TABLE provider_favorites ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
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
    cachedItem(url: string, collection?: Pick<NonNullable<ProviderItem["collection"]>, "url" | "index">): ProviderItem | undefined {
      for (const { page, expires } of [...cache.values()].reverse()) {
        if (expires > Date.now()) { const item = page.items.find(item => item.kind === "media" && item.url === url && (!collection || item.collection?.url === collection.url && item.collection.index === collection.index)); if (item) return item; }
      }
    },
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
          return Response.json(await streamingCommunityPreview(Number(preview[1]), await streamingCommunityOrigin(), AbortSignal.any([request.signal, shutdown.signal])));
        }
        const match = /^\/api\/providers\/(youtube|twitch|raiplay|bandcamp|soundcloud|streamingcommunity|movies123)\/items$/.exec(pathname);
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
        // Find asks seven providers, plus RaiPlay's separate live-channel request.
        if (active >= 8) throw new ProviderError("The catalog is busy. Try again shortly.", 503);
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
        if (error instanceof ExtractionError) return Response.json({ error: error.message }, { status: 502 });
        if (error instanceof DOMException && error.name === "TimeoutError") return Response.json({ error: "The provider took too long to respond. Try again." }, { status: 502 });
        return Response.json({ error: "Couldn't complete this request. Try again." }, { status: 502 });
      }
    },
    close() { if (closed) return; closed = true; shutdown.abort(); cache.clear(); db.close(); },
  };
}
