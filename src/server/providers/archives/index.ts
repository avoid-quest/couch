import { archiveLink, archiveStationNames, type ArchiveStation } from "../../../shared/archives";
import type { BrowseRequest, ProviderItem, ProviderPage } from "../../../shared/providers";
import type { WebMediaMetadata } from "../../web-media";
import { ProviderError, withProviderItem } from "../http";
import { searchAlhara } from "./alhara";
import { blackout } from "./blackout";
import { cashmere } from "./cashmere";
import { hkcr } from "./hkcr";
import { ipr } from "./ipr";
import { lyl } from "./lyl";
import { nts } from "./nts";
import { resonance } from "./resonance";
import { maxList, type Station } from "./station";
import { sygma } from "./sygma";

const stations: Record<ArchiveStation, Station> = {
  lyl,
  nts,
  cashmere,
  sygma,
  hkcr,
  ipr,
  blackout,
  resonance,
};
// Every station answers a search on its own: one that is slow or failing is named, and the others still show.
const searchTimeout = 3_000;
const searchers: {
  name: string;
  search: (query: string, signal: AbortSignal) => Promise<ProviderItem[]>;
}[] = [
  ...(Object.keys(stations) as ArchiveStation[]).map((id) => ({
    name: archiveStationNames[id],
    search: (query: string, signal: AbortSignal) => stations[id].search(query, signal),
  })),
  { name: "Radio Alhara", search: searchAlhara },
];

function stationLink(url: string) {
  const link = archiveLink(url);
  if (!link) throw new ProviderError("Enter a radio station's episode, show or series link.", 400);
  return link;
}

async function searchArchives(query: string, signal?: AbortSignal) {
  const answers = await Promise.allSettled(
    searchers.map(({ search }) =>
      search(
        query,
        AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(searchTimeout)]),
      ),
    ),
  );
  signal?.throwIfAborted();
  const failed = searchers
    .filter((_, index) => answers[index]!.status === "rejected")
    .map(({ name }) => name);
  if (failed.length === searchers.length)
    throw new ProviderError("No radio archive answered. Try again shortly.");
  const lists = answers.map((answer) => (answer.status === "fulfilled" ? answer.value : []));
  // Each station ranks its own results; their best ones come first, in turn.
  const items: ProviderItem[] = [];
  for (let rank = 0; lists.some((list) => rank < list.length); rank++)
    for (const list of lists) if (list[rank]) items.push(list[rank]!);
  return {
    title: "Radio archives",
    items: [...new Map(items.map((item) => [item.id, item])).values()],
    ...(failed.length
      ? {
          warning: `${new Intl.ListFormat("en", { type: "conjunction" }).format(failed)} didn't answer.`,
        }
      : {}),
  };
}

export async function browseArchives(
  request: BrowseRequest,
  signal = AbortSignal.timeout(30_000),
): Promise<ProviderPage> {
  if (!request.url) {
    const query = request.query?.trim() ?? "";
    if (request.cursor) throw new ProviderError("Invalid archive page. Start a new search.", 400);
    return query ? searchArchives(query, signal) : { title: "Radio archives", items: [] };
  }
  const link = stationLink(request.url);
  if (link.shape === "playlist")
    return withProviderItem(
      "archives",
      link.url,
      "collection",
      await stations[link.station].list(link, request.cursor, signal),
    );
  if (request.cursor) throw new ProviderError("Invalid archive page. Open the episode again.", 400);
  const { item } = await stations[link.station].resolve(link, signal);
  return withProviderItem("archives", link.url, "media", {
    title: item.title,
    subtitle: item.subtitle,
    thumbnail: item.thumbnail,
    description: item.description,
    items: [item],
    ...(item.creator ? { parent: item.creator } : {}),
  });
}

/** A show, resident, series or style, whole, for Play all and Autoplay: its newest 500 episodes. */
export async function loadArchiveList(
  url: string,
  signal = AbortSignal.timeout(30_000),
): Promise<ProviderPage> {
  const link = stationLink(url);
  if (link.shape !== "playlist") throw new ProviderError("Choose a show to play all of it.", 400);
  const station = stations[link.station];
  const first = await station.list(link, undefined, signal);
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor && items.length < maxList;) {
    const page = await station.list(link, cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  const media = items.filter((item) => item.kind === "media").slice(0, maxList);
  if (!media.length) throw new ProviderError("This show has no past episodes.", 404);
  return { ...first, items: media, nextCursor: undefined };
}

/** An episode as its station describes it, placed in its show (the show is where Autoplay continues). */
export async function archiveEpisode(url: string, signal: AbortSignal): Promise<ProviderItem> {
  const link = stationLink(url);
  if (link.shape !== "atom") throw new ProviderError("Choose an episode.", 400);
  const { item } = await stations[link.station].resolve(link, signal);
  return item.creator ? { ...item, collection: { ...item.creator } } : item;
}

/**
 * What plays an episode page: the station's own file, else its SoundCloud or Mixcloud copy, which yt-dlp then
 * opens. The queue keeps the station's page.
 */
export async function resolveArchiveLink(
  value: string,
  signal?: AbortSignal,
): Promise<{
  url: string;
  headers: Record<string, string>;
  metadata: WebMediaMetadata;
  subtitles: [];
}> {
  const link = stationLink(value);
  if (link.shape !== "atom") throw new ProviderError("Choose an episode before playing.", 400);
  const cancellation = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25_000)]);
  const { item, recording } = await stations[link.station].resolve(link, cancellation);
  if (!recording)
    throw new ProviderError(
      `${archiveStationNames[link.station]} has no recording of this episode.`,
      404,
    );
  return {
    url: recording,
    headers: {},
    subtitles: [],
    metadata: {
      title: item.title,
      ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
      ...(item.creator ? { creator: item.creator } : {}),
    },
  };
}
