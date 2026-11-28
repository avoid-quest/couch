import { mediaCreator } from "../media-creator";
import {
  publicProviderMediaUrl,
  soundCloudListUrl,
  type BrowseRequest,
  type ProviderItem,
  type ProviderPage,
} from "../../shared/providers";
import { runYtDlp } from "../yt-dlp";
import { ProviderError, providerItemId, withProviderItem } from "./http";

const pageSize = 24;
const maxOffset = 2400;
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

function trackUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value))
    return;
  try {
    const url = new URL(value);
    if (
      !["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(url.hostname) ||
      url.searchParams.has("secret_token")
    )
      return;
    url.search = "";
    url.hash = "";
    return publicProviderMediaUrl(url.href);
  } catch {
    return;
  }
}

function item(value: unknown): ProviderItem | null {
  if (!object(value)) return null;
  const url = trackUrl(value.webpage_url ?? value.url),
    title = label(value.title);
  if (!url || !title) return null;
  const images = [
    value.thumbnail,
    ...(Array.isArray(value.thumbnails)
      ? value.thumbnails
          .filter(object)
          .map((image) => image.url)
          .toReversed()
      : []),
  ];
  const thumbnail = images.find(
    (image): image is string =>
      typeof image === "string" &&
      image.length <= 2048 &&
      /^https:\/\/[a-z0-9-]+\.sndcdn\.com\/[^\s\\]*$/.test(image),
  );
  return {
    id: providerItemId("soundcloud", url),
    provider: "soundcloud",
    kind: "media",
    url,
    title,
    creator: mediaCreator(value),
    subtitle: label(value.uploader),
    description: label(value.description, 2000),
    thumbnail,
    ...(typeof value.duration === "number" && Number.isFinite(value.duration) && value.duration >= 0
      ? { duration: value.duration }
      : {}),
  };
}

// A set or profile, as yt-dlp lists it flat (each track's page, title and length, no streams).
async function listInfo(run: typeof runYtDlp, url: string, items: string, signal?: AbortSignal) {
  const output = await run(
    [
      "--use-extractors",
      "soundcloud.*,end",
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-items",
      items,
      "--",
      url,
    ],
    { signal },
  );
  signal?.throwIfAborted();
  let info: unknown;
  try {
    info = JSON.parse(output);
  } catch {
    throw new ProviderError("SoundCloud returned invalid catalog information.");
  }
  if (!object(info) || info._type !== "playlist" || !Array.isArray(info.entries))
    throw new ProviderError("SoundCloud returned invalid catalog information.");
  const entries = info.entries as unknown[];
  return {
    entries,
    // A profile is listed as "Name (All)": its tracks and reposts, as its page shows them.
    title: label(info.title)?.replace(/ \(All\)$/, "") ?? "SoundCloud",
    subtitle: label(info.uploader),
    description: label(info.description, 2000),
    ...(typeof info.playlist_count === "number" && info.playlist_count >= 0
      ? { count: info.playlist_count }
      : {}),
  };
}

const listItems = (entries: unknown[], title: string, url: string, offset = 0) =>
  entries.flatMap((entry, index): ProviderItem[] => {
    const track = item(entry);
    return track ? [{ ...track, collection: { title, url, index: offset + index } }] : [];
  });

export function createSoundCloudBrowser(run: typeof runYtDlp = runYtDlp) {
  return async function browseSoundCloud(
    request: BrowseRequest,
    signal?: AbortSignal,
  ): Promise<ProviderPage> {
    signal?.throwIfAborted();
    if (
      request.query !== undefined &&
      (typeof request.query !== "string" ||
        request.query.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(request.query))
    )
      throw new ProviderError("Enter a SoundCloud search of at most 200 characters.", 400);
    const offset = Number(request.cursor ?? "0");
    if (
      (request.cursor !== undefined && !/^(?:0|[1-9]\d{0,3})$/.test(request.cursor)) ||
      offset > maxOffset ||
      offset % pageSize !== 0
    )
      throw new ProviderError("Invalid SoundCloud page. Start a new search.", 400);
    const query = request.query?.trim() ?? "";
    const link = request.url ?? (/^https?:\/\//i.test(query) ? query : undefined);
    const url = link === undefined ? undefined : trackUrl(link);
    const list = link === undefined || url ? undefined : soundCloudListUrl(link);
    if (link !== undefined && !url && !list)
      throw new ProviderError("Enter a public SoundCloud track, set or profile link.", 400);
    if (list) {
      const info = await listInfo(run, list, `${offset + 1}:${offset + pageSize + 1}`, signal);
      return withProviderItem("soundcloud", list, "collection", {
        title: info.title,
        subtitle: info.subtitle,
        description: info.description,
        ...(info.count === undefined ? {} : { count: info.count }),
        items: listItems(info.entries.slice(0, pageSize), info.title, list, offset),
        ...(info.entries.length > pageSize && offset < maxOffset
          ? { nextCursor: String(offset + pageSize) }
          : {}),
      });
    }
    if (offset && (url || !query))
      throw new ProviderError("Invalid SoundCloud page. Start a new search.", 400);
    if (!url && !query) return { title: "SoundCloud", items: [] };
    // scsearch returns track metadata without resolving each audio stream.
    const output = await run(
      [
        "--use-extractors",
        "soundcloud.*,end",
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-items",
        `${offset + 1}:${offset + pageSize + 1}`,
        ...(url ? ["--no-playlist"] : []),
        "--",
        url ?? `scsearch${offset + pageSize + 1}:${query}`,
      ],
      { signal },
    );
    signal?.throwIfAborted();
    let info: unknown;
    try {
      info = JSON.parse(output);
    } catch {
      throw new ProviderError("SoundCloud returned invalid catalog information.");
    }
    if (
      !object(info) ||
      (!url && !Array.isArray(info.entries)) ||
      (url && info.entries !== undefined)
    )
      throw new ProviderError("SoundCloud returned invalid catalog information.");
    const entries = Array.isArray(info.entries) ? info.entries : [info];
    const items = entries
      .slice(0, pageSize)
      .map(item)
      .filter((entry): entry is ProviderItem => entry !== null);
    if (url && (items.length !== 1 || items[0]!.url !== url))
      throw new ProviderError("SoundCloud returned invalid track information.");
    const page: ProviderPage = {
      title: url ? items[0]!.title : "SoundCloud",
      items,
      ...(entries.length > pageSize && offset < maxOffset
        ? { nextCursor: String(offset + pageSize) }
        : {}),
    };
    return url ? withProviderItem("soundcloud", url, "media", page) : page;
  };
}

/** A set's or profile's tracks to queue: the first 500 (Couch's queue limit) of a longer list. */
export function createSoundCloudListLoader(run: typeof runYtDlp = runYtDlp) {
  return async (url: string, signal?: AbortSignal): Promise<ProviderPage> => {
    const list = soundCloudListUrl(url);
    if (!list)
      throw new ProviderError("Choose a SoundCloud set or profile link to queue its tracks.", 400);
    const info = await listInfo(
      run,
      list,
      "1:500",
      AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]),
    );
    const items = listItems(info.entries, info.title, list);
    if (!items.length) throw new ProviderError("This SoundCloud list has no public tracks.");
    return {
      title: info.title,
      count: info.count ?? info.entries.length,
      items,
    };
  };
}

export const browseSoundCloud = createSoundCloudBrowser();
export const loadSoundCloudList = createSoundCloudListLoader();
