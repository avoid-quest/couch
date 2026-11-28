import { ProviderError } from "../http";
import {
  episode,
  label,
  object,
  picture,
  recording,
  searchSize,
  show,
  stationJson,
  wholeList,
  wordpressRows,
  type Station,
  slugPattern,
} from "./station";

// Radio BlackOut's WordPress REST API. A show's episodes are the podcasts filed under the podcast filter of the same
// slug; an episode's recording is the audio its post embeds.
const origin = "https://radioblackout.org";
const api = `${origin}/wp-json/wp/v2`;
const fields = "_fields=slug,title,date,recording_date,featured_media,show";
const rendered = (value: unknown) => (object(value) ? value.rendered : value);
const slug = (value: unknown) =>
  typeof value === "string" && slugPattern.test(value) ? value : undefined;
// `{ file: "2026/10/x.jpg" }`, an upload's path.
const image = (value: unknown) =>
  object(value) &&
  typeof value.file === "string" &&
  /^[\w./-]{1,300}$/.test(value.file) &&
  !value.file.includes("..")
    ? picture("blackout", `${origin}/wp-content/uploads/${value.file}`)
    : undefined;

function item(value: unknown, parent?: { title: string; url: string }) {
  if (!object(value) || !slug(value.slug)) return null;
  const own = object(value.show) && slug(value.show.slug) ? value.show : undefined;
  return episode("blackout", {
    url: `${origin}/podcast/${value.slug}/`,
    title: label(rendered(value.title)),
    date: value.recording_date ?? value.date,
    show:
      parent ??
      (own && { title: label(own.name) ?? String(own.slug), url: `${origin}/shows/${own.slug}/` }),
    thumbnail: image(value.featured_media),
  });
}

/** The first recording a post embeds: an uploaded file, else a SoundCloud or Mixcloud player. */
function embedded(html: string) {
  const file = /<(?:source|audio)\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html)?.[1];
  if (file) return recording(file.replace(/&amp;/g, "&"));
  const player = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for (const [, src] of html.matchAll(player)) {
    const url = URL.parse(src!.replace(/&amp;/g, "&"));
    const target =
      url?.hostname === "w.soundcloud.com"
        ? url.searchParams.get("url")
        : url?.hostname.endsWith("mixcloud.com") && url.searchParams.get("feed")?.startsWith("/")
          ? `https://www.mixcloud.com${url.searchParams.get("feed")}`
          : undefined;
    const found = recording(target);
    if (found) return found;
  }
}

export const blackout: Station = {
  async search(text, signal) {
    const [episodes, shows] = await Promise.all([
      // Searching titles only answers in a second; the site's full-text search takes five.
      stationJson(
        `${api}/podcast?${new URLSearchParams({ search: text, search_columns: "post_title", per_page: String(searchSize) })}&${fields}`,
        signal,
      ),
      stationJson(
        `${api}/shows?${new URLSearchParams({ search: text, per_page: "4" })}&_fields=slug,title`,
        signal,
      ),
    ]);
    if (!Array.isArray(episodes) || !Array.isArray(shows))
      throw new ProviderError("Radio BlackOut returned invalid search results.");
    return [
      ...episodes.flatMap((row) => item(row) ?? []),
      ...shows.flatMap((row) =>
        object(row) && slug(row.slug)
          ? (show("blackout", {
              url: `${origin}/shows/${row.slug}/`,
              title: label(rendered(row.title)),
            }) ?? [])
          : [],
      ),
    ];
  },
  async list(link, cursor, signal) {
    const [terms, shows] = await Promise.all([
      stationJson(
        `${api}/podcastfilter?slug=${encodeURIComponent(link.slug)}&_fields=id,name`,
        signal,
      ),
      stationJson(
        `${api}/shows?slug=${encodeURIComponent(link.slug)}&_fields=title,excerpt,featured_media`,
        signal,
      ),
    ]);
    const term = Array.isArray(terms) ? terms.find(object) : undefined;
    const about = Array.isArray(shows) ? shows.find(object) : undefined;
    if (!term || !Number.isSafeInteger(term.id))
      throw new ProviderError("Radio BlackOut has no such show.", 404);
    const title = label(rendered(about?.title)) ?? label(term.name) ?? link.slug;
    const { rows, total } = await wordpressRows(
      `${api}/podcast?podcastfilter=${term.id}&${fields}`,
      signal,
      () => new ProviderError("Radio BlackOut returned an invalid show."),
    );
    return wholeList(
      link,
      cursor,
      {
        title,
        subtitle: "Radio BlackOut",
        description: label(rendered(about?.excerpt), 2000),
        thumbnail: image(about?.featured_media),
        count: total,
      },
      rows.flatMap((row) => item(row, { title, url: link.url }) ?? []),
    );
  },
  async resolve(link, signal) {
    const rows = await stationJson(
      `${api}/podcast?slug=${encodeURIComponent(link.slug)}&${fields},content`,
      signal,
    );
    const value = Array.isArray(rows) ? rows.find(object) : undefined;
    const found = item(value);
    if (!value || !found) throw new ProviderError("Radio BlackOut has no such episode.", 404);
    const content = rendered(value.content);
    return { item: found, recording: typeof content === "string" ? embedded(content) : undefined };
  },
};
