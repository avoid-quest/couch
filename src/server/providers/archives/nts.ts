import type { ProviderItem } from "../../../shared/providers";
import { ProviderError } from "../http";
import {
  episode,
  label,
  maxList,
  object,
  pageLink,
  picture,
  recording,
  searchSize,
  show,
  stationJson,
  type Station,
} from "./station";

// NTS's public v2 API, which its site uses. Lists come 12 at a time whatever the limit asked.
const origin = "https://www.nts.live";
const api = `${origin}/api/v2`;
const batch = 12;

const image = (media: unknown) =>
  object(media) ? picture(media.picture_medium ?? media.medium) : undefined;

function item(value: unknown, parent?: { title: string; url: string }, index?: number) {
  if (!object(value)) return null;
  const url =
    typeof value.show_alias === "string" && typeof value.episode_alias === "string"
      ? pageLink(
          "nts",
          `${origin}/shows/${value.show_alias}/episodes/${value.episode_alias}`,
          "atom",
        )
      : undefined;
  const genres = Array.isArray(value.genres)
    ? value.genres.flatMap((genre) =>
        object(genre) && label(genre.value) ? [label(genre.value)!] : [],
      )
    : [];
  return episode("nts", {
    url,
    title: label(value.name),
    date: value.broadcast,
    show: parent,
    thumbnail: image(value.media),
    ...(genres.length ? { description: genres.join(", ") } : {}),
    ...(parent && index !== undefined ? { collection: { ...parent, index } } : {}),
  });
}

function offsetOf(cursor?: string) {
  const offset = Number(cursor ?? "0");
  if ((cursor !== undefined && !/^\d{1,4}$/.test(cursor)) || offset % batch || offset >= maxList)
    throw new ProviderError("Invalid NTS page. Open the show again.", 400);
  return offset;
}

export const nts: Station = {
  async search(text, signal) {
    const value = await stationJson(
      `${api}/search?${new URLSearchParams([
        ["version", "2"],
        ["q", text],
        ["types[]", "episode"],
        ["types[]", "show"],
        ["limit", String(searchSize)],
      ])}`,
      signal,
    );
    if (!object(value) || !Array.isArray(value.results))
      throw new ProviderError("NTS returned invalid search results.");
    return value.results.flatMap((row): ProviderItem[] => {
      if (!object(row) || !object(row.article) || typeof row.article.path !== "string") return [];
      const images = object(row.image) ? row.image : {};
      const thumbnail = picture(images.medium);
      if (row.article_type === "show")
        return [
          show("nts", {
            url: pageLink("nts", `${origin}${row.article.path}`, "playlist"),
            title: label(row.title),
            thumbnail,
          }) ?? [],
        ].flat();
      // "02 Oct 2026", the date of the broadcast where it aired.
      const aired = typeof row.local_date === "string" ? Date.parse(`${row.local_date} UTC`) : NaN;
      return [
        episode("nts", {
          url: pageLink("nts", `${origin}${row.article.path}`, "atom"),
          title: label(row.title),
          ...(Number.isFinite(aired) ? { date: new Date(aired).toISOString() } : {}),
          thumbnail,
          description: object(row.description)
            ? label(row.description.highlight_plain, 2000)
            : undefined,
        }) ?? [],
      ].flat();
    });
  },
  async list(link, cursor, signal) {
    const offset = offsetOf(cursor);
    const alias = new URL(link.url).pathname.split("/")[2]!;
    const [about, page] = await Promise.all([
      stationJson(`${api}/shows/${alias}`, signal),
      stationJson(`${api}/shows/${alias}/episodes?limit=${batch}&offset=${offset}`, signal),
    ]);
    if (!object(about) || !object(page) || !Array.isArray(page.results))
      throw new ProviderError("NTS returned an invalid show.");
    const parent = { title: label(about.name) ?? "NTS", url: link.url };
    const count =
      object(page.metadata) && object(page.metadata.resultset)
        ? Number(page.metadata.resultset.count)
        : 0;
    return {
      title: parent.title,
      subtitle: "NTS",
      description: label(about.description, 2000),
      thumbnail: image(about.media),
      items: page.results.flatMap((row, index) => item(row, parent, offset + index) ?? []),
      ...(offset + batch < Math.min(count, maxList) ? { nextCursor: String(offset + batch) } : {}),
    };
  },
  async resolve(link, signal) {
    const path = new URL(link.url).pathname;
    const alias = path.split("/")[2]!;
    const [value, about] = await Promise.all([
      stationJson(`${api}${path}`, signal),
      stationJson(`${api}/shows/${alias}`, signal),
    ]);
    if (!object(value) || !object(about)) throw new ProviderError("NTS has no such episode.", 404);
    const found = item(value, {
      title: label(about.name) ?? "NTS",
      url: `${origin}/shows/${alias}`,
    });
    if (!found) throw new ProviderError("NTS returned an invalid episode.");
    const sources = Array.isArray(value.audio_sources) ? value.audio_sources.filter(object) : [];
    return {
      item: {
        ...found,
        ...(label(value.description, 2000) ? { description: label(value.description, 2000) } : {}),
      },
      recording: [...sources.map((source) => source.url), value.mixcloud]
        .map(recording)
        .find(Boolean),
    };
  },
};
