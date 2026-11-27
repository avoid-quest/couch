import {
  spotifyLink,
  type BrowseRequest,
  type ProviderItem,
  type ProviderPage,
} from "../../shared/providers";
import { publicFetch } from "../public-network";
import { ProviderError, providerItemId, readProviderText, withProviderItem } from "./http";
import { browseYouTube } from "./youtube";

type Metadata = Record<string, unknown>;
const object = (value: unknown): value is Metadata =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const label = (value: unknown, limit = 200) =>
  typeof value === "string"
    ? value
        .replace(/[\s\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, limit) || undefined
    : undefined;
const changed = () =>
  new ProviderError("Spotify changed its player page. Couch can't read this link yet.");
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
  const images = [
    ...(object(entity.coverArt) && Array.isArray(entity.coverArt.sources)
      ? entity.coverArt.sources
      : []),
    ...(object(entity.visualIdentity) && Array.isArray(entity.visualIdentity.image)
      ? entity.visualIdentity.image
      : []),
  ]
    .filter(object)
    .toSorted((a, b) => Number(b.maxWidth ?? b.width ?? 0) - Number(a.maxWidth ?? a.width ?? 0));
  return images
    .map((image) => image.url)
    .find(
      (url): url is string =>
        typeof url === "string" &&
        /^https:\/\/(?:i\.scdn\.co|image-cdn-[a-z]+\.spotifycdn\.com)\/image\/[a-f0-9]{20,64}$/.test(
          url,
        ),
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

export function createSpotifyCatalog(
  request: typeof fetch = publicFetch,
  searchYouTube: typeof browseYouTube = browseYouTube,
) {
  async function browse(browse: BrowseRequest, signal?: AbortSignal): Promise<ProviderPage> {
    signal?.throwIfAborted();
    if (!browse.url) {
      if (browse.query?.trim() || browse.cursor)
        throw new ProviderError("Paste a Spotify track, album or playlist link.", 400);
      return { title: "Spotify", items: [] };
    }
    const link = spotifyLink(browse.url);
    if (!link || browse.cursor)
      throw new ProviderError("Paste a Spotify track, album or playlist link.", 400);
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
