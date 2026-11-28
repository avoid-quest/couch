import { ProviderError } from "../http";
import {
  episode,
  label,
  object,
  recording,
  searchSize,
  show,
  stationJson,
  wholeList,
  wordpressRows,
  type Station,
  slugPattern,
} from "./station";

// Cashmere's WordPress REST API. An episode's show is its category, whose slug is the show page's;
// its recording is the Mixcloud upload it links (the archive file's storage key has no public address).
const origin = "https://cashmereradio.com";
const api = "https://backstage.cashmereradio.com/wp-json/wp/v2";
const episodeFields = "_fields=slug,date,title,categories,acf";
const rendered = (value: unknown) => (object(value) ? value.rendered : value);

function item(value: unknown, parent?: { title: string; url: string }) {
  if (!object(value) || typeof value.slug !== "string" || !slugPattern.test(value.slug))
    return null;
  return episode("cashmere", {
    url: `${origin}/episode/${value.slug}/`,
    title: label(rendered(value.title)),
    date: value.date,
    show: parent,
  });
}

async function category(query: string, signal: AbortSignal) {
  const rows = await stationJson(`${api}/categories?${query}&_fields=id,slug,name`, signal);
  const row = Array.isArray(rows) ? rows.find(object) : undefined;
  return row &&
    Number.isSafeInteger(row.id) &&
    typeof row.slug === "string" &&
    slugPattern.test(row.slug)
    ? {
        id: Number(row.id),
        title: label(row.name) ?? row.slug,
        url: `${origin}/shows/${row.slug}/`,
      }
    : undefined;
}

export const cashmere: Station = {
  async search(text, signal) {
    const [episodes, shows] = await Promise.all([
      stationJson(
        `${api}/episode?${new URLSearchParams({ search: text, per_page: String(searchSize) })}&${episodeFields}`,
        signal,
      ),
      stationJson(
        `${api}/pages?${new URLSearchParams({ search: text, parent: "2", per_page: "4" })}&_fields=slug,title,acf.show_host`,
        signal,
      ),
    ]);
    if (!Array.isArray(episodes) || !Array.isArray(shows))
      throw new ProviderError("Cashmere Radio returned invalid search results.");
    return [
      ...episodes.flatMap((row) => item(row) ?? []),
      ...shows.flatMap((row) =>
        object(row) && typeof row.slug === "string" && slugPattern.test(row.slug)
          ? (show("cashmere", {
              url: `${origin}/shows/${row.slug}/`,
              title: label(rendered(row.title)),
              by: object(row.acf) ? label(row.acf.show_host) : undefined,
            }) ?? [])
          : [],
      ),
    ];
  },
  async list(link, cursor, signal) {
    const parent = await category(`slug=${encodeURIComponent(link.slug)}`, signal);
    if (!parent) throw new ProviderError("Cashmere Radio has no such show.", 404);
    const { rows: episodes, total } = await wordpressRows(
      `${api}/episode?categories=${parent.id}&${episodeFields}`,
      signal,
      () => new ProviderError("Cashmere Radio returned an invalid show."),
    );
    return wholeList(
      link,
      cursor,
      { title: parent.title, subtitle: "Cashmere Radio", count: total },
      episodes.flatMap((row) => item(row, { title: parent.title, url: link.url }) ?? []),
    );
  },
  async resolve(link, signal) {
    const rows = await stationJson(
      `${api}/episode?slug=${encodeURIComponent(link.slug)}&${episodeFields}`,
      signal,
    );
    const value = Array.isArray(rows) ? rows.find(object) : undefined;
    const id = value && Array.isArray(value.categories) ? value.categories[0] : undefined;
    const parent = Number.isSafeInteger(id) ? await category(`include=${id}`, signal) : undefined;
    const found = item(value, parent && { title: parent.title, url: parent.url });
    if (!value || !found) throw new ProviderError("Cashmere Radio has no such episode.", 404);
    return {
      item: found,
      recording: object(value.acf) ? recording(value.acf.episode_mixcloud_link) : undefined,
    };
  },
};
