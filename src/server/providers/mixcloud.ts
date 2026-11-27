import type { BrowseRequest, ProviderItem, ProviderPage } from "../../shared/providers";
import type { MediaCollection } from "../../shared/media";
import { mixcloudLink, type MixcloudLink } from "../../shared/mixcloud";
import { ProviderError, providerItemId, readProviderText, withProviderItem } from "./http";

// Mixcloud's public REST API: https://www.mixcloud.com/developers/. It lists and describes mixes but never
// gives audio; a mix plays through yt-dlp from its page.
const api = "https://api.mixcloud.com";
const pageSize = 24;
// The API's largest page, used to expand a whole list for queueing.
const listPage = 100;
const maxOffset = 2_400;
const maxList = 500;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, maximum = 200) =>
  typeof value === "string"
    ? value
        .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, maximum) || undefined
    : undefined;

// Mixcloud throttles with HTTP 403 and a Retry-After in seconds; until then Couch doesn't ask again.
let throttledUntil = 0;
const throttled = () =>
  new ProviderError(
    `Mixcloud asked Couch to wait. Try again in ${Math.max(1, Math.ceil((throttledUntil - Date.now()) / 1000))} s.`,
    503,
  );

async function mixcloudJson(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (Date.now() < throttledUntil) throw throttled();
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  const response = await fetch(`${api}${path}`, {
    signal: cancellation,
    redirect: "error",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const body = response.body
    ? await readProviderText(
        response,
        4 * 1024 * 1024,
        cancellation,
        new ProviderError("Mixcloud returned too much data."),
      )
    : "";
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    value = undefined;
  }
  const error = object(value) && object(value.error) ? value.error : undefined;
  if (
    response.status === 403 &&
    (error?.type === "RateLimitException" || response.headers.has("Retry-After"))
  ) {
    const seconds = Number(response.headers.get("Retry-After") ?? error?.retry_after);
    // An absent or absurd delay still waits a minute, and never more than an hour.
    throttledUntil =
      Date.now() + Math.min(3600, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
    throw throttled();
  }
  if (response.status === 404) throw new ProviderError("Mixcloud has no such page.", 404);
  if (!response.ok)
    throw new ProviderError(`Mixcloud returned HTTP ${response.status}. Try again shortly.`);
  if (!object(value)) throw new ProviderError("Mixcloud returned invalid data.");
  return value;
}

function picture(value: unknown) {
  if (!object(value)) return;
  const url = value["320wx320h"] ?? value.large ?? value.medium;
  return typeof url === "string" && /^https:\/\/thumbnailer\.mixcloud\.com\/[^\s\\]+$/.test(url)
    ? url
    : undefined;
}

function link(value: unknown, kind: MixcloudLink["kind"]) {
  const page = typeof value === "string" ? mixcloudLink(value) : undefined;
  return page?.kind === kind ? page.url : undefined;
}

function owner(value: unknown) {
  if (!object(value)) return;
  const url = link(value.url, "user"),
    title = text(value.name) ?? text(value.username);
  return url && title ? { title, url } : undefined;
}

function mixcloudMix(value: unknown, collection?: MediaCollection): ProviderItem | null {
  if (!object(value)) return null;
  const url = link(value.url, "mix"),
    title = text(value.name);
  if (!url || !title) return null;
  const creator = owner(value.user);
  const date = typeof value.created_time === "string" ? value.created_time.slice(0, 10) : "";
  const tags = Array.isArray(value.tags)
    ? value.tags.flatMap((tag) => (object(tag) && text(tag.name) ? [text(tag.name)!] : []))
    : [];
  return {
    id: providerItemId("mixcloud", url),
    provider: "mixcloud",
    kind: "media",
    url,
    title,
    ...(creator ? { creator } : {}),
    subtitle: [creator?.title, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ""]
      .filter(Boolean)
      .join(" · "),
    ...(tags.length ? { description: tags.slice(0, 8).join(", ") } : {}),
    thumbnail: picture(value.pictures),
    ...(typeof value.audio_length === "number" &&
    Number.isFinite(value.audio_length) &&
    value.audio_length > 0
      ? { duration: value.audio_length }
      : {}),
    ...(collection ? { collection } : {}),
  };
}

function playlist(value: unknown): ProviderItem | null {
  if (!object(value)) return null;
  const url = link(value.url, "playlist"),
    title = text(value.name);
  if (!url || !title) return null;
  const creator = owner(value.owner);
  return {
    id: providerItemId("mixcloud", url),
    provider: "mixcloud",
    kind: "collection",
    url,
    title,
    ...(creator ? { creator, subtitle: creator.title } : {}),
    thumbnail: picture(object(value.owner) ? value.owner.pictures : undefined),
  };
}

const rows = (value: Record<string, unknown>) => (Array.isArray(value.data) ? value.data : []);
const hasNext = (value: Record<string, unknown>) =>
  object(value.paging) && typeof value.paging.next === "string";

/**
 * One page of mixes from a list path (`/<user>/cloudcasts/`, `/<user>/playlists/<slug>/cloudcasts/`), each placed
 * in `collection` by its position in the whole list.
 */
export async function mixcloudMixes(
  path: string,
  offset: number,
  limit: number,
  collection: Omit<MediaCollection, "index">,
  signal?: AbortSignal,
) {
  const value = await mixcloudJson(`${path}?limit=${limit}&offset=${offset}`, signal);
  const items = rows(value).flatMap(
    (row, index) => mixcloudMix(row, { ...collection, index: offset + index }) ?? [],
  );
  return { items, more: hasNext(value) };
}

function offsetOf(cursor?: string) {
  const offset = Number(cursor ?? "0");
  if (
    (cursor !== undefined && !/^(?:0|[1-9]\d{0,4})$/.test(cursor)) ||
    offset > maxOffset ||
    offset % pageSize !== 0
  )
    throw new ProviderError("Invalid Mixcloud page. Start again.", 400);
  return offset;
}

export async function browseMixcloud(
  request: BrowseRequest,
  signal?: AbortSignal,
): Promise<ProviderPage> {
  const offset = offsetOf(request.cursor);
  const next = (more: boolean) =>
    more && offset + pageSize <= maxOffset ? { nextCursor: String(offset + pageSize) } : {};
  if (!request.url) {
    const query = request.query?.trim() ?? "";
    if (!query) return { title: "Mixcloud", items: [] };
    const value = await mixcloudJson(
      `/search/?${new URLSearchParams({ q: query, type: "cloudcast", limit: String(pageSize), offset: String(offset) })}`,
      signal,
    );
    return {
      title: "Mixcloud",
      items: rows(value).flatMap((row) => mixcloudMix(row) ?? []),
      ...next(hasNext(value)),
    };
  }
  const page = mixcloudLink(request.url);
  if (!page) throw new ProviderError("Enter a Mixcloud mix, user or playlist link.", 400);
  if (page.kind === "mix") {
    if (offset) throw new ProviderError("Invalid Mixcloud page. Start again.", 400);
    const mix = mixcloudMix(await mixcloudJson(page.path, signal));
    if (!mix || mix.url !== page.url)
      throw new ProviderError("Mixcloud returned invalid mix information.");
    return withProviderItem("mixcloud", page.url, "media", {
      title: mix.title,
      items: [mix],
      thumbnail: mix.thumbnail,
      subtitle: mix.subtitle,
      ...(mix.creator ? { parent: mix.creator } : {}),
    });
  }
  if (page.kind === "playlists") {
    const value = await mixcloudJson(`${page.path}?limit=${pageSize}&offset=${offset}`, signal);
    return withProviderItem("mixcloud", page.url, "collection", {
      title: "Playlists",
      items: rows(value).flatMap((row) => playlist(row) ?? []),
      ...next(hasNext(value)),
    });
  }
  // A user's page lists their uploads, and their playlists before the first upload.
  const [about, lists] = await Promise.all([
    mixcloudJson(page.path, signal),
    page.kind === "user" && !offset
      ? mixcloudJson(`${page.path}playlists/?limit=${pageSize}`, signal)
      : undefined,
  ]);
  const title = text(about.name) ?? text(about.username) ?? "Mixcloud";
  const mixes = await mixcloudMixes(
    `${page.path}cloudcasts/`,
    offset,
    pageSize,
    { title, url: page.url },
    signal,
  );
  const owned = page.kind === "playlist" ? owner(about.owner) : undefined;
  return withProviderItem("mixcloud", page.url, page.kind === "user" ? "channel" : "collection", {
    title,
    thumbnail: picture(
      page.kind === "user"
        ? about.pictures
        : object(about.owner)
          ? about.owner.pictures
          : undefined,
    ),
    description: text(about.biog, 2000),
    ...(owned ? { subtitle: owned.title, parent: owned } : {}),
    items: [...(lists ? rows(lists).flatMap((row) => playlist(row) ?? []) : []), ...mixes.items],
    ...next(mixes.more),
  });
}

/** A user's uploads or a playlist, whole, for Play all and Autoplay: its first 500 mixes. */
export async function loadMixcloudList(url: string, signal?: AbortSignal): Promise<ProviderPage> {
  const page = mixcloudLink(url);
  if (page?.kind !== "user" && page?.kind !== "playlist")
    throw new ProviderError("Enter a Mixcloud user or playlist link.", 400);
  const about = await mixcloudJson(page.path, signal);
  const title = text(about.name) ?? text(about.username) ?? "Mixcloud";
  const items: ProviderItem[] = [];
  for (let offset = 0; offset < maxList; offset += listPage) {
    const part = await mixcloudMixes(
      `${page.path}cloudcasts/`,
      offset,
      listPage,
      { title, url: page.url },
      signal,
    );
    items.push(...part.items);
    if (!part.more) break;
  }
  if (!items.length) throw new ProviderError("This Mixcloud list has no mixes.", 404);
  return { title, items: items.slice(0, maxList) };
}
