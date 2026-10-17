import { publicFetch } from "../public-network";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { animeSaturnPageUrl, animesaturnOrigin, isAnimeSaturnHost } from "../../shared/animesaturn";
import { ProviderError, providerItemId, readProviderText } from "./http";

const chunkSize = 50;
const changed = () => new ProviderError("AnimeSaturn changed this page or it is unavailable. Try again shortly.");
const clean = (value: string, limit = 200) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);

// Read public text and attributes only. Site markup and scripts never enter the UI.
function text(value: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", raquo: "»" };
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return entities[name] ?? entity;
    const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1]!.toLowerCase(), text(match[2] ?? match[3] ?? match[4] ?? "")]));
}

function publicImage(value: string | undefined): string | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value, animesaturnOrigin);
    if (url.protocol === "https:" && isAnimeSaturnHost(url.hostname) && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/wp-content\/uploads\/[\w/.-]+\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname)) return url.href;
  } catch { /* An invalid optional image does not prevent browsing. */ }
}

export async function animeSaturnText(url: string, signal?: AbortSignal, request: typeof fetch = publicFetch, init: RequestInit = {}): Promise<string> {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  cancellation.throwIfAborted();
  const response = await request(url, { ...init, signal: cancellation, credentials: "omit", redirect: "error", headers: { Accept: "text/html, application/json", "User-Agent": "Mozilla/5.0", Referer: `${animesaturnOrigin}/`, ...init.headers } });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError(response.status === 404 ? "AnimeSaturn does not have this page." : "AnimeSaturn did not load this page. Try again shortly.", response.status === 404 ? 404 : 502);
  }
  return readProviderText(response, 2 * 1024 * 1024, cancellation, changed());
}

function item(url: URL, title: string, metadata: Partial<ProviderItem> = {}): ProviderItem {
  return { ...metadata, id: providerItemId("animesaturn", url.href), provider: "animesaturn", kind: url.pathname.startsWith("/anime/") ? "collection" : "media", title: clean(title), url: url.href };
}

type EpisodeList = { series: string; pages: number; total: number; nonce?: string; first: string };
type AnimeSaturnTitle = { item: ProviderItem; players: string[]; episodes?: EpisodeList };

function episodeList(html: string): EpisodeList {
  const tag = [...html.matchAll(/<div\b[^>]*>/g)].map(match => attributes(match[0])).find(tag => tag.id === "episodes");
  if (!tag || !/^[1-9]\d{0,11}$/.test(tag["data-series"] ?? "") || !/^\d{1,4}$/.test(tag["data-total"] ?? "") || !/^[1-9]\d{0,2}$/.test(tag["data-pages"] ?? "")) throw changed();
  const total = Number(tag["data-total"]), pages = Number(tag["data-pages"]);
  if (total > 2400 || pages !== Math.max(1, Math.ceil(total / chunkSize))) throw changed();
  const nonce = /\bvar\s+nonce\s*=\s*['"]([a-f\d]{10})['"]/.exec(html)?.[1];
  const first = [...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/g)].find(match => {
    const attr = attributes(match[1]!);
    return attr.class?.split(/\s+/).includes("ep-page") && attr["data-eppage"] === "0";
  })?.[2];
  if (first === undefined || pages > 1 && !nonce) throw changed();
  return { series: tag["data-series"]!, total, pages, nonce, first };
}

function playerUrls(html: string): string[] {
  const embeds = [html];
  for (const match of html.matchAll(/loadMi\(\{\s*value:\s*'([A-Za-z\d+/=]{1,8192})'/g)) embeds.push(Buffer.from(match[1]!, "base64").toString("utf8"));
  const players = new Set<string>();
  for (const embed of embeds) for (const match of embed.matchAll(/<iframe\b[^>]*>/g)) {
    const source = attributes(match[0]).src;
    if (!source || source.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(source)) continue;
    try {
      const url = new URL(source);
      if (url.origin !== animesaturnOrigin || url.username || url.password || url.hash || url.pathname !== "/wp-content/themes/animestream-child/player/" || !["megavid_panel", "animesaturn_live"].includes(url.searchParams.get("source") ?? "")) continue;
      if ([...url.searchParams.keys()].some(key => !["source", "url", "poster"].includes(key) || url.searchParams.getAll(key).length !== 1)) continue;
      const target = url.searchParams.get("url") ?? "";
      if (!target || target.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(target)) continue;
      if (url.searchParams.get("source") === "animesaturn_live" && !/^\/episode\/[a-zA-Z\d-]+\/ep-\d{1,5}$/.test(target)) continue;
      if (url.searchParams.get("source") === "megavid_panel" && !/^[A-Za-z\d+/=]+$/.test(target)) continue;
      players.add(url.href);
    } catch { /* Ignore unrelated or malformed embeds. */ }
  }
  return [...players].slice(0, 4);
}

export async function animeSaturnTitle(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<AnimeSaturnTitle> {
  const url = animeSaturnPageUrl(value);
  if (!url) throw new ProviderError("Choose an AnimeSaturn anime or episode link.", 400);
  const html = await animeSaturnText(url.href, signal, request);
  const name = clean(text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? ""));
  if (!name) throw changed();
  const meta = [...html.matchAll(/<meta\b[^>]*>/g)].map(match => attributes(match[0]));
  const thumbnail = publicImage(meta.find(tag => tag.property === "og:image")?.content);
  const description = clean(text(/<div\b[^>]*class=["']desc["'][^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""), 2000);
  const minutes = /<b>Durata:<\/b>\s*(\d{1,3})\s*min\b/.exec(html)?.[1];
  const metadata = { ...(thumbnail ? { thumbnail } : {}), ...(description ? { description } : {}), ...(minutes && Number(minutes) > 0 ? { duration: Number(minutes) * 60 } : {}) };
  if (url.pathname.startsWith("/anime/")) return { item: item(url, name, metadata), players: [], episodes: episodeList(html) };
  if (!/<article\b[^>]*itemtype=["']https?:\/\/schema\.org\/Episode["']/.test(html)) throw changed();
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? "";
  const parent = [...article.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].flatMap(match => {
    const attr = attributes(match[1]!);
    const page = animeSaturnPageUrl(attr.href ?? "");
    const title = clean(text(match[2]!));
    return page?.pathname.startsWith("/anime/") && title ? [{ title, url: page.href }] : [];
  })[0];
  if (!parent) throw changed();
  return { item: item(url, name, { ...metadata, collection: parent }), players: playerUrls(article) };
}

function episodeItems(html: string, selected: ProviderItem, page: number, total: number): ProviderItem[] {
  const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => {
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(match[1]!);
    const url = animeSaturnPageUrl(attributes(anchor?.[1] ?? "").href ?? "");
    const number = clean(text(/<div\b[^>]*class=["']epl-num["'][^>]*>([\s\S]*?)<\/div>/.exec(anchor?.[2] ?? "")?.[1] ?? ""));
    const title = clean(text(/<div\b[^>]*class=["']epl-title["'][^>]*>([\s\S]*?)<\/div>/.exec(anchor?.[2] ?? "")?.[1] ?? ""));
    if (!url || url.pathname.startsWith("/anime/") || !title || !/^\d{1,5}(?:\.\d{1,2})?$/.test(number)) throw changed();
    return { url, title, number: Number(number) };
  }).sort((a, b) => a.number - b.number);
  if (rows.length !== Math.min(chunkSize, total - page * chunkSize) || new Set(rows.map(row => row.url.href)).size !== rows.length) throw changed();
  return rows.map((row, index) => item(row.url, /^(?:Episode|Episodio)\s+\d/i.test(row.title) ? `${selected.title} — ${row.title}` : row.title, { thumbnail: selected.thumbnail, duration: selected.duration, collection: { title: selected.title, url: selected.url, index: page * chunkSize + index } }));
}

async function episodeChunk(selected: ProviderItem, episodes: EpisodeList, page: number, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<ProviderItem[]> {
  let html = episodes.first;
  if (page) {
    const body = new URLSearchParams({ action: "miruro_load_eplchunk", nonce: episodes.nonce!, series: episodes.series, page: String(page) });
    const response = await animeSaturnText(`${animesaturnOrigin}/wp-admin/admin-ajax.php`, signal, request, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    let data: { success?: unknown; data?: { html?: unknown } };
    try { data = JSON.parse(response); } catch { throw changed(); }
    if (!data || data.success !== true || typeof data.data?.html !== "string" || data.data.html.length > 256 * 1024) throw changed();
    html = data.data.html;
  }
  return episodeItems(html, selected, page, episodes.total);
}

function catalogueUrl(value: string): URL {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new ProviderError("Choose an AnimeSaturn catalogue link.", 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Choose an AnimeSaturn catalogue link.", 400); }
  if (!["https:", "http:"].includes(url.protocol) || !isAnimeSaturnHost(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/(?:anime\/(?:page\/[1-9]\d{0,3}\/)?)?$/.test(url.pathname)) throw new ProviderError("Choose an AnimeSaturn anime, episode or catalogue link.", 400);
  return new URL(url.pathname === "/" ? "/anime/" : url.pathname, animesaturnOrigin);
}

function cataloguePage(html: string, target: URL, query?: string): ProviderPage {
  const start = /<div\b[^>]*class=["']postbody["'][^>]*>/.exec(html)?.index;
  if (start === undefined) throw changed();
  const body = html.slice(start).split(/<div\b[^>]*id=["']sidebar["']/)[0]!;
  const items = new Map<string, ProviderItem>();
  for (const match of body.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)) {
    if (!attributes(match[1]!).class?.split(/\s+/).includes("bs")) continue;
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/.exec(match[2]!);
    const attr = attributes(anchor?.[1] ?? ""), page = animeSaturnPageUrl(attr.href ?? "");
    const name = clean(text(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(anchor?.[2] ?? "")?.[1] ?? attr.title ?? ""));
    if (!page?.pathname.startsWith("/anime/") || !name) continue;
    const image = /<img\b[^>]*>/.exec(anchor?.[2] ?? "")?.[0];
    const thumbnail = publicImage(attributes(image ?? "").src);
    items.set(page.href, item(page, name, { ...(thumbnail ? { thumbnail } : {}) }));
    if (items.size > 100) throw changed();
  }
  if (!/class=["'][^"']*\blistupd\b/.test(body) || !items.size && (!query || !/<h3>Non trovato<\/h3>/.test(body))) throw changed();
  let nextCursor: string | undefined;
  for (const match of body.matchAll(/<a\b([^>]*)>/g)) {
    const attr = attributes(match[1]!);
    if (!attr.class?.split(/\s+/).includes("next")) continue;
    try {
      const next = new URL(attr.href!, target);
      const number = /^\/(?:anime\/)?page\/([1-9]\d{0,3})\/$/.exec(next.pathname)?.[1];
      const current = Number(/\/page\/(\d+)\/$/.exec(target.pathname)?.[1] ?? 1);
      if (next.origin === animesaturnOrigin && !next.username && !next.password && !next.hash && number && Number(number) === current + 1 && (query ? next.searchParams.size === 1 && next.searchParams.get("s") === query && !next.pathname.startsWith("/anime/") : !next.search && next.pathname.startsWith("/anime/"))) nextCursor = number;
    } catch { /* Only the next public catalogue page is a cursor. */ }
  }
  return { title: query ? `AnimeSaturn: ${query}` : "AnimeSaturn", items: [...items.values()], ...(nextCursor ? { nextCursor } : {}) };
}

export async function browseAnimeSaturn(input: BrowseRequest, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  if (input.cursor !== undefined && !/^(?:0|[1-9]\d{0,3})$/.test(input.cursor)) throw new ProviderError("Invalid AnimeSaturn page cursor.", 400);
  const query = input.query?.trim();
  if (query) {
    if (query.length < 2 || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) throw new ProviderError("Search AnimeSaturn with 2 to 200 characters.", 400);
    if (input.cursor === "0") throw new ProviderError("Invalid AnimeSaturn page cursor.", 400);
    const target = new URL(input.cursor ? `/page/${input.cursor}/` : "/", animesaturnOrigin);
    target.searchParams.set("s", query);
    return cataloguePage(await animeSaturnText(target.href, signal, request), target, query);
  }
  const page = input.url && animeSaturnPageUrl(input.url);
  if (page) {
    const title = await animeSaturnTitle(page.href, signal, request), selected = title.item;
    if (!title.episodes) {
      if (input.cursor !== undefined) throw new ProviderError("This AnimeSaturn episode has no further pages.", 400);
      return { item: selected, title: selected.title, thumbnail: selected.thumbnail, parent: selected.collection, items: [selected] };
    }
    const cursor = Number(input.cursor ?? 0);
    if (cursor >= title.episodes.pages) throw new ProviderError("Invalid AnimeSaturn episode page.", 400);
    const items = await episodeChunk(selected, title.episodes, cursor, signal, request);
    return { item: selected, title: selected.title, thumbnail: selected.thumbnail, description: selected.description, items, ...(cursor + 1 < title.episodes.pages ? { nextCursor: String(cursor + 1) } : {}) };
  }
  if (input.cursor === "0") throw new ProviderError("Invalid AnimeSaturn page cursor.", 400);
  const target = catalogueUrl(input.url || `${animesaturnOrigin}/anime/`);
  if (input.cursor) target.pathname = `/anime/page/${input.cursor}/`;
  return cataloguePage(await animeSaturnText(target.href, signal, request), target);
}

export async function loadAnimeSaturnList(value: string, signal?: AbortSignal, request: typeof fetch = publicFetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  const url = animeSaturnPageUrl(value);
  if (!url) throw new ProviderError("Choose an AnimeSaturn anime or episode to queue.", 400);
  const deadline = AbortSignal.timeout(30_000);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), deadline]);
  try {
    const title = await animeSaturnTitle(url.href, cancellation, request), selected = title.item;
    if (!title.episodes) return { item: selected, title: selected.title, parent: selected.collection, items: [selected] };
    if (title.episodes.total > 500) throw new ProviderError("This AnimeSaturn anime has more than 500 episodes. Choose an episode to play.", 400);
    const items: ProviderItem[] = [];
    for (let page = 0; page < title.episodes.pages; page++) items.push(...await episodeChunk(selected, title.episodes, page, cancellation, request));
    if (new Set(items.map(item => item.url)).size !== items.length) throw changed();
    return { item: selected, title: selected.title, thumbnail: selected.thumbnail, description: selected.description, items };
  } catch (error) {
    signal?.throwIfAborted();
    if (deadline.aborted) throw new ProviderError("AnimeSaturn took too long to load this anime. Try again shortly.");
    throw error;
  }
}
