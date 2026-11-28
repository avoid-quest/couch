import {
  bandcampFanUrl,
  providerPageSize,
  type ProviderItem,
  type ProviderPage,
} from "../../shared/providers";
import { ExtractionError, runYtDlp } from "../yt-dlp";
import { mediaItem, target, thumbnail, type Target } from "./bandcamp";
import { label, object, ProviderError, providerItemId, withProviderItem } from "./http";

type Fan = NonNullable<ReturnType<typeof bandcampFanUrl>>;
/** A release on a fan's list, with how many tracks Bandcamp says it streams. */
type Release = { item: ProviderItem; tracks: number };
const maxTracks = 500;
// Play all pages through the list and reads its albums within one deadline, as long as one list request may take.
const loadTime = 30_000;
// Reading a list whole, each paging request asks for this many releases (Bandcamp's own page asks for 20).
const loadCount = 100;
// Albums are read a few per extraction, in parallel; when one of them fails, only its group is read again album by
// album, so that one is skipped and the rest still play.
const albumGroup = 8;
// yt-dlp runs three extractions at once for all of Core; a fan list takes two, so playback and searches always keep
// one and Bandcamp sees no burst.
const albumLanes = 2;
// Play all starts on the first page's first few albums, as many as one extraction reads in a few seconds.
const headAlbums = 4;
// Releases read past those that fill the list by Bandcamp's counts, so an album that fails to read is replaced.
const spareReleases = 4;
/** The rest of a fan's list, after its first albums, and whether it ends under 500 tracks while the fan has more. */
export type FanListRest = { items: ProviderItem[]; short: boolean };

/** The releases up to the first few albums: they play while the rest is read. */
function headOf(releases: Release[]) {
  let albums = 0;
  const end = releases.findIndex(
    (release) => release.item.kind === "collection" && ++albums > headAlbums,
  );
  return end === -1 ? releases : releases.slice(0, end);
}

/** How many releases fill the list by Bandcamp's track counts, with the spares; all of them when they don't. */
function wanted(listed: Release[]) {
  let tracks = 0;
  let index = 0;
  while (index < listed.length && tracks < maxTracks) tracks += listed[index++]!.tracks;
  return tracks < maxTracks ? Infinity : index + spareReleases;
}

/** Runs tasks so that at most `count` are underway at once, the rest in the order they came, `first` ones first. */
function lanes(count: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>, first = false): Promise<T> => {
    if (running < count) running++;
    else
      await new Promise<void>((resolve) => {
        if (first) waiting.unshift(resolve);
        else waiting.push(resolve);
      });
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
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

function fanItem(entry: unknown): Release | null {
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
  const streamed = entry.num_streamable_tracks;
  return {
    item: {
      id: providerItemId("bandcamp", source.url),
      provider: "bandcamp",
      kind: source.kind === "album" ? "collection" : "media",
      title,
      url: source.url,
      ...(band ? { subtitle: band, creator: { title: band, url: `https://${source.host}/` } } : {}),
      ...(image ? { thumbnail: image } : {}),
    },
    tracks:
      source.kind === "album" && typeof streamed === "number" && Number.isSafeInteger(streamed)
        ? Math.max(1, streamed)
        : 1,
  };
}

const releases = (entries: unknown[]) =>
  entries.map(fanItem).filter((release): release is Release => release !== null);

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
  const listed = releases(Object.values(cache));
  const more =
    typeof list.item_count === "number" &&
    list.item_count > Object.keys(cache).length &&
    typeof list.last_token === "string";
  return {
    title: `${name}'s ${fan.list}`,
    releases: listed,
    ...(more ? { nextCursor: `${fanId}/${list.last_token}` } : {}),
  };
}

/** The releases after a cursor, with the page's own paging request. */
async function nextPage(
  run: typeof runYtDlp,
  fan: Fan,
  cursor: string,
  count: number,
  signal?: AbortSignal,
) {
  const [, fanId, token] = cursorPattern.exec(cursor) ?? [];
  if (!fanId || !token) throw new ProviderError("Invalid Bandcamp page. Open the link again.", 400);
  let data: unknown;
  try {
    data = JSON.parse(
      await body(
        run,
        `https://bandcamp.com/api/fancollection/1/${fan.list}_items?fan_id=${fanId}&older_than_token=${token}&count=${count}`,
        signal,
      ),
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw unavailable();
  }
  if (!object(data) || !Array.isArray(data.items)) throw unavailable();
  return {
    releases: releases(data.items.slice(0, count)),
    ...(data.more_available === true && typeof data.last_token === "string"
      ? { nextCursor: `${fanId}/${data.last_token}` }
      : {}),
  };
}

/** Each album's tracks, in order, from one flat extraction of several albums (one page request each, no audio). */
function albumTracks(output: string, albums: ProviderItem[]) {
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
  return tracks;
}

export function createBandcampFans(run: typeof runYtDlp = runYtDlp) {
  const lane = lanes(albumLanes);
  async function browse(url: string, cursor?: string, signal?: AbortSignal): Promise<ProviderPage> {
    const fan = bandcampFanUrl(url);
    if (!fan) throw new ProviderError("Enter a Bandcamp fan's collection or wishlist link.", 400);
    const page =
      cursor === undefined
        ? await firstPage(run, fan, signal)
        : await nextPage(run, fan, cursor, providerPageSize, signal);
    const { releases: listed, ...rest } = page;
    const result = { ...rest, items: listed.map((release) => release.item) };
    return cursor === undefined
      ? withProviderItem("bandcamp", fan.url, "collection", result)
      : result;
  }

  async function extract(albums: ProviderItem[], signal: AbortSignal, first: boolean) {
    const output = await lane(
      () =>
        run(
          [
            "--use-extractors",
            "bandcamp:album,end",
            "--flat-playlist",
            "--dump-single-json",
            "--playlist-items",
            `1:${maxTracks}`,
            "--",
            ...albums.map((album) => album.url),
          ],
          { signal },
        ),
      first,
    );
    return albumTracks(output, albums);
  }

  /** A group of albums' tracks; when the group fails, each album on its own, skipping one that fails again. */
  async function group(
    albums: ProviderItem[],
    signal: AbortSignal,
    first: boolean,
  ): Promise<Map<string, ProviderItem[]>> {
    try {
      return await extract(albums, signal, first);
    } catch (error) {
      // Past the deadline, the albums read so far are the list.
      if (signal.aborted) return new Map();
      if (!(error instanceof ExtractionError)) throw error;
      if (albums.length === 1) return new Map();
    }
    const read = await Promise.all(albums.map((album) => group([album], signal, first)));
    return new Map(read.flatMap((tracks) => [...tracks]));
  }

  /** Each release's tracks: a track as it is, an album's as read, none for one that wasn't. */
  const expand = (chosen: Release[], tracks: Map<string, ProviderItem[]>) =>
    chosen.flatMap(({ item }) => (item.kind === "media" ? [item] : (tracks.get(item.url) ?? [])));
  const albumsOf = (chosen: Release[]) =>
    chosen.flatMap(({ item }) => (item.kind === "collection" ? [item] : []));

  /** Albums' tracks, read a group at a time in the two lanes; the `first` albums, the ones that play at once, go first. */
  async function read(albums: ProviderItem[], signal: AbortSignal, first = false) {
    const groups = Array.from({ length: Math.ceil(albums.length / albumGroup) }, (_, index) =>
      albums.slice(index * albumGroup, (index + 1) * albumGroup),
    );
    return new Map(
      (await Promise.all(groups.map((albums) => group(albums, signal, first)))).flatMap((read) => [
        ...read,
      ]),
    );
  }

  /**
   * Play all: the tracks of the fan's list, newest first, each album's in order, up to 500. The first page's first
   * albums come at once, so the list starts playing in seconds; `more` pages through the list and reads the albums
   * that fill it, and says whether the list is `short` (under 500 tracks while the fan has more). Whatever is read
   * when the deadline passes is what plays.
   */
  async function start(
    url: string,
    signal?: AbortSignal,
  ): Promise<ProviderPage & { more?: Promise<FanListRest> }> {
    const fan = bandcampFanUrl(url);
    if (!fan) throw new ProviderError("Enter a Bandcamp fan's collection or wishlist link.", 400);
    const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(loadTime)]);
    const first = await firstPage(run, fan, deadline);
    const head = headOf(first.releases);
    const headRead = read(albumsOf(head), deadline, true);
    const rest = (async () => {
      const listed = [...first.releases];
      let cursor = first.nextCursor;
      while (cursor && listed.length < wanted(listed)) {
        let page;
        try {
          page = await lane(() => nextPage(run, fan, cursor!, loadCount, deadline));
        } catch (error) {
          // A later page that fails or comes too late ends the list where it is.
          signal?.throwIfAborted();
          if (deadline.aborted || error instanceof ProviderError) break;
          throw error;
        }
        if (!page.releases.length) break;
        listed.push(...page.releases);
        cursor = page.nextCursor;
      }
      const chosen = listed.slice(head.length, wanted(listed));
      const tracks = await read(albumsOf(chosen), deadline);
      signal?.throwIfAborted();
      return { chosen, tracks, unread: !!cursor || head.length + chosen.length < listed.length };
    })();
    rest.catch(() => {}); // Awaited through `more`, unless reading the first albums fails first.
    const headTracks = await headRead;
    signal?.throwIfAborted();
    const items = expand(head, headTracks).slice(0, maxTracks);
    const more = rest.then(({ chosen, tracks, unread }) => {
      const later = expand(chosen, tracks).slice(0, maxTracks - items.length);
      const missed = [...albumsOf(head), ...albumsOf(chosen)].some(
        (album) => !headTracks.has(album.url) && !tracks.has(album.url),
      );
      return { items: later, short: items.length + later.length < maxTracks && (unread || missed) };
    });
    if (items.length) return { title: first.title, items, more };
    const { items: later } = await more;
    if (!later.length) throw new ProviderError("This Bandcamp fan page has no public tracks.");
    return { title: first.title, items: later };
  }

  /** The whole list at once, for Queue all and saved lists. */
  async function load(url: string, signal?: AbortSignal): Promise<ProviderPage> {
    const { more, ...page } = await start(url, signal);
    return more ? { ...page, items: [...page.items, ...(await more).items] } : page;
  }

  return { browse, start, load };
}

const fans = createBandcampFans();
export const browseBandcampFan = fans.browse;
export const startBandcampFan = fans.start;
export const loadBandcampFan = fans.load;
