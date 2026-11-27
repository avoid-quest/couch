import { mixcloudOrigin } from "../../../shared/mixcloud";
import { ProviderError } from "../http";
import {
  episode,
  label,
  maxList,
  object,
  picture,
  recording,
  searchSize,
  stationJson,
  wholeList,
  type Station,
  slugPattern,
} from "./station";

// HKCR's CMS API. It calls each broadcast a show and each show a resident; upcoming broadcasts are listed too.
const origin = "https://hkcr.live";
const api = "https://cms.hkcr.live";
const batch = 100;
const slug = (value: unknown) =>
  typeof value === "string" && slugPattern.test(value) ? value : undefined;
const aired = (value: Record<string, unknown>) =>
  typeof value.airdate === "string" && Date.parse(value.airdate) <= Date.now();
const image = (value: unknown) => (object(value) ? picture(value.url) : undefined);

function resident(value: unknown) {
  return object(value) && slug(value.slug)
    ? { title: label(value.name) ?? String(value.slug), url: `${origin}/residents/${value.slug}` }
    : undefined;
}

function item(value: unknown, parent?: { title: string; url: string }) {
  if (!object(value) || !aired(value) || !slug(value.slug)) return null;
  return episode("hkcr", {
    url: `${origin}/shows/${value.slug}`,
    title: label(value.title),
    date: value.airdate,
    show: parent ?? resident(value.resident),
    thumbnail: image(value.thumbnail),
  });
}

/** The mix a Mixcloud player embeds, from its `feed` (`/HKCR/<mix>/`). */
function mixcloudPlayer(value: unknown) {
  const url = picture(value);
  const feed =
    url && new URL(url).hostname.endsWith("mixcloud.com")
      ? new URL(url).searchParams.get("feed")
      : null;
  return feed?.startsWith("/") ? recording(`${mixcloudOrigin}${feed}`) : undefined;
}

export const hkcr: Station = {
  async search(text, signal) {
    const value = await stationJson(
      `${api}/shows/search?${new URLSearchParams({ q: text, limit: String(searchSize) })}`,
      signal,
    );
    if (!object(value) || !Array.isArray(value.shows))
      throw new ProviderError("HKCR returned invalid search results.");
    return value.shows.flatMap((row) => item(row) ?? []);
  },
  async list(link, cursor, signal) {
    const about = await stationJson(`${api}/residents/${encodeURIComponent(link.slug)}`, signal);
    const parent = resident(about);
    if (
      !object(about) ||
      !parent ||
      typeof about._id !== "string" ||
      !/^[a-f\d]{24}$/.test(about._id)
    )
      throw new ProviderError("HKCR has no such resident.", 404);
    const rows: unknown[] = [];
    for (let page = 1; rows.length < maxList; page++) {
      const value = await stationJson(
        `${api}/shows?residents=${about._id}&limit=${batch}&page=${page}`,
        signal,
      );
      if (!object(value) || !Array.isArray(value.shows))
        throw new ProviderError("HKCR returned an invalid resident.");
      rows.push(...value.shows);
      if (!object(value.pagination) || value.pagination.hasMore !== true) break;
    }
    return wholeList(
      link,
      cursor,
      { title: parent.title, subtitle: "HKCR", thumbnail: image(about.picture) },
      rows.flatMap((row) => item(row, { title: parent.title, url: link.url }) ?? []),
    );
  },
  async resolve(link, signal) {
    const value = await stationJson(`${api}/shows/${encodeURIComponent(link.slug)}`, signal);
    const found = item(value);
    if (!object(value) || !found) throw new ProviderError("HKCR has no such past broadcast.", 404);
    return {
      item: found,
      recording:
        (object(value.mixFile) ? recording(value.mixFile.url) : undefined) ??
        mixcloudPlayer(value.mixcloud) ??
        recording(value.youtube),
    };
  },
};
