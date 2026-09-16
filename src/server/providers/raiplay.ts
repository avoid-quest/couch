import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import { ProviderError, providerItemId, providerJson } from "./http";

const origin = "https://www.raiplay.it";
const channelsUrl = "https://www.rai.it/dl/RaiPlay/2016/PublishingBlock-9a2ff311-fcf0-4539-8f8f-c4fee2a71d58.html?json";
const searchUrl = `${origin}/atomatic/raiplay-search-service/api/v1/msearch`;
const pageSize = 24;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown, limit = 300) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";

function catalogUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value, origin); } catch { throw new ProviderError("Use a RaiPlay catalog or video URL.", 400); }
  if (!["https:", "http:"].includes(url.protocol) || !["raiplay.it", "www.raiplay.it"].includes(url.hostname)
    || url.port || url.username || url.password || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProviderError("Use a RaiPlay catalog or video URL.", 400);
  }
  if (url.search && url.search !== "?json") throw new ProviderError("RaiPlay catalog URLs cannot contain query parameters.", 400);
  url.search = "";
  url.protocol = "https:";
  url.hostname = "www.raiplay.it";
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  const path = url.pathname;
  if (!/^\/(?:index\.(?:json|html))?$/.test(path) && !/^\/(?:dirette|guidatv)$/.test(path)
    && !/^\/dirette\/[a-z0-9]+(?:\.json)?$/i.test(path)
    && !/^\/video\/\d{4}\/\d{2}\/[a-z0-9_%.-]+\.(?:html|json)$/i.test(path)
    && !/^\/(?:programmi|collezioni)\/[a-z0-9_%.-]+(?:\/ContentSet-[a-f0-9-]+\.json)?$/i.test(path)
    && !/^\/(?:tipologia|genere|home|performing-arts)\/[a-z0-9_%.-]+(?:\/index\.json)?$/i.test(path)) {
    throw new ProviderError("This RaiPlay page does not expose a supported catalog.", 400);
  }
  return url;
}

function thumbnail(value: unknown): string | undefined {
  const path = text(value, 2048).replace("[RESOLUTION]", "512x-");
  if (!path) return;
  try {
    const url = new URL(path, origin);
    if (!["http:", "https:"].includes(url.protocol) || !["www.raiplay.it", "raiplay.it", "www.rai.it", "www.rai.tv"].includes(url.hostname)
      || url.port || url.username || url.password) return;
    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return; }
}

function duration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 604800) return value;
  if (typeof value !== "string" || !/^\d{1,3}:\d{2}:\d{2}$/.test(value)) return;
  const [hours, minutes, seconds] = value.split(":").map(Number);
  if (minutes! < 60 && seconds! < 60) return hours! * 3600 + minutes! * 60 + seconds!;
}

function collection(title: string, url: string, image?: string): ProviderItem {
  return { id: providerItemId("raiplay", url), provider: "raiplay", kind: "collection", title: title.slice(0, 200), url, ...(image ? { thumbnail: image } : {}) };
}

function card(raw: Record<string, unknown>): ProviderItem | undefined {
  const path = text(raw.weblink || raw.webLink || raw.url || raw.path_id || raw.pathID || raw.PathID, 2048);
  if (!path) return;
  let url: URL;
  try { url = catalogUrl(path); } catch { return; }
  url.hash = "";
  const live = url.pathname.startsWith("/dirette/");
  const title = text((live && raw.channel) || raw.name || raw.titolo, 200);
  if (!title) return;
  const media = live || url.pathname.startsWith("/video/");
  if (live) url.pathname = url.pathname.replace(/\.json$/, "");
  else if (media) url.pathname = url.pathname.replace(/\.json$/, ".html");
  else if (/^\/(?:programmi|collezioni)\/[^/]+\.json$/.test(url.pathname)) url.pathname = url.pathname.replace(/\.json$/, "");
  const images = object(raw.images);
  const image = thumbnail(images.landscape || images.landscape43 || images.portrait || raw.immagine || raw.image || raw.still_frame || raw.stillFrame || raw["transparent-icon"]);
  const description = text(raw.description || raw.sommario, 2000);
  const subtitle = text(raw.subtitle || raw.programma || raw.timePublished);
  const seconds = duration(raw.duration || raw.durata);
  return {
    id: providerItemId("raiplay", url.href), provider: "raiplay", kind: media ? "media" : "collection", title, url: url.href,
    ...(image ? { thumbnail: image } : {}), ...(description ? { description } : {}), ...(subtitle ? { subtitle } : {}),
    ...(seconds !== undefined ? { duration: seconds } : {}), ...(live ? { live: true } : {}),
  };
}

function cards(rows: Record<string, unknown>[]): ProviderItem[] {
  return [...new Map(rows.map(card).filter((item): item is ProviderItem => !!item).map(item => [item.url, item])).values()];
}

function page(items: ProviderItem[], offset: number, title: string): ProviderPage {
  return { title, items: items.slice(offset, offset + pageSize), ...(offset + pageSize < Math.min(items.length, 10000) ? { nextCursor: String(offset + pageSize) } : {}) };
}

function replayDates(): string[] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const get = (type: string) => Number(parts.find(part => part.type === type)!.value);
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(get("year"), get("month") - 1, get("day") - index)).toISOString().slice(0, 10));
}

// Public schemas used by RaiPlay's own web app and the Kodi RaiPlay catalog.
// https://www.raiplay.it/assets/js/webcomponents/rai-search.js
// https://github.com/maxbambi/plugin.video.raitv/blob/master/resources/lib/raiplay.py
export async function browseRaiPlay(request: BrowseRequest, signal?: AbortSignal, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<ProviderPage> {
  signal?.throwIfAborted();
  if (request.cursor !== undefined && !/^\d{1,4}$/.test(request.cursor)) throw new ProviderError("Invalid RaiPlay page cursor.", 400);
  const offset = Number(request.cursor || 0);
  const query = request.query?.trim().replace(/\s+/g, " ");
  if (query && (query.length < 2 || query.length > 200)) throw new ProviderError("Search RaiPlay with 2 to 200 characters.", 400);
  const json = (url: string, body?: unknown) => providerJson(url, {
    signal, credentials: "omit", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  }, fetch);
  if (query) {
    const result = object(await json(searchUrl, {
      templateIn: "6470a982e4e0301afe1f81f1", templateOut: "6516ac5d40da6c377b151642",
      params: { param: query, from: offset, sort: "relevance", size: 12, additionalSize: 12, onlyVideoQuery: false, onlyProgramsQuery: false },
    }));
    const groups = object(result.agg);
    if (!Array.isArray(object(groups.titoli).cards) || !Array.isArray(object(groups.video).cards)) throw new ProviderError("RaiPlay search returned an unsupported response.");
    const programs = object(groups.titoli), videos = object(groups.video);
    const rows = [...array(programs.cards).slice(0, 12), ...array(videos.cards).slice(0, 12)];
    const more = rows.length > 0 && offset + 12 < Math.min(10000, Math.max(Number(programs.totale) || 0, Number(videos.totale) || 0));
    return { title: `RaiPlay: ${query}`, items: cards(rows), ...(more ? { nextCursor: String(offset + 12) } : {}) };
  }

  const url = catalogUrl(request.url || origin);
  const selectors = new URLSearchParams(url.hash.slice(1));
  if ([...selectors.keys()].some(key => !["block", "date", "channel"].includes(key)) || [...selectors.values()].some(value => value.length > 100)) throw new ProviderError("Invalid RaiPlay collection.", 400);
  if (url.pathname === "/guidatv") {
    const date = selectors.get("date");
    if (!date) return page(replayDates().map(day => collection(day.split("-").reverse().join("/"), `${origin}/guidatv#date=${day}`)), offset, "RaiPlay Replay");
    if (!replayDates().includes(date)) throw new ProviderError("RaiPlay replay covers the last seven days.", 400);
    const channel = selectors.get("channel");
    if (!channel) {
      const data = object(await json(channelsUrl));
      if (!Array.isArray(data.dirette)) throw new ProviderError("RaiPlay returned an unsupported channel list.");
      return page(cards(array(data.dirette)).filter(item => item.live && item.title !== "RaiPlay").map(item => collection(item.title, `${origin}/guidatv#date=${date}&channel=${encodeURIComponent(item.title.replace(/\s/g, ""))}`, item.thumbnail)), offset, `Replay ${date}`);
    }
    if (!/^Rai[a-z0-9]{1,30}$/i.test(channel)) throw new ProviderError("Invalid RaiPlay replay channel.", 400);
    const data = object(await json(`${origin}/palinsesto/app/old/${channel}/${date.split("-").reverse().join("-")}.json`));
    const days = Object.values(data).flatMap(array);
    const schedules = days.flatMap(day => array(day.palinsesto));
    if (!schedules.length) throw new ProviderError("RaiPlay has no replay schedule for this channel and date.", 404);
    return page(cards(schedules.flatMap(schedule => array(schedule.programmi)).filter(row => row.hasVideo === true)), offset, `${channel} - ${date}`);
  }
  if (url.pathname === "/dirette") {
    const data = object(await json(channelsUrl));
    if (!Array.isArray(data.dirette)) throw new ProviderError("RaiPlay returned an unsupported channel list.");
    return page(cards(array(data.dirette)).filter(item => item.live), offset, "Dirette RaiPlay");
  }

  const blockId = selectors.get("block");
  if (blockId && !/^PublishingBlock-[a-f0-9-]+$/i.test(blockId)) throw new ProviderError("Invalid RaiPlay collection.", 400);
  url.hash = "";
  const home = /^\/(?:index\.(?:json|html))?$/.test(url.pathname);
  const source = new URL(url);
  source.pathname = home ? "/index.json" : /\.json$/.test(source.pathname) ? source.pathname : /\.html$/.test(source.pathname) ? source.pathname.replace(/\.html$/, ".json") : /^\/tipologia\//.test(source.pathname) ? `${source.pathname}/index.json` : `${source.pathname}.json`;
  const data = object(await json(source.href));
  const title = text(data.name || data.title || object(data.program_info).name) || "RaiPlay";
  if (Array.isArray(data.items)) return page(cards(array(data.items)), offset, title);
  if (data.contents && typeof data.contents === "object" && !Array.isArray(data.contents)) {
    const letters = object(data.contents);
    return page(cards(Object.keys(letters).sort().flatMap(letter => array(letters[letter]))), offset, title);
  }
  if (Array.isArray(data.blocks)) {
    const info = object(data.program_info);
    const first = data.first_item_path ? cards([{ ...info, name: title, weblink: data.first_item_path, duration: data.first_item_duration }]) : [];
    const sets = array(data.blocks).flatMap(block => array(block.sets).map(set => ({ ...set, images: info.images, name: set.name === block.name ? set.name : `${text(block.name)} - ${text(set.name)}` })));
    return page([...first, ...cards(sets)], offset, title);
  }
  if (Array.isArray(data.contents)) {
    const contents = array(data.contents);
    if (blockId) {
      const block = contents.find(row => row.id === blockId);
      if (!block) throw new ProviderError("This RaiPlay collection is no longer available.", 404);
      return page(cards(array(block.contents)), offset, text(block.name) || title);
    }
    const items = contents.flatMap(row => {
      if (Array.isArray(row.contents)) {
        const children = cards(array(row.contents));
        if (!children.length || text(row.type).includes("Dirette") || !/^PublishingBlock-[a-f0-9-]+$/i.test(text(row.id))) return [];
        return [collection(text(row.type).includes("Hero") ? "In evidenza" : text(row.name) || title, `${url.href}#block=${text(row.id)}`, children[0]?.thumbnail)];
      }
      const item = card(row);
      return item ? [item] : [];
    });
    return page(home ? [collection("Dirette TV", `${origin}/dirette`), collection("Replay - ultimi 7 giorni", `${origin}/guidatv`), ...items] : items, offset, title);
  }
  if (data.video) return page(cards([{ ...data, path_id: url.href }]), offset, title);
  throw new ProviderError("RaiPlay returned an unsupported catalog response.");
}

export function createRaiPlayProgrammeLoader(browse: typeof browseRaiPlay = browseRaiPlay) {
  const allItems = async (url: string, signal?: AbortSignal) => {
    let title = "RaiPlay";
    const items: ProviderItem[] = [];
    for (let offset = 0;; offset += pageSize) {
      const result = await browse({ url, ...(offset ? { cursor: String(offset) } : {}) }, signal);
      if (result.title) title = result.title;
      items.push(...result.items);
      if (!result.nextCursor) return { title, items };
      if (items.length > 500) throw new ProviderError("This RaiPlay programme has more than 500 episodes. Save individual episodes instead.", 400);
    }
  };
  return async function loadRaiPlayProgramme(url: string, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    const source = catalogUrl(url);
    source.hash = "";
    // Only programmes and their season sets are lists of episodes; other catalog
    // pages mix live channels, guides, and genres that do not belong in a playlist.
    if (!/^\/(?:programmi|collezioni)\/[a-z0-9_%.-]+(?:\/ContentSet-[a-f0-9-]+\.json)?$/i.test(source.pathname)) {
      throw new ProviderError("Choose a RaiPlay programme or collection link to save it as a playlist.", 400);
    }
    const { title, items } = await allItems(source.href, signal);
    const episodes = items.filter(item => item.kind === "media");
    for (const item of items) {
      if (item.kind !== "collection" || !/\/ContentSet-[a-f0-9-]+\.json$/i.test(new URL(item.url).pathname)) continue;
      episodes.push(...(await allItems(item.url, signal)).items);
    }
    // The programme's own first item also appears inside its newest season set.
    const unique = [...new Map(episodes.map(item => [item.id, item])).values()];
    if (!unique.length) throw new ProviderError("This RaiPlay programme has no playable episodes. Open it in RaiPlay to check availability.", 404);
    return { title, items: unique };
  };
}

export const loadRaiPlayProgramme = createRaiPlayProgrammeLoader();
