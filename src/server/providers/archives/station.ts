import type { CollectionLink, MediaCollection } from "../../../shared/media";
import type { ProviderItem, ProviderPage } from "../../../shared/providers";
import {
  archiveLink,
  archiveStationNames,
  type ArchiveLink,
  type ArchiveStation,
} from "../../../shared/archives";
import { mixcloudLink } from "../../../shared/mixcloud";
import { fold, searchWords } from "../../../shared/search-text";
import {
  catalogueTransport,
  label as plainLabel,
  object,
  ProviderError,
  providerItemId,
  providerJsonResponse,
} from "../http";
import { text as htmlText } from "../movies123";

/** One station's archive: its own search, its lists (shows, residents, series, styles) and its episodes' recordings. */
export type Station = {
  search(query: string, signal: AbortSignal): Promise<ProviderItem[]>;
  /** A list page, newest first; a station without upstream paging returns the whole list (up to 500) at once. */
  list(link: ArchiveLink, cursor: string | undefined, signal: AbortSignal): Promise<ProviderPage>;
  /** The episode, placed in its show, and what plays it: a direct file, else a SoundCloud or Mixcloud page. */
  resolve(
    link: ArchiveLink,
    signal: AbortSignal,
  ): Promise<{ item: ProviderItem; recording?: string }>;
};

export const maxList = 500;
/** A station's slug, which WordPress percent-encodes when it isn't ASCII. */
export const slugPattern = /^[A-Za-z0-9][\w%.~-]{0,299}$/;
export const searchSize = 12;
export { object };
/** http.ts's label, of a station's text with its HTML entities and tags read. */
export const label = (value: unknown, maximum = 200) =>
  plainLabel(typeof value === "string" ? htmlText(value) : value, maximum);
/** Every word of the query starts a word of the text, accents and case aside: `dj ale` finds `DJ Alé`. */
export function matches(query: string, value: string) {
  const words = searchWords(value);
  return searchWords(query).every((word) => words.some((part) => part.startsWith(word)));
}

const stationResponse = (url: string, signal: AbortSignal, init: RequestInit = {}) =>
  providerJsonResponse(url, { credentials: "omit", ...init, signal }, catalogueTransport.fetch);
export const stationJson = async (url: string, signal: AbortSignal, init: RequestInit = {}) =>
  (await stationResponse(url, signal, init)).value;

/**
 * A WordPress collection's rows, newest first, up to 500: page after page, as far as the last page WordPress counts
 * (asking past it is an error, so a show of exactly 100 episodes ends on its full page).
 */
export async function wordpressRows(url: string, signal: AbortSignal, invalid: () => Error) {
  // WordPress's largest page.
  const batch = 100;
  const rows: unknown[] = [];
  for (let page = 1; rows.length < maxList; page++) {
    const { value, headers } = await stationResponse(
      `${url}&per_page=${batch}&page=${page}`,
      signal,
    );
    if (!Array.isArray(value)) throw invalid();
    rows.push(...value);
    const pages = Number(headers.get("X-WP-TotalPages"));
    if (value.length < batch || !(page < pages)) break;
  }
  return rows;
}

/** A station's own page for a path, or nothing when the path isn't one Couch knows. */
export function pageLink(station: ArchiveStation, url: string, shape: ArchiveLink["shape"]) {
  const link = archiveLink(url);
  return link?.station === station && link.shape === shape ? link.url : undefined;
}

/** An HTTPS address without credentials. */
export function httpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return;
  }
}

// The hosts each station serves its pictures from. A Device loads a picture straight from its address, so one
// elsewhere (a LAN address, say) never reaches it.
const pictureHosts: Partial<Record<ArchiveStation, RegExp>> = {
  lyl: /^static\.lyl\.live$/,
  nts: /^media\d?\.ntslive\.co\.uk$/,
  sygma: /^radio-cdn\.syg\.ma$/,
  hkcr: /^cdn\.hkcr\.live$/,
  ipr: /^cdn\.sanity\.io$/,
  blackout: /^radioblackout\.org$/,
};
export function picture(station: ArchiveStation, value: unknown) {
  const url = httpsUrl(value);
  return url && pictureHosts[station]?.test(new URL(url).hostname) ? url : undefined;
}

/** A recording an episode publishes: a station file is played as it is, a SoundCloud or Mixcloud copy by its page. */
export function recording(value: unknown): string | undefined {
  const url = httpsUrl(value);
  if (!url) return;
  const mixcloud = mixcloudLink(url);
  if (mixcloud) return mixcloud.kind === "mix" ? mixcloud.url : undefined;
  const page = new URL(url);
  if (/(?:^|\.)soundcloud\.com$/.test(page.hostname)) page.search = "";
  return page.href;
}

/** An episode's day as Couch says it, "19 Nov 2026" (time-format.ts's formatDay), wherever its subtitle shows. */
const date = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? new Date(`${value.slice(0, 10)}T00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : undefined;

/** "01:00:00" or "01:00:00.000" as seconds. */
export function clock(value: unknown) {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2}):(\d{2})/.exec(value) : null;
  const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  return seconds > 0 ? seconds : undefined;
}

export function episode(
  station: ArchiveStation,
  fields: {
    url?: string;
    title?: string;
    date?: unknown;
    by?: string;
    show?: CollectionLink;
    thumbnail?: string;
    duration?: number;
    description?: string;
    collection?: MediaCollection;
    copies?: (string | undefined)[];
  },
): ProviderItem | null {
  if (!fields.url || !fields.title) return null;
  const by = fields.by && fold(fields.by) !== fold(fields.title) ? fields.by : undefined;
  return {
    id: providerItemId("archives", fields.url),
    provider: "archives",
    kind: "media",
    url: fields.url,
    title: fields.title,
    subtitle: [archiveStationNames[station], fields.show?.title ?? by, date(fields.date)]
      .filter(Boolean)
      .join(" · "),
    ...(fields.show ? { creator: fields.show } : {}),
    ...(fields.thumbnail ? { thumbnail: fields.thumbnail } : {}),
    ...(fields.duration ? { duration: fields.duration } : {}),
    ...(fields.description ? { description: fields.description } : {}),
    ...(fields.collection ? { collection: fields.collection } : {}),
    ...(fields.copies?.some(Boolean)
      ? { copies: fields.copies.filter((copy): copy is string => !!copy) }
      : {}),
  };
}

export function show(
  station: ArchiveStation,
  fields: { url?: string; title?: string; thumbnail?: string; by?: string },
): ProviderItem | null {
  if (!fields.url || !fields.title) return null;
  return {
    id: providerItemId("archives", fields.url),
    provider: "archives",
    kind: "collection",
    url: fields.url,
    title: fields.title,
    subtitle: [archiveStationNames[station], fields.by].filter(Boolean).join(" · "),
    ...(fields.thumbnail ? { thumbnail: fields.thumbnail } : {}),
  };
}

/** A whole list as one page: newest first, each episode once, each placed in the list by its position. */
export function wholeList(
  link: ArchiveLink,
  cursor: string | undefined,
  page: Omit<ProviderPage, "items"> & { title: string },
  episodes: ProviderItem[],
): ProviderPage {
  if (cursor) throw new ProviderError("Invalid archive page. Open the list again.", 400);
  const seen = new Set<string>();
  const items = episodes
    .filter((item) => !seen.has(item.url) && !!seen.add(item.url))
    .slice(0, maxList)
    .map((item, index) => ({
      ...item,
      collection: { title: page.title, url: link.url, index },
    }));
  return { ...page, items };
}

/** A value kept for a while, fetched once by concurrent readers; a failure isn't kept. */
export function remembered<T>(lifetime: number, load: (signal: AbortSignal) => Promise<T>) {
  let kept: { value: Promise<T>; expires: number } | undefined;
  return (signal: AbortSignal) => {
    if (!kept || kept.expires < Date.now()) {
      // The load outlives one caller's cancellation, which only stops that caller waiting.
      const value = load(AbortSignal.timeout(15_000));
      kept = { value, expires: Date.now() + lifetime };
      value.catch(() => {
        if (kept?.value === value) kept = undefined;
      });
    }
    const current = kept.value;
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      current.then(resolve, reject);
    });
  };
}
