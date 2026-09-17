import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extractor from "../../vendor/streamingcommunity/streamingcommunity.py" with { type: "text" };
import type { BrowseRequest, ProviderItem, ProviderPage, StreamingCommunityPreview } from "../shared/providers";
import { isStreamingCommunityHost, streamingCommunityOrigin, validStreamingCommunityOrigin } from "../shared/streamingcommunity";
import { ProviderError, providerItemId } from "./providers/http";

export function streamingCommunityLink(source: string, origin = streamingCommunityOrigin): boolean {
  const url = new URL(source);
  if (!validStreamingCommunityOrigin(origin)) throw new Error("StreamingCommunity needs a valid website origin in Settings > Sources.");
  if (url.origin !== origin) {
    if (/stream\w*unity/i.test(url.hostname)) throw new Error("This StreamingCommunity website is unavailable. Ask an administrator to update its origin in Settings > Sources, then paste a new item link. Saved links are not retargeted.");
    return false;
  }
  if (url.username || url.password || url.hash || !/^\/(?:[a-z]{2}\/)?(?:watch\/\d+|titles\/\d+(?:-[\w-]+)?)$/.test(url.pathname) || (url.search && !/^\?e=\d+$/.test(url.search))) throw new Error("Paste a StreamingCommunity film or episode link. Browsing, series and season links are not supported.");
  return true;
}

// Catalogue client over StreamingCommunity's Inertia web pages (see
// docs/research/2026-09-16-streamingcommunity-catalogue.md). Metadata only:
// playback stays with the pasted-link pipeline and its yt-dlp plugin.
const locale = "it";
const pageSize = 60;
const maximumPageBytes = 2 * 1024 * 1024;
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(row => object(row) ? row : null).filter((row): row is Record<string, unknown> => !!row) : [];
const integer = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const clean = (value: unknown, limit = 300) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
const unavailable = () => new ProviderError("This StreamingCommunity website is unavailable. Ask an administrator to update its origin in Settings > Sources, then try again.", 502);
const changed = () => new ProviderError("StreamingCommunity changed its website. Ask an administrator to check its origin in Settings > Sources, then try again shortly.", 502);
const needsOrigin = () => new ProviderError("StreamingCommunity needs a valid website origin in Settings > Sources.", 502);
const pad = (value: number) => String(value).padStart(2, "0");

function decodeEntities(value: string): string {
  return value.replace(/&(?:quot|apos|lt|gt|amp|#0?39|#x27);/g, entity => entity === "&quot;" ? "\"" : entity === "&lt;" ? "<" : entity === "&gt;" ? ">" : entity === "&amp;" ? "&" : "'");
}

export type InertiaPage = { component: string; props: Record<string, unknown> };

export function parseInertiaPage(html: string): InertiaPage {
  const match = /data-page="([^"]+)"/.exec(html);
  if (!match) throw changed();
  let page: unknown;
  try { page = JSON.parse(decodeEntities(match[1]!)); } catch { throw changed(); }
  if (!object(page) || typeof page.component !== "string" || !object(page.props)) throw changed();
  return { component: page.component, props: page.props };
}

async function streamingCommunityBody(url: URL, init: RequestInit, signal: AbortSignal | undefined, request: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await request(url, { credentials: "omit", redirect: "error", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]), ...init, headers: { "User-Agent": userAgent, Accept: "text/html, application/json", ...init.headers } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unavailable();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(response.status === 404 ? "StreamingCommunity does not have this page." : "StreamingCommunity did not load this page. Check its origin in Settings > Sources and try again shortly.", response.status === 404 ? 404 : 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumPageBytes) throw new ProviderError("StreamingCommunity returned too much data.", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

function translated(row: Record<string, unknown>, key: string, limit = 2000): string {
  const entries = array(row.translations).filter(entry => entry.key === key);
  return clean(entries.find(entry => entry.locale === locale)?.value, limit) || clean(entries[0]?.value, limit);
}

function cdnUrl(props: Record<string, unknown>, origin: string): string {
  const cdn = clean(props.cdn_url, 2048);
  if (/^https:\/\//.test(cdn) && !/[\u0000-\u001f\u007f]/.test(cdn)) return cdn;
  return `https://cdn.${new URL(origin).hostname}`;
}

function posterUrl(row: Record<string, unknown>, cdn: string): string | undefined {
  const image = array(row.images).find(entry => entry.type === "poster") ?? array(row.images).find(entry => entry.type === "cover");
  const filename = clean(image?.filename, 200);
  return /^[\w-]+\.[a-z0-9]{2,5}$/i.test(filename) ? `${cdn}/images/${filename}` : undefined;
}

function titleUrl(id: number, slug: string, origin: string) {
  return `${origin}/${locale}/titles/${id}-${slug}`;
}

function listItem(row: Record<string, unknown>, cdn: string, origin: string): ProviderItem | undefined {
  const id = integer(row.id);
  const slug = clean(row.slug, 200) || clean(translated(row, "slug", 200), 200);
  const name = translated(row, "name") || clean(row.name, 200);
  const type = row.type === "movie" || row.type === "tv" ? row.type : undefined;
  if (!id || !slug || !name || !type) return;
  const url = titleUrl(id, slug, origin);
  const poster = posterUrl(row, cdn);
  const plot = translated(row, "plot");
  const year = clean(row.release_date ?? row.last_air_date, 10).slice(0, 4);
  return {
    id: providerItemId("streamingcommunity", url), provider: "streamingcommunity", kind: type === "tv" ? "collection" : "media", title: name, url,
    ...(poster ? { thumbnail: poster } : {}), ...(plot ? { description: plot } : {}),
    subtitle: [year, type === "tv" ? "Series" : "Film"].filter(Boolean).join(" · "),
  };
}

type TitleContext = { id: number; name: string; base: string; watch: string; poster?: string; plot?: string; seasons: number[]; quality?: string; year?: string; runtime?: number };

function titleContext(page: InertiaPage, origin: string): TitleContext {
  if (page.component !== "Titles/Title") throw changed();
  const title = object(page.props.title) ? page.props.title : undefined;
  const id = integer(title?.id);
  const slug = clean(title?.slug, 200);
  const name = translated(title ?? {}, "name") || clean(title?.name, 200);
  if (!title || !id || !slug || !name) throw changed();
  const poster = posterUrl(title, cdnUrl(page.props, origin));
  const plot = translated(title, "plot") || clean(title.plot, 2000);
  const quality = clean(title.quality, 20);
  const year = clean(title.release_date, 10).slice(0, 4);
  const runtime = typeof title.runtime === "number" && title.runtime > 0 && title.runtime < 1440 ? title.runtime : undefined;
  return { id, name, base: titleUrl(id, slug, origin), watch: `${origin}/${locale}/watch/${id}`, poster, ...(plot ? { plot } : {}), ...(quality ? { quality } : {}), ...(year ? { year } : {}), ...(runtime ? { runtime } : {}), seasons: array(title.seasons).map(row => integer(row.number)).filter((season): season is number => !!season) };
}

function subtitleFor(context: TitleContext, series = false) {
  return [context.year, context.quality, series ? "Series" : "Film"].filter(Boolean).join(" · ");
}

function movieItem(context: TitleContext): ProviderItem {
  return {
    id: providerItemId("streamingcommunity", context.base), provider: "streamingcommunity", kind: "media", title: context.name, url: context.base,
    ...(context.poster ? { thumbnail: context.poster } : {}), ...(context.plot ? { description: context.plot } : {}),
    subtitle: subtitleFor(context),
    ...(context.runtime ? { duration: context.runtime * 60 } : {}),
  };
}

function episodeItem(context: TitleContext, seasonNumber: number, row: Record<string, unknown>): ProviderItem | undefined {
  const episodeId = integer(row.id);
  const number = integer(row.number);
  if (!episodeId || !number) return;
  const url = `${context.watch}?e=${episodeId}`;
  const name = clean(row.name, 200);
  const minutes = integer(row.duration);
  return {
    id: providerItemId("streamingcommunity", url), provider: "streamingcommunity", kind: "media",
    title: `S${pad(seasonNumber)}E${pad(number)}${name ? ` · ${name}` : ""}`, url,
    ...(context.poster ? { thumbnail: context.poster } : {}), ...(minutes && minutes < 1440 ? { duration: minutes * 60 } : {}),
  };
}

function seasonPageItems(page: InertiaPage, origin: string, season: number): { title?: string; items: ProviderItem[] } {
  const context = titleContext(page, origin);
  const loaded = object(page.props.loadedSeason) ? page.props.loadedSeason : undefined;
  const number = integer(loaded?.number) ?? season;
  const items = array(loaded?.episodes).map(row => episodeItem(context, number, row)).filter((item): item is ProviderItem => !!item);
  return { title: `${context.name} - Season ${number}`, items };
}

function titlePageItems(page: InertiaPage, origin: string): { title?: string; items: ProviderItem[] } {
  const context = titleContext(page, origin);
  if (!context.seasons.length) return { title: context.name, items: [movieItem(context)] };
  const items = context.seasons.map(season => {
    const url = `${context.base}/season-${season}`;
    return {
      id: providerItemId("streamingcommunity", url), provider: "streamingcommunity" as const, kind: "collection" as const, title: `Season ${season}`, url,
      ...(context.poster ? { thumbnail: context.poster } : {}), ...(context.plot ? { description: context.plot } : {}),
      subtitle: subtitleFor(context, true),
    };
  });
  return { title: context.name, items };
}

const cataloguePath = /^\/(?:[a-z]{2}\/)?(?:archive|search|browse\/genre|titles\/\d+(?:-[\w-]*)?(?:\/season-\d+)?)$/;
const listPath = /^\/(?:[a-z]{2}\/)?(?:archive|browse\/genre)$/;
const allowedParameter = /^[a-z_\[\]]{1,20}$/;

function catalogueTarget(value: string, cursor?: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Use a StreamingCommunity catalogue or title link.", 400); }
  if (url.protocol !== "https:" || !isStreamingCommunityHost(url.hostname) || url.username || url.password || value.length > 2048
    || /[\u0000-\u001f\u007f]/.test(value) || !cataloguePath.test(url.pathname)) throw new ProviderError("Use a StreamingCommunity catalogue or title link.", 400);
  const page = cursor === undefined ? 1 : integer(Number(cursor) || 0);
  if (page === undefined || page > 9999) throw new ProviderError("This catalogue page is out of range.", 400);
  const query = new URLSearchParams();
  for (const [key, entry] of url.searchParams.entries()) {
    if (key === "page" || !allowedParameter.test(key) || key.length + entry.length > 300) continue;
    query.set(key, entry);
  }
  if (page > 1) query.set("page", String(page));
  url.search = query.size ? `?${query}` : "";
  return url;
}

function listPage(page: InertiaPage, origin: string, pageNumber: number, label?: string): ProviderPage {
  if (page.component !== "Titles/Browse" || !Array.isArray(page.props.titles)) throw changed();
  const cdn = cdnUrl(page.props, origin);
  const items = array(page.props.titles).map(row => listItem(row, cdn, origin)).filter((item): item is ProviderItem => !!item);
  const total = integer(page.props.totalCount);
  return {
    ...(label ? { title: label } : {}), items,
    ...(items.length === pageSize && (!total || items.length < total) ? { nextCursor: String(pageNumber + 1) } : {}),
  };
}

export async function streamingCommunityBrowse(request: BrowseRequest, origin = streamingCommunityOrigin, signal?: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  if (!validStreamingCommunityOrigin(origin)) throw needsOrigin();
  const query = clean(request.query, 200);
  if (request.query !== undefined && !query) throw new ProviderError("Search StreamingCommunity with some text.", 400);
  if (request.url === undefined && !query) {
    const archive = await streamingCommunityBody(catalogueTarget(`${origin}/${locale}/archive`), {}, signal, fetchPage);
    return listPage(parseInertiaPage(archive), origin, 1, "Catalogue");
  }
  if (request.url === undefined) {
    const search = new URL(`${origin}/${locale}/search`);
    search.searchParams.set("q", query);
    const page = catalogueTarget(search.href, request.cursor);
    return listPage(parseInertiaPage(await streamingCommunityBody(page, {}, signal, fetchPage)), origin, Number(page.searchParams.get("page") ?? 1));
  }
  const target = catalogueTarget(request.url, request.cursor);
  const page = parseInertiaPage(await streamingCommunityBody(target, {}, signal, fetchPage));
  if (page.component === "Titles/Title") {
    const season = /\/season-(\d{1,3})$/.exec(target.pathname);
    return season ? seasonPageItems(page, origin, Number(season[1])) : titlePageItems(page, origin);
  }
  const genre = clean(target.searchParams.get("g"), 200);
  const label = !listPath.test(target.pathname) ? undefined : genre ? `Genre: ${genre}` : "Catalogue";
  return listPage(page, origin, Number(target.searchParams.get("page") ?? 1), label);
}

export async function streamingCommunityPreview(id: number, origin = streamingCommunityOrigin, signal?: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<StreamingCommunityPreview> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(id) || id <= 0 || id > 99999999) throw new ProviderError("Choose a StreamingCommunity title.", 400);
  if (!validStreamingCommunityOrigin(origin)) throw needsOrigin();
  const body = await streamingCommunityBody(new URL(`${origin}/api/titles/preview/${id}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, signal, fetchPage);
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw changed(); }
  const kind = object(data) && data.type === "movie" ? "movie" : object(data) && data.type === "tv" ? "series" : undefined;
  if (!kind || !object(data) || integer(data.id) !== id) throw changed();
  const year = clean(data.release_date ?? data.last_air_date, 10).slice(0, 4);
  const runtime = typeof data.runtime === "number" && data.runtime > 0 && data.runtime < 1440 ? data.runtime : undefined;
  const seasonsCount = kind === "series" ? integer(data.seasons_count) : undefined;
  const thumbnail = posterUrl(data, `https://cdn.${new URL(origin).hostname}`);
  return {
    id, kind,
    genres: array(data.genres).map(row => clean(row.name, 80)).filter(Boolean).slice(0, 12),
    ...(year ? { year } : {}), ...(clean(data.quality, 20) ? { quality: clean(data.quality, 20) } : {}),
    ...(runtime ? { runtime } : {}), ...(seasonsCount ? { seasonsCount } : {}),
    ...(clean(data.plot, 2000) ? { plot: clean(data.plot, 2000) } : {}),
    ...(thumbnail ? { thumbnail } : {}),
  };
}

// Saved source lists keep their captured origin: like saved links, they are
// never retargeted to the configured one.
export async function streamingCommunityList(value: string, signal?: AbortSignal, fetchPage: typeof fetch = globalThis.fetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError("Choose a StreamingCommunity film, series or season to save.", 400); }
  const season = /^\/(?:[a-z]{2}\/)?titles\/(\d+)(?:-[\w-]*)?\/season-(\d{1,3})$/.exec(url.pathname);
  const title = /^\/(?:[a-z]{2}\/)?titles\/(\d+)(?:-[\w-]*)?$/.exec(url.pathname);
  if (url.protocol !== "https:" || !isStreamingCommunityHost(url.hostname) || url.username || url.password || value.length > 2048
    || (!season && !title)) throw new ProviderError("Choose a StreamingCommunity film, series or season to save.", 400);
  const page = parseInertiaPage(await streamingCommunityBody(catalogueTarget(url.href), {}, signal, fetchPage));
  if (season) return seasonPageItems(page, url.origin, Number(season[2]));
  const context = titleContext(page, url.origin);
  if (!context.seasons.length) return { title: context.name, items: [movieItem(context)] };
  const items: ProviderItem[] = [];
  for (const number of context.seasons) {
    signal?.throwIfAborted();
    const seasonPage = parseInertiaPage(await streamingCommunityBody(catalogueTarget(`${context.base}/season-${number}`), {}, signal, fetchPage));
    items.push(...seasonPageItems(seasonPage, url.origin, number).items);
    if (items.length > 500) throw new ProviderError("This series has more than 500 episodes. Save one season at a time instead.", 400);
  }
  if (!items.length) throw new ProviderError("This series has no playable episodes. Open it in StreamingCommunity to check availability.", 404);
  return { title: context.name, items };
}

// Embedded in the signed sidecar; the only directory this extraction can load.
export async function streamingCommunityPlugin() {
  const directory = await mkdtemp(join(tmpdir(), "couch-streamingcommunity-"));
  try {
    const target = join(directory, "bundled", "yt_dlp_plugins", "extractor");
    await mkdir(target, { recursive: true, mode: 0o700 });
    await writeFile(join(target, "streamingcommunity.py"), extractor, { mode: 0o600 });
    return { directory, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
