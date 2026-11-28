import {
  spotifyLink,
  type BrowseRequest,
  type ProviderItem,
  type ProviderPage,
} from "../../shared/providers";
import { publicFetch } from "../public-network";
import {
  label,
  object,
  ProviderError,
  providerItemId,
  providerJson,
  readProviderText,
  withProviderItem,
} from "./http";
import { createSpotifyToken } from "./spotify-token";
import { browseYouTube } from "./youtube";

type Metadata = Record<string, unknown>;
const changed = () =>
  new ProviderError("Spotify changed its player page. Couch can't read this link yet.");
const unavailable = () => new ProviderError("Spotify search is unavailable.");
// Spotify plays only in its own DRM player; each track plays from its closest YouTube upload.
const from = "plays from YouTube";
// A match is the same recording when its length is within this of Spotify's (live and radio edits differ by more).
const matchSeconds = 10;

// The public embed page carries its track list as a literal JSON value; no account or script is involved.
async function embed(
  kind: string,
  id: string,
  signal: AbortSignal | undefined,
  request: typeof fetch,
): Promise<Metadata> {
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  const response = await request(`https://open.spotify.com/embed/${kind}/${id}`, {
    signal: cancellation,
    credentials: "omit",
    redirect: "error",
    headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(
      response.status === 404
        ? "Spotify has no public page for this link."
        : "Spotify didn't answer. Try again shortly.",
      response.status === 404 ? 404 : 502,
    );
  }
  const html = await readProviderText(response, 2 * 1024 * 1024, cancellation, changed());
  const literal = /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/.exec(
    html,
  )?.[1];
  if (!literal) throw changed();
  let data: unknown;
  try {
    data = JSON.parse(literal);
  } catch {
    throw changed();
  }
  const entity = ["props", "pageProps", "state", "data", "entity"].reduce<unknown>(
    (value, key) => (object(value) ? value[key] : undefined),
    data,
  );
  if (!object(entity) || entity.type !== kind || entity.id !== id) throw changed();
  return entity;
}

function artwork(entity: Metadata): string | undefined {
  return largestImage([
    ...(object(entity.coverArt) && Array.isArray(entity.coverArt.sources)
      ? entity.coverArt.sources
      : []),
    ...(object(entity.visualIdentity) && Array.isArray(entity.visualIdentity.image)
      ? entity.visualIdentity.image
      : []),
  ]);
}

/** The widest of a list of Spotify images on Spotify's own image hosts. */
function largestImage(sources: unknown[]): string | undefined {
  return sources
    .filter(object)
    .toSorted((a, b) => Number(b.maxWidth ?? b.width ?? 0) - Number(a.maxWidth ?? a.width ?? 0))
    .map((image) => image.url)
    .find(
      (url): url is string =>
        typeof url === "string" &&
        (/^https:\/\/(?:i\.scdn\.co|image-cdn-[a-z]+\.spotifycdn\.com)\/image\/[a-f0-9]{20,64}$/.test(
          url,
        ) ||
          // A playlist's cover can be a mosaic of four album covers.
          /^https:\/\/mosaic\.scdn\.co\/\d{2,4}\/[a-f0-9]{40,256}$/.test(url)),
    );
}

// A list's tracks name their artists in `subtitle`; a track's own page lists them in `artists`.
const artistsOf = (value: Metadata) =>
  label(value.subtitle) ??
  label(
    (Array.isArray(value.artists) ? value.artists : [])
      .filter(object)
      .map((artist) => label(artist.name))
      .filter(Boolean)
      .join(", "),
  );

function track(
  value: unknown,
  collection?: { title: string; url: string; index: number },
  thumbnail?: string,
): ProviderItem | null {
  if (!object(value)) return null;
  const id =
    typeof value.uri === "string"
      ? /^spotify:track:([A-Za-z0-9]{22})$/.exec(value.uri)?.[1]
      : undefined;
  const title = label(value.title);
  const artists = artistsOf(value);
  if (!id || !title || value.isPlayable === false) return null;
  const url = `https://open.spotify.com/track/${id}`;
  return {
    id: providerItemId("spotify", url),
    provider: "spotify",
    kind: "media",
    title,
    url,
    subtitle: artists ? `${artists}, ${from}` : from,
    ...(thumbnail ? { thumbnail } : {}),
    ...(collection ? { collection } : {}),
    ...(typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration > 0
      ? { duration: value.duration / 1000 }
      : {}),
  };
}

// The web player's own search: its persisted GraphQL query `searchDesktop` (the hash is in its search route's bundle),
// asked with its first-page sizes (10 of each kind, 5 top results) and without pre-releases, which can't play yet.
const searchHash = "eef7cc54888d91bdd6802623477873caa3948ae173a0c34fd86827b267e94c03";
const searchVariables = {
  offset: 0,
  limit: 10,
  numberOfTopResults: 5,
  includeAudiobooks: false,
  includeArtistHasConcertsField: false,
  includePreReleases: false,
  includeAlbumPreReleases: false,
  includeAuthors: false,
  includeEpisodeContentRatingsV2: false,
};
const list = (value: unknown, key = "items"): unknown[] =>
  object(value) && Array.isArray(value[key]) ? value[key] : [];
const names = (value: unknown) =>
  label(
    list(value)
      .map((artist) => (object(artist) && object(artist.profile) ? label(artist.profile.name) : ""))
      .filter(Boolean)
      .join(", "),
  );

/** A search result (`{ item: { data } }` in top results, `{ data }` elsewhere) as a track, or an album, artist or playlist to play whole. */
function searchHit(value: unknown): ProviderItem | null {
  const wrapper = object(value) && object(value.item) ? value.item : value;
  const data = object(wrapper) ? wrapper.data : undefined;
  if (!object(data) || typeof data.uri !== "string") return null;
  const match = /^spotify:(track|album|artist|playlist):([A-Za-z0-9]{22})$/.exec(data.uri);
  if (!match) return null;
  const kind = match[1]!;
  const playable = !object(data.playability) || data.playability.playable !== false;
  if (kind === "track")
    return track(
      {
        uri: data.uri,
        title: data.name,
        subtitle: names(data.artists),
        duration: object(data.duration) ? data.duration.totalMilliseconds : undefined,
        isPlayable: playable,
      },
      undefined,
      largestImage(object(data.albumOfTrack) ? list(data.albumOfTrack.coverArt, "sources") : []),
    );
  const title = label(kind === "artist" && object(data.profile) ? data.profile.name : data.name);
  if (!title || !playable) return null;
  const subtitle =
    kind === "artist"
      ? "Artist"
      : kind === "album"
        ? names(data.artists)
        : object(data.ownerV2)
          ? label(object(data.ownerV2.data) ? data.ownerV2.data.name : undefined)
          : undefined;
  const thumbnail = largestImage(
    kind === "artist"
      ? object(data.visuals)
        ? list(data.visuals.avatarImage, "sources")
        : []
      : kind === "album"
        ? list(data.coverArt, "sources")
        : list(list(data.images)[0], "sources"),
  );
  const url = `https://open.spotify.com/${kind}/${match[2]}`;
  return {
    id: providerItemId("spotify", url),
    provider: "spotify",
    kind: "collection",
    title,
    url,
    ...(subtitle ? { subtitle } : {}),
    ...(thumbnail ? { thumbnail } : {}),
  };
}

// A re-release is another ID with the same title, byline and length: it reads as the same row, so it shows once.
const sameRow = (a: ProviderItem, b: ProviderItem) =>
  a.url === b.url ||
  (a.kind === b.kind &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    Math.abs((a.duration ?? 0) - (b.duration ?? 0)) <= 5);

export function createSpotifyCatalog(
  request: typeof fetch = publicFetch,
  searchYouTube: typeof browseYouTube = browseYouTube,
) {
  const token = createSpotifyToken(request);

  /** What open.spotify.com's search shows a logged-out visitor, in its order: the top result, songs, artists, albums, playlists. */
  async function search(query: string, signal?: AbortSignal): Promise<ProviderPage> {
    let value: unknown;
    try {
      value = await providerJson(
        "https://api-partner.spotify.com/pathfinder/v2/query",
        {
          method: "POST",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
            Authorization: `Bearer ${await token.token()}`,
          },
          body: JSON.stringify({
            variables: { searchTerm: query, ...searchVariables },
            operationName: "searchDesktop",
            extensions: { persistedQuery: { version: 1, sha256Hash: searchHash } },
          }),
          ...(signal ? { signal } : {}),
        },
        request,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      token.drop();
      throw unavailable();
    }
    const results =
      object(value) && object(value.data) && object(value.data.searchV2)
        ? value.data.searchV2
        : undefined;
    if (!results) throw unavailable();
    const items = [
      ...list(results.topResultsV2, "itemsV2").slice(0, 1),
      ...list(results.tracksV2),
      ...list(results.artists),
      ...list(results.albumsV2),
      ...list(results.playlists),
    ]
      .map(searchHit)
      .filter((item): item is ProviderItem => item !== null)
      .filter((item, index, all) => all.findIndex((other) => sameRow(other, item)) === index);
    return { title: "Spotify", items };
  }

  async function browse(browse: BrowseRequest, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    if (!browse.url) {
      if (browse.cursor)
        throw new ProviderError("Paste a Spotify track, album, playlist or artist link.", 400);
      const query = browse.query?.trim();
      return query ? search(query, signal) : { title: "Spotify", items: [] };
    }
    const link = spotifyLink(browse.url);
    if (!link || browse.cursor)
      throw new ProviderError("Paste a Spotify track, album, playlist or artist link.", 400);
    const entity = await embed(link.kind, link.id, signal, request);
    const thumbnail = artwork(entity);
    if (link.kind === "track") {
      const item = track(entity, undefined, thumbnail);
      if (!item) throw changed();
      return { title: item.title, item, items: [item] };
    }
    const title = label(entity.title) ?? label(entity.name) ?? "Spotify";
    if (!Array.isArray(entity.trackList)) throw changed();
    const items = entity.trackList
      .slice(0, 500)
      .map((value, index) => track(value, { title, url: link.url, index }, thumbnail))
      .filter((item): item is ProviderItem => item !== null);
    if (!items.length) throw new ProviderError("This Spotify list has no playable tracks.", 404);
    return withProviderItem("spotify", link.url, "collection", {
      title,
      ...(label(entity.subtitle) ? { subtitle: label(entity.subtitle) } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      items,
    });
  }

  /** The YouTube upload a Spotify track plays from: the first search hit within ±10 s of its length. */
  async function match(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; item: ProviderItem }> {
    const link = spotifyLink(url);
    if (link?.kind !== "track") throw new ProviderError("Choose a Spotify track.", 400);
    const entity = await embed(link.kind, link.id, signal, request);
    const item = track(entity, undefined, artwork(entity));
    if (!item?.duration) throw changed();
    const query = `${artistsOf(entity) ?? ""} ${item.title}`.trim().slice(0, 200);
    const hit = (await searchYouTube({ query }, signal)).items.find(
      (hit) =>
        hit.kind === "media" &&
        !hit.live &&
        hit.duration !== undefined &&
        Math.abs(hit.duration - item.duration!) <= matchSeconds,
    );
    if (!hit) throw new ProviderError("Couch found no YouTube upload of this Spotify track.", 404);
    return { url: hit.url, item };
  }

  return { browse, match };
}

const catalog = createSpotifyCatalog();
export const browseSpotify = catalog.browse;
export const loadSpotifyList = catalog.browse;
export const matchSpotifyTrack = catalog.match;
