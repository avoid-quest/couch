import { publicFetch } from "../public-network";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { animeUnityOrigin, animeUnitySiteOrigin, animeUnityPageUrl, isAnimeUnityHost } from "../../shared/animeunity";
import { ProviderError, providerItemId, readProviderText } from "./http";

const changed = () => new ProviderError("AnimeUnity changed this page or it is unavailable. Try again shortly.");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, maximum = 200) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : "";
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < 1e12;

// Decode attributes only; provider markup and scripts never enter the UI.
function entities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return named[name] ?? entity;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match => [match[1]!.toLowerCase(), entities(match[2] ?? match[3] ?? "")]));
}

function json(value: string | undefined): unknown {
  try { return JSON.parse(value ?? ""); } catch { throw changed(); }
}

function image(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port) return url.href;
  } catch { /* An optional image never prevents browsing. */ }
}

async function readText(url: string, signal: AbortSignal | undefined, request: typeof fetch, init: RequestInit = {}) {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  cancellation.throwIfAborted();
  const response = await request(url, { ...init, signal: cancellation, credentials: "omit", redirect: "error", headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0", ...init.headers } });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(response.status === 404 ? "AnimeUnity does not have this page." : "AnimeUnity did not load this page. Try again shortly.", response.status === 404 ? 404 : 502);
  }
  return { text: await readProviderText(response, 4 * 1024 * 1024, cancellation, changed()), response, origin: new URL(url).origin };
}

// Like StreamingCommunity, recover through redirects or its published domain tracker.
// Keep public item identities stable; only the transport origin changes within Core.
const origins = new WeakMap<typeof fetch, { origin: string; retryAt: number; pending?: Promise<string | undefined> }>();
const addressPage = "https://domains-tracker.server66.workers.dev/get";

function siteOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && isAnimeUnityHost(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === "/") return url.origin;
  } catch { /* Not a published site address. */ }
}

async function servingOrigin(origin: string, signal: AbortSignal, request: typeof fetch): Promise<string | undefined> {
  try {
    for (let hop = 0; hop < 4; hop++) {
      const cancellation = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
      const response = await request(`${origin}/archivio`, { signal: cancellation, credentials: "omit", redirect: "manual", headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" } });
      cancellation.throwIfAborted();
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (hop === 3) return;
        const target = location && new URL(location, origin);
        // A domain move may redirect every path to the homepage. Retry /archivio.
        if (!target || !["/", "/archivio"].includes(target.pathname)) return;
        const next = siteOrigin(target.href.replace(/\/archivio$/, "/"));
        if (!next || next === origin) return;
        origin = next;
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return; }
      const text = await readProviderText(response, 4 * 1024 * 1024, cancellation, changed());
      const attrs = attributes(/<archivio\b[^>]*>/i.exec(text)?.[0] ?? "");
      const rows = json(attrs.records), total = Number(attrs.tot_count);
      if (Array.isArray(rows) && rows.length > 0 && rows.length <= 30 && rows.some(row => animeItem(row)) && Number.isSafeInteger(total) && total >= rows.length && total <= 100_000) return origin;
    }
  } catch { signal.throwIfAborted(); /* An unreachable or changed candidate is not adopted. */ }
}

export async function animeUnityText<T = undefined>(url: string, signal?: AbortSignal, request: typeof fetch = publicFetch, init: RequestInit = {}, parse?: (text: string) => T) {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25_000)]);
  cancellation.throwIfAborted();
  let state = origins.get(request);
  if (!state) { state = { origin: animeUnitySiteOrigin, retryAt: 0 }; origins.set(request, state); }
  const attemptedOrigin = state.origin;
  const load = async () => {
    const target = new URL(url);
    const referer = new Headers(init.headers).get("Referer");
    if (init.method === "POST" && referer && new URL(referer).origin !== state.origin) throw changed();
    const result = await readText(state.origin + target.pathname + target.search, cancellation, request, init);
    return { ...result, parsed: parse?.(result.text) };
  };
  try { return await load(); } catch (error) {
    cancellation.throwIfAborted();
    // Do not replay POSTs with cookies/CSRF tokens from another origin, or heal a missing title.
    if (init.method && init.method !== "GET" || error instanceof ProviderError && error.status === 404) throw error;
    if (state.origin !== attemptedOrigin) return load();
    if (!state.pending && Date.now() >= state.retryAt) {
      const current = state;
      const recovery = AbortSignal.timeout(20_000);
      current.pending = (async () => {
        let found = await servingOrigin(current.origin, recovery, request);
        if (!found) {
          try {
            const result = json((await readText(addressPage, recovery, request, { headers: { Accept: "application/json" } })).text);
            const entry = object(result) && object(result.animeunity) ? result.animeunity : undefined;
            const candidate = typeof entry?.full_url === "string" && siteOrigin(entry.full_url);
            if (candidate && candidate !== current.origin) found = await servingOrigin(candidate, recovery, request);
          } catch { recovery.throwIfAborted(); /* The tracker can be unavailable too. */ }
        }
        recovery.throwIfAborted();
        if (found) current.origin = found;
        return found;
      })().finally(() => { current.pending = undefined; current.retryAt = Date.now() + 600_000; });
    }
    if (!state.pending) throw error;
    // A caller may leave immediately without cancelling another caller's recovery.
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(cancellation.reason);
      cancellation.addEventListener("abort", abort, { once: true });
      if (cancellation.aborted) abort();
    });
    try { if (!await Promise.race([state.pending, cancelled])) throw error; }
    finally { cancellation.removeEventListener("abort", abort); }
    cancellation.throwIfAborted();
    return load();
  }
}

function animeItem(row: unknown): ProviderItem | undefined {
  if (!object(row) || !id(row.id) || typeof row.slug !== "string") return;
  const url = animeUnityPageUrl(`${animeUnityOrigin}/anime/${row.id}-${row.slug}`);
  const title = clean(entities(clean(row.title_eng) || clean(row.title) || clean(row.title_it)));
  if (!url || !title) return;
  const description = clean(entities(clean(row.plot, 4000)).replace(/<[^>]*>/g, ""), 2000);
  const subtitle = [clean(row.date, 20), clean(row.type, 20), row.dub === 1 ? "ITA" : "SUB ITA"].filter(Boolean).join(" · ");
  const minutes = typeof row.episodes_length === "number" && row.episodes_length > 0 && row.episodes_length <= 1440 ? row.episodes_length : undefined;
  return { id: providerItemId("animeunity", url.href), provider: "animeunity", kind: "collection", title, url: url.href,
    thumbnail: image(row.imageurl), ...(description ? { description } : {}), subtitle, ...(minutes ? { duration: minutes * 60 } : {}) };
}

type Episode = { id: number; anime_id: number; number: string; public: number; scws_id?: number; link?: string };

function episodes(value: unknown, animeId: number): Episode[] {
  if (!Array.isArray(value) || value.length > 120) throw changed();
  const seen = new Set<number>();
  return value.map(row => {
    if (!object(row) || !id(row.id) || row.anime_id !== animeId || typeof row.number !== "string" || !/^\d{1,5}(?:[.-]\d{1,5}){0,5}$/.test(row.number) || ![0, 1].includes(Number(row.public)) || seen.has(row.id)) throw changed();
    seen.add(row.id);
    return { id: row.id, anime_id: animeId, number: row.number, public: Number(row.public), ...(id(row.scws_id) ? { scws_id: row.scws_id } : {}), ...(typeof row.link === "string" ? { link: row.link } : {}) };
  });
}

function episodeItem(collection: ProviderItem, episode: Episode, index?: number): ProviderItem {
  const url = `${collection.url}/${episode.id}`;
  return { ...collection, id: providerItemId("animeunity", url), kind: "media", title: `${collection.title} — Episode ${episode.number}`.slice(0, 200), url,
    collection: { title: collection.title, url: collection.url, ...(index !== undefined && index <= 2400 ? { index } : {}) } };
}

export async function animeUnityTitle(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch) {
  const url = animeUnityPageUrl(value);
  if (!url) throw new ProviderError("Choose an AnimeUnity anime or episode link.", 400);
  const { parsed, origin } = await animeUnityText(url.href, signal, request, {}, text => parseTitle(text, url));
  return { ...parsed!, origin };
}

function parseTitle(text: string, url: URL) {
  const attributes_ = attributes(/<video-player\b[^>]*>/i.exec(text)?.[0] ?? "");
  const anime = json(attributes_.anime), selected = json(attributes_.episode || "null");
  const collection = animeItem(anime);
  const count = Number(attributes_.episodes_count);
  if (!object(anime) || !collection || collection.url !== `${animeUnityOrigin}/anime/${url.pathname.split("/")[2]}` || !Number.isSafeInteger(count) || count < 0 || count > 10_000) throw changed();
  const rawRows = episodes(json(attributes_.episodes || "[]"), Number(anime.id));
  const rows = rawRows.filter(row => row.public === 1);
  const episode = selected === null || selected === false ? undefined : episodes([selected], Number(anime.id)).find(row => row.public === 1);
  const episodeId = url.pathname.split("/")[3];
  if (episodeId && (!episode || episode.id !== Number(episodeId))) throw new ProviderError("AnimeUnity does not have this episode.", 404);
  if (episode && !rows.some(row => row.id === episode.id)) throw changed();
  const firstRange = rows.length > 0 && Number(rows[0]!.number.split("-")[0]) <= 120;
  const index = firstRange && episode ? rows.findIndex(row => row.id === episode.id) : undefined;
  return { item: episodeId && episode ? episodeItem(collection, episode, index) : collection, collection, episodes: rows,
    episodeNumbers: rawRows.flatMap(row => row.number.split("-").map(Number)), episode, count, embedUrl: attributes_.embed_url };
}

async function episodeRange(title: Awaited<ReturnType<typeof animeUnityTitle>>, start: number, signal: AbortSignal | undefined, request: typeof fetch): Promise<Episode[]> {
  const animeId = Number(title.collection.url.split("/").at(-1)!.split("-")[0]);
  const number = title.episode?.number ?? title.episodes[0]?.number ?? "1";
  const target = `${animeUnityOrigin}/info_api/${animeId}/${number}?${new URLSearchParams({ start_range: String(start), end_range: String(Math.min(start + 119, title.count)) })}`;
  const result = json((await animeUnityText(target, signal, request, { headers: { Accept: "application/json" } })).text);
  if (!object(result) || result.episodes_count !== title.count) throw changed();
  const rows = episodes(result.episodes, animeId);
  if (rows.some(row => { const number = Number(row.number.split("-")[0]); return number < start || number > start + 119; })) throw changed();
  return rows;
}

function titlePage(title: Awaited<ReturnType<typeof animeUnityTitle>>, rows: Episode[], firstRange: boolean, nextCursor?: string): ProviderPage {
  const selected = title.item;
  const items = selected.kind === "media" ? [selected] : rows.filter(row => row.public === 1).map((row, index) => episodeItem(title.collection, row, firstRange ? index : undefined));
  return { item: selected, title: selected.title, thumbnail: selected.thumbnail, description: selected.description, subtitle: selected.subtitle, ...(selected.collection ? { parent: selected.collection } : {}), items, ...(nextCursor ? { nextCursor } : {}) };
}

function catalogTarget(value: string): URL {
  try {
    const url = new URL(value);
    if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value) || !["http:", "https:"].includes(url.protocol) || !isAnimeUnityHost(url.hostname) || url.port || url.username || url.password || url.hash || !/^\/(?:archivio\/?)?$/.test(url.pathname) || url.search && !/^\?title=[^&]*$/.test(url.search)) throw 0;
    return new URL(`/archivio${url.search}`, animeUnityOrigin);
  } catch { throw new ProviderError("Use an AnimeUnity anime or catalogue link.", 400); }
}

function catalogRows(rows: unknown, total: number, offset = 0) {
  if (!Array.isArray(rows) || rows.length > 30 || !Number.isSafeInteger(total) || total < 0 || total > 100_000 || !rows.length && offset < total) throw changed();
  const items = [...new Map(rows.flatMap(row => { const item = animeItem(row); return item ? [[item.url, item] as const] : []; })).values()];
  if (rows.length && !items.length) throw changed();
  return { rows, total, items };
}

function parseCatalog(text: string) {
  const attrs = attributes(/<archivio\b[^>]*>/i.exec(text)?.[0] ?? "");
  return catalogRows(json(attrs.records), Number(attrs.tot_count));
}

async function catalog(request_: BrowseRequest, signal: AbortSignal | undefined, request: typeof fetch): Promise<ProviderPage> {
  const target = catalogTarget(request_.url || `${animeUnityOrigin}/archivio`);
  const query = (request_.query ?? target.searchParams.get("title") ?? "").trim();
  if (query && (query.length < 2 || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query))) throw new ProviderError("Search AnimeUnity with 2 to 200 characters.", 400);
  if (query) target.searchParams.set("title", query); else target.search = "";
  const offset = Number(request_.cursor ?? 0);
  if (request_.cursor !== undefined && (!/^\d{1,6}$/.test(request_.cursor) || offset > 100_000)) throw new ProviderError("Invalid AnimeUnity catalogue cursor.", 400);
  const first = await animeUnityText(target.href, signal, request, {}, parseCatalog);
  let { rows, total, items } = first.parsed!;
  if (offset) {
    const token = [...first.text.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0])).find(attr => attr.name === "csrf-token")?.content;
    // These anonymous cookies belong only to this catalogue request, never an account.
    const cookies = first.response.headers.getSetCookie().filter(cookie => /^(?:XSRF-TOKEN|animeunity_session)=/.test(cookie)).map(cookie => cookie.split(";")[0]!).join("; ");
    if (!token || !/^[a-zA-Z0-9]{20,100}$/.test(token) || !cookies || cookies.length > 8192 || /[\r\n]/.test(cookies)) throw changed();
    const result = json((await animeUnityText(`${animeUnityOrigin}/archivio/get-animes`, signal, request, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": token, Cookie: cookies, Referer: first.origin + target.pathname + target.search }, body: JSON.stringify({ title: query || false, offset, type: false, year: false, order: false, status: false, genres: false, dubbed: false, season: false }) })).text);
    if (!object(result)) throw changed();
    ({ rows, total, items } = catalogRows(result.records, Number(result.tot), offset));
  }
  return { title: query ? `AnimeUnity: ${query}` : "AnimeUnity", items, ...(rows.length && offset + rows.length < total ? { nextCursor: String(offset + rows.length) } : {}) };
}

export async function browseAnimeUnity(request_: BrowseRequest, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<ProviderPage> {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25_000)]);
  cancellation.throwIfAborted();
  const page = request_.url && animeUnityPageUrl(request_.url);
  if (!page) return catalog(request_, cancellation, request);
  const start = Number(request_.cursor ?? 1);
  if (request_.cursor !== undefined && (!/^[1-9]\d{0,4}$/.test(request_.cursor) || start > 10_000 || (start - 1) % 120 !== 0 || page.pathname.split("/").length > 3)) throw new ProviderError("Invalid AnimeUnity episode cursor.", 400);
  const title = await animeUnityTitle(page.href, cancellation, request);
  if (start > Math.max(title.count, 1)) throw new ProviderError("AnimeUnity does not have this episode page.", 404);
  const rows = start === 1 ? title.episodes : await episodeRange(title, start, cancellation, request);
  return titlePage(title, rows, start === 1, title.item.kind === "collection" && start + 120 <= title.count ? String(start + 120) : undefined);
}

export async function loadAnimeUnityList(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<ProviderPage> {
  if (!animeUnityPageUrl(value)) throw new ProviderError("Choose an AnimeUnity anime or episode to queue.", 400);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25_000)]);
  const title = await animeUnityTitle(value, cancellation, request);
  if (title.item.kind === "media") return titlePage(title, title.episodes, false);
  if (title.count > 500) throw new ProviderError("This anime has more than 500 episodes. Choose individual episodes instead.", 400);
  const rows = [...title.episodes];
  for (let start = 121; start <= title.count; start += 120) rows.push(...await episodeRange(title, start, cancellation, request));
  // Combined labels cover several episode numbers, including unpublished rows.
  // Check coverage before filtering so a partial response cannot shift indices.
  const covered = new Set([...title.episodeNumbers, ...rows.flatMap(row => row.number.split("-").map(Number))]);
  for (let number = 1; number <= title.count; number++) if (!covered.has(number)) throw changed();
  if (!rows.some(row => row.public === 1)) throw new ProviderError("AnimeUnity has no playable episodes for this anime.", 404);
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length > 500) throw changed();
  return titlePage(title, rows, true);
}
