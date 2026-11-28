import { mixcloudOrigin } from "../../../shared/mixcloud";
import { ProviderError } from "../http";
import {
  episode,
  label,
  matches,
  object,
  recording,
  remembered,
  searchSize,
  show,
  stationJson,
  wholeList,
  type Station,
} from "./station";

// Resonance Extra's archive API. It has no search: Couch matches series names from its index, kept for a day.
// Every recording is the station's Mixcloud upload; a repeat points at its original broadcast.
const origin = "https://extra.resonance.fm";
const api = "https://x.resonance.fm/api";
const slugOf = (path: unknown, kind: "series" | "episodes") => {
  const match =
    typeof path === "string" ? new RegExp(`^/${kind}/([\\w-]{1,200})$`).exec(path) : null;
  return match?.[1];
};

const index = remembered(24 * 60 * 60_000, async (signal) => {
  const value = await stationJson(`${api}/series_index`, signal);
  if (!object(value) || !Array.isArray(value.series))
    throw new ProviderError("Resonance Extra returned an invalid index.");
  return value.series.filter(object);
});

// "/resonanceextra/<mix>/" or a whole Mixcloud link.
const mixcloud = (value: unknown) =>
  typeof value === "string" && value.startsWith("/")
    ? recording(`${mixcloudOrigin}${value}`)
    : recording(value);

async function episodeDetail(slug: string, signal: AbortSignal) {
  const value = await stationJson(`${api}/episode/${encodeURIComponent(slug)}`, signal);
  if (!object(value) || !object(value.episode))
    throw new ProviderError("Resonance Extra has no such episode.", 404);
  return value.episode;
}

function item(value: unknown, parent?: { title: string; url: string }) {
  if (!object(value)) return null;
  const slug = slugOf(value.path, "episodes");
  return episode("resonance", {
    url: slug && `${origin}/episodes/${slug}`,
    title: label(value.name),
    // "Monday 18th September 2017 17:00 - 20:00 BST"
    by: label(value.starts_ends),
    date: value.start_time,
    show: parent,
  });
}

export const resonance: Station = {
  async search(text, signal) {
    return (await index(signal))
      .filter((row) => matches(text, String(row.name ?? "")))
      .slice(0, searchSize)
      .flatMap((row) => {
        const slug = slugOf(row.path, "series");
        return slug
          ? (show("resonance", { url: `${origin}/series/${slug}`, title: label(row.name) }) ?? [])
          : [];
      });
  },
  async list(link, cursor, signal) {
    const value = await stationJson(`${api}/series/${encodeURIComponent(link.slug)}`, signal);
    const series = object(value) && object(value.series) ? value.series : undefined;
    if (!series || !Array.isArray(series.previous_episodes))
      throw new ProviderError("Resonance Extra has no such series.", 404);
    const title = label(series.name) ?? link.slug;
    return wholeList(
      link,
      cursor,
      {
        title,
        subtitle: ["Resonance Extra", label(series.host)].filter(Boolean).join(" · "),
        description: label(series.description, 2000),
      },
      series.previous_episodes.flatMap((row) => item(row, { title, url: link.url }) ?? []),
    );
  },
  async resolve(link, signal) {
    const detail = await episodeDetail(link.slug, signal);
    const series = slugOf(detail.series_link, "series");
    const found = item(
      { ...detail, path: `/episodes/${link.slug}` },
      series
        ? { title: label(detail.series_name) ?? series, url: `${origin}/series/${series}` }
        : undefined,
    );
    if (!found) throw new ProviderError("Resonance Extra returned an invalid episode.");
    const original = slugOf(detail.original_episode_path, "episodes");
    return {
      item: found,
      recording:
        mixcloud(detail.mixcloud_stream_url) ??
        (original
          ? mixcloud((await episodeDetail(original, signal)).mixcloud_stream_url)
          : undefined),
    };
  },
};
