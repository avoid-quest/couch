import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { isMovies123Host, movies123Origin, movies123PageUrl } from "../../shared/movies123";
import { ProviderError, providerItemId, providerJson, readProviderText } from "./http";

const pageSize = 24;
const changed = () => new ProviderError("123MoviesFree changed this page or it is unavailable. Try again shortly.");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, limit = 200) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";

// Only text and attributes from the site's public catalogue are read. Scripts,
// event handlers and page markup never enter Couch's UI.
function text(value: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return entities[name] ?? entity;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1]!.toLowerCase(), text(match[2] ?? match[3] ?? match[4] ?? "")]));
}

export async function movies123Text(url: string, signal?: AbortSignal, request: typeof fetch = globalThis.fetch): Promise<string> {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  const response = await request(url, { signal: cancellation, credentials: "omit", redirect: "error", headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(response.status === 404 ? "123MoviesFree does not have this page." : "123MoviesFree did not load this page. Try again shortly.", response.status === 404 ? 404 : 502);
  }
  return readProviderText(response, 2 * 1024 * 1024, cancellation, changed());
}

function item(url: URL, title: string, metadata: Partial<ProviderItem> = {}): ProviderItem {
  return { ...metadata, id: providerItemId("movies123", url.href), provider: "movies123", kind: url.pathname.startsWith("/movie/") || url.searchParams.has("episode") ? "media" : "collection", title: clean(title), url: url.href };
}

const poster = (slug: string) => `https://img.icdn.my.id/thumb/w_200/h_300/${slug}.jpg`;

export async function movies123Title(value: string, signal?: AbortSignal, request: typeof fetch = globalThis.fetch): Promise<{ item: ProviderItem; episodes: number[]; id: string; servers: number[] }> {
  const url = movies123PageUrl(value);
  if (!url) throw new ProviderError("Choose a 123MoviesFree film or season link.", 400);
  const episode = Number(url.searchParams.get("episode") ?? 0);
  url.search = "";
  const html = await movies123Text(url.href, signal, request);
  const tags = [...html.matchAll(/<(?:div|button)\b[^>]*>/g)].map(match => attributes(match[0]));
  const mid = tags.find(tag => tag.id === "mid");
  const slug = url.pathname.split("/")[2]!;
  const id = /-(\d+)$/.exec(slug)![1]!;
  const movie = url.pathname.startsWith("/movie/");
  const name = clean(text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ""));
  if (!name || mid?.["data-mid"] !== id || mid["data-mode"] !== (movie ? "movie" : "serie")) throw changed();
  const episodes = [...new Set(tags.filter(tag => tag.class?.split(/\s+/).includes("episode") && /^ep-[1-9]\d{0,2}$/.test(tag.id ?? "")).map(tag => Number(tag.id!.slice(3))))].sort((a, b) => a - b);
  if (!movie && (!episodes.length || episodes.at(-1)! > 500)) throw changed();
  if (episode && !episodes.includes(episode)) throw new ProviderError("123MoviesFree does not have this episode.", 404);
  const description = clean(text(/<div\b[^>]*class=["'][^"']*\bfst-italic\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""), 2000);
  const field = (name: string) => clean(text(new RegExp(`<strong>${name}:<\\/strong>([\\s\\S]*?)<\\/p>`).exec(html)?.[1] ?? ""));
  const length = /^(?:(\d{1,2})h\s*)?(?:(\d{1,3})m)$/.exec(field("Duration"));
  const duration = length ? Number(length[1] ?? 0) * 3600 + Number(length[2]) * 60 : undefined;
  const subtitle = [field("Release"), field("Quality")].filter(Boolean).join(" · ");
  const metadata = { thumbnail: poster(slug), ...(description ? { description } : {}), ...(subtitle ? { subtitle } : {}), ...(duration ? { duration } : {}) };
  const collection = { title: name, url: url.href };
  if (episode) url.searchParams.set("episode", String(episode));
  return { item: item(url, episode ? `${name} — Episode ${episode}` : name, { ...metadata, ...(episode ? { collection: { ...collection, index: episodes.indexOf(episode) } } : {}) }), episodes, id,
    servers: [...new Set(tags.filter(tag => tag.class?.split(/\s+/).includes("server") && /^srv-[125]$/.test(tag.id ?? "")).map(tag => Number(tag.id!.slice(4))))] };
}

function catalogTarget(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Use a 123MoviesFree catalogue link.", 400); }
  if (!["https:", "http:"].includes(url.protocol) || !isMovies123Host(url.hostname) || url.port || url.username || url.password || url.search || url.hash
    || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value) || !/^\/(?:home\/?|(?:movies|tv-series)(?:\/{1,2}[1-9]\d{0,3})?\/?)?$/.test(url.pathname)) throw new ProviderError("Use a 123MoviesFree film, season or catalogue link.", 400);
  url.protocol = "https:";
  url.pathname = url.pathname === "/" || /^\/home\/?$/.test(url.pathname) ? "/movies/" : url.pathname.replace(/\/{2,}/g, "/").replace(/\/?$/, "/");
  return url;
}

function catalogPage(html: string, url: URL): ProviderPage {
  const items = new Map<string, ProviderItem>();
  let nextCursor: string | undefined;
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attr = attributes(match[1]!);
    if (!attr.href) continue;
    let target: URL;
    try { target = new URL(attr.href, url); } catch { continue; }
    if (target.origin !== url.origin) continue;
    if (attr["aria-label"] === "Next") {
      try {
        const next = catalogTarget(target.href);
        const number = /\/(\d+)\/$/.exec(next.pathname)?.[1];
        const current = Number(/\/(\d+)\/$/.exec(url.pathname)?.[1] ?? 1);
        if (next.pathname.split("/")[1] === url.pathname.split("/")[1] && Number(number) === current + 1) nextCursor = number;
      } catch { /* A foreign or malformed next link is not a cursor. */ }
    }
    if (!attr.class?.split(/\s+/).includes("poster")) continue;
    const page = movies123PageUrl(target.href);
    const title = clean(text(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(match[2]!)?.[1] ?? ""));
    if (!page || page.search || !title) continue;
    items.set(page.href, item(page, title, { thumbnail: poster(page.pathname.split("/")[2]!) }));
    if (items.size > 120) throw changed();
  }
  if (!items.size || !/\blist-movie\b/.test(html)) throw changed();
  return { title: url.pathname.startsWith("/tv-series/") ? "123MoviesFree · TV series" : "123MoviesFree · Movies", items: [...items.values()], ...(nextCursor ? { nextCursor } : {}) };
}

export async function browseMovies123(request: BrowseRequest, signal?: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  const query = request.query?.trim();
  if (request.cursor !== undefined && !(query ? /^\d{1,6}$/.test(request.cursor) && Number(request.cursor) <= 240_000 : /^[1-9]\d{0,3}$/.test(request.cursor))) throw new ProviderError("Invalid 123MoviesFree page cursor.", 400);
  if (query) {
    if (query.length < 2 || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) throw new ProviderError("Search 123MoviesFree with 2 to 200 characters.", 400);
    const offset = Number(request.cursor ?? 0);
    const url = `${movies123Origin}/searching?${new URLSearchParams({ q: query, limit: String(pageSize), offset: String(offset) })}`;
    const result = await providerJson(url, { signal, credentials: "omit", headers: { Accept: "application/json" } }, fetchPage);
    if (!object(result) || !Array.isArray(result.data) || !object(result.meta) || !Number.isSafeInteger(result.meta.total_items) || Number(result.meta.total_items) < 0 || result.data.length > pageSize) throw changed();
    const items = result.data.flatMap(row => {
      if (!object(row) || !["m", "s"].includes(String(row.d))) return [];
      const title = clean(row.t), slug = clean(row.s, 220);
      if (!/^[a-z0-9][a-z0-9-]*-[1-9]\d{0,11}$/.test(slug)) return [];
      const url = movies123PageUrl(`${movies123Origin}/${row.d === "m" ? "movie" : "season"}/${slug}/`);
      if (!title || !url) return [];
      const subtitle = [typeof row.y === "number" && row.y >= 1800 && row.y <= 2200 ? String(row.y) : "", clean(row.q, 20)].filter(Boolean).join(" · ");
      return [item(url, title, { thumbnail: poster(slug), ...(subtitle ? { subtitle } : {}) })];
    });
    if (result.data.length && !items.length) throw changed();
    const next = offset + result.data.length;
    return { title: `123MoviesFree: ${query}`, items: [...new Map(items.map(item => [item.id, item])).values()], ...(items.length && next < Number(result.meta.total_items) && next <= 240_000 ? { nextCursor: String(next) } : {}) };
  }
  const publicPage = request.url && movies123PageUrl(request.url);
  if (publicPage) {
    if (request.cursor) throw new ProviderError("This 123MoviesFree title has no further catalogue pages.", 400);
    const title = await movies123Title(publicPage.href, signal, fetchPage);
    const selected = title.item;
    const items = selected.kind === "media" ? [selected] : title.episodes.map((episode, index) => {
      const url = new URL(selected.url);
      url.searchParams.set("episode", String(episode));
      return item(url, `${selected.title} — Episode ${episode}`, { ...selected, collection: { title: selected.title, url: selected.url, index } });
    });
    return { item: selected, title: selected.title, thumbnail: selected.thumbnail, description: selected.description, subtitle: selected.subtitle, ...(selected.collection ? { parent: selected.collection } : {}), items };
  }
  const target = catalogTarget(request.url || `${movies123Origin}/movies/`);
  if (request.cursor) target.pathname = `/${target.pathname.split("/")[1]}/${request.cursor}/`;
  return catalogPage(await movies123Text(target.href, signal, fetchPage), target);
}

export async function loadMovies123List(value: string, signal?: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderPage> {
  if (!movies123PageUrl(value)) throw new ProviderError("Choose a 123MoviesFree film or season to queue.", 400);
  return browseMovies123({ url: value }, signal, fetchPage);
}
