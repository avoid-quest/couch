import {
  bandcampFanUrl,
  providerPageSize,
  type ProviderItem,
  type ProviderPage,
} from "../../shared/providers";
import { ExtractionError, runYtDlp } from "../yt-dlp";
import { mediaItem, target, thumbnail, type Target } from "./bandcamp";
import { ProviderError, providerItemId, withProviderItem } from "./http";

type Metadata = Record<string, unknown>;
type Fan = NonNullable<ReturnType<typeof bandcampFanUrl>>;
const object = (value: unknown): value is Metadata =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit = 200) =>
  typeof value === "string"
    ? value
        .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, limit) || undefined
    : undefined;
const unavailable = () =>
  new ProviderError("Bandcamp didn't show this fan's page. Try again shortly.");
const cursorPattern = /^(\d{1,20})\/([0-9a-z:]{1,100})$/;
const entities: Record<string, string> = {
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

// bandcamp.com challenges Node's HTTP client; the managed extractor's transport reads the fan page and its paging API
// as Bandcamp search does (vendor/bandcamp).
async function body(run: typeof runYtDlp, url: string, signal?: AbortSignal): Promise<string> {
  const output = await run(
    [
      "--use-extractors",
      "CouchBandcampFan,CouchBandcampFanItems,end",
      "--dump-single-json",
      "--flat-playlist",
      "--retries",
      "0",
      "--extractor-retries",
      "0",
      "--",
      url,
    ],
    { signal, timeoutMs: 15_000, plugin: "bandcamp" },
  ).catch((error) => {
    if (error instanceof ExtractionError) throw unavailable();
    throw error;
  });
  let result: unknown;
  try {
    result = JSON.parse(output);
  } catch {
    throw unavailable();
  }
  if (!object(result) || typeof result.couch_bandcamp_page !== "string") throw unavailable();
  return result.couch_bandcamp_page;
}

function fanItem(entry: unknown): ProviderItem | null {
  if (!object(entry)) return null;
  let source: Target;
  try {
    source = target(entry.item_url);
  } catch {
    return null;
  }
  const title = label(entry.item_title);
  if (!title || source.kind !== (entry.tralbum_type === "a" ? "album" : "track")) return null;
  const band = label(entry.band_name);
  const image =
    typeof entry.item_art_id === "number" && Number.isSafeInteger(entry.item_art_id)
      ? thumbnail({
          thumbnail: `https://f4.bcbits.com/img/a${String(entry.item_art_id).padStart(10, "0")}_5.jpg`,
        })
      : undefined;
  return {
    id: providerItemId("bandcamp", source.url),
    provider: "bandcamp",
    kind: source.kind === "album" ? "collection" : "media",
    title,
    url: source.url,
    ...(band ? { subtitle: band, creator: { title: band, url: `https://${source.host}/` } } : {}),
    ...(image ? { thumbnail: image } : {}),
  };
}

/** The fan's page: its name and the first items Bandcamp lists, from the page's `pagedata` literal. */
async function firstPage(run: typeof runYtDlp, fan: Fan, signal?: AbortSignal) {
  const html = await body(run, fan.url, signal);
  const literal = /<div id="pagedata" data-blob="([^"]*)"/.exec(html)?.[1];
  if (!literal) throw unavailable();
  let data: unknown;
  try {
    data = JSON.parse(literal.replace(/&(?:quot|#39|lt|gt|amp);/g, (entity) => entities[entity]!));
  } catch {
    throw unavailable();
  }
  if (!object(data) || !object(data.fan_data) || !object(data.item_cache)) throw unavailable();
  const fanId = data.fan_data.fan_id;
  const list = data[`${fan.list}_data`];
  const cache = data.item_cache[fan.list];
  if (typeof fanId !== "number" || !Number.isSafeInteger(fanId) || !object(list) || !object(cache))
    throw unavailable();
  const name = label(data.fan_data.name) ?? label(data.fan_data.username) ?? fan.fan;
  const items = Object.values(cache)
    .map(fanItem)
    .filter((item): item is ProviderItem => item !== null);
  const more =
    typeof list.item_count === "number" &&
    list.item_count > Object.keys(cache).length &&
    typeof list.last_token === "string";
  return {
    title: `${name}'s ${fan.list}`,
    items,
    ...(more ? { nextCursor: `${fanId}/${list.last_token}` } : {}),
  };
}

export function createBandcampFans(run: typeof runYtDlp = runYtDlp) {
  async function browse(url: string, cursor?: string, signal?: AbortSignal): Promise<ProviderPage> {
    const fan = bandcampFanUrl(url);
    if (!fan) throw new ProviderError("Enter a Bandcamp fan's collection or wishlist link.", 400);
    if (cursor === undefined)
      return withProviderItem("bandcamp", fan.url, "collection", await firstPage(run, fan, signal));
    const [, fanId, token] = cursorPattern.exec(cursor) ?? [];
    if (!fanId || !token)
      throw new ProviderError("Invalid Bandcamp page. Open the link again.", 400);
    let data: unknown;
    try {
      data = JSON.parse(
        await body(
          run,
          `https://bandcamp.com/api/fancollection/1/${fan.list}_items?fan_id=${fanId}&older_than_token=${token}&count=${providerPageSize}`,
          signal,
        ),
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw unavailable();
    }
    if (!object(data) || !Array.isArray(data.items)) throw unavailable();
    return {
      items: data.items
        .slice(0, providerPageSize)
        .map(fanItem)
        .filter((item): item is ProviderItem => item !== null),
      ...(data.more_available === true && typeof data.last_token === "string"
        ? { nextCursor: `${fanId}/${data.last_token}` }
        : {}),
    };
  }

  /**
   * Play all: the tracks of the items the fan's page shows first (its newest), each album's in order. Reading every
   * album of a long collection would take minutes, so the rest stay on the page to open one by one.
   */
  async function load(url: string, signal?: AbortSignal): Promise<ProviderPage> {
    const fan = bandcampFanUrl(url);
    if (!fan) throw new ProviderError("Enter a Bandcamp fan's collection or wishlist link.", 400);
    const page = await firstPage(run, fan, signal);
    const albums = page.items.filter((item) => item.kind === "collection");
    // One extraction lists every album flat: one page request each, no audio streams.
    const output = albums.length
      ? await run(
          [
            "--use-extractors",
            "bandcamp:album,end",
            "--flat-playlist",
            "--dump-single-json",
            "--playlist-items",
            "1:500",
            "--",
            ...albums.map((album) => album.url),
          ],
          { signal },
        )
      : "";
    const tracks = new Map<string, ProviderItem[]>();
    for (const line of output.split("\n")) {
      let info: unknown;
      try {
        info = JSON.parse(line);
      } catch {
        continue;
      }
      if (!object(info) || !Array.isArray(info.entries) || typeof info.webpage_url !== "string")
        continue;
      let album: Target;
      try {
        album = target(info.webpage_url);
      } catch {
        continue;
      }
      const listed = albums.find((item) => item.url === album.url);
      if (!listed) continue;
      tracks.set(
        album.url,
        info.entries.flatMap((entry, index): ProviderItem[] => {
          if (!object(entry)) return [];
          try {
            const track = target(entry.url);
            if (track.kind !== "track" || track.host !== album.host) return [];
            return [
              {
                ...mediaItem(entry, track),
                ...(listed.subtitle ? { subtitle: listed.subtitle } : {}),
                ...(listed.thumbnail ? { thumbnail: listed.thumbnail } : {}),
                collection: { title: listed.title, url: album.url, index },
              },
            ];
          } catch {
            return [];
          }
        }),
      );
    }
    const items = page.items
      .flatMap((item) => (item.kind === "media" ? [item] : (tracks.get(item.url) ?? [])))
      .slice(0, 500);
    if (!items.length) throw new ProviderError("This Bandcamp fan page has no public tracks.");
    return { title: page.title, items };
  }

  return { browse, load };
}

const fans = createBandcampFans();
export const browseBandcampFan = fans.browse;
export const loadBandcampFan = fans.load;
