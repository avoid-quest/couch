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
  wholeList,
  type Station,
  slugPattern,
} from "./station";

// Internet Public Radio: its site's search, and its public Sanity dataset for lists and episodes. Every episode's
// recording is the SoundCloud or Mixcloud page in `audioUrl`.
const origin = "https://www.internetpublicradio.live";
const sanity = "https://7rbo2iih.api.sanity.io/v2024-01-01/data/query/production";
const episodeFields = `title, date, audioUrl, "slug": slug.current, "image": image.asset->url,
  "resident": resident->{name, "slug": slug.current}, "series": series->{name, "slug": slug.current}`;

async function groq(query: string, params: Record<string, string>, signal: AbortSignal) {
  const search = new URLSearchParams({ query });
  for (const [name, value] of Object.entries(params)) search.set(`$${name}`, JSON.stringify(value));
  const value = await stationJson(`${sanity}?${search}`, signal);
  if (!object(value) || !("result" in value))
    throw new ProviderError("Internet Public Radio returned invalid data.");
  return value.result;
}

function owner(value: Record<string, unknown>) {
  for (const [kind, path] of [
    ["resident", "residents"],
    ["series", "series"],
  ] as const) {
    const found = value[kind];
    if (object(found) && typeof found.slug === "string" && slugPattern.test(found.slug))
      return {
        slug: found.slug,
        title: label(found.name) ?? found.slug,
        url: `${origin}/${path}/${found.slug}`,
      };
  }
}

function item(value: unknown) {
  if (!object(value) || typeof value.slug !== "string" || !slugPattern.test(value.slug))
    return null;
  const parent = owner(value);
  return episode("ipr", {
    url: parent && pageLink("ipr", `${origin}/${parent.slug}/episodes/${value.slug}`, "atom"),
    title: label(value.title),
    date: value.date,
    ...(parent ? { show: { title: parent.title, url: parent.url } } : {}),
    thumbnail: picture(value.image),
  });
}

export const ipr: Station = {
  async search(text, signal) {
    const rows = await stationJson(
      `${origin}/api/search?${new URLSearchParams({ q: text })}`,
      signal,
    );
    if (!Array.isArray(rows))
      throw new ProviderError("Internet Public Radio returned invalid search results.");
    return rows
      .filter(object)
      .flatMap((row): ProviderItem[] => {
        if (typeof row.href !== "string" || !row.href.startsWith("/")) return [];
        const fields = { title: label(row.label), thumbnail: picture(row.thumb) };
        const found =
          row._type === "episode"
            ? episode("ipr", {
                ...fields,
                url: pageLink("ipr", `${origin}${row.href}`, "atom"),
                date: row.date,
              })
            : show("ipr", { ...fields, url: pageLink("ipr", `${origin}${row.href}`, "playlist") });
        return found ? [found] : [];
      })
      .slice(0, searchSize);
  },
  async list(link, cursor, signal) {
    const kind = new URL(link.url).pathname.startsWith("/series/") ? "series" : "resident";
    const result = await groq(
      `{ "about": *[_type == "${kind}" && slug.current == $slug][0]{name, "image": image.asset->url},
        "episodes": *[_type == "episode" && ${kind}->slug.current == $slug && defined(audioUrl)] | order(date desc)[0...${maxList}]{${episodeFields}} }`,
      { slug: link.slug },
      signal,
    );
    const about = object(result) && object(result.about) ? result.about : undefined;
    if (!object(result) || !about || !Array.isArray(result.episodes))
      throw new ProviderError("Internet Public Radio has no such page.", 404);
    const title = label(about.name) ?? link.slug;
    return wholeList(
      link,
      cursor,
      { title, subtitle: "Internet Public Radio", thumbnail: picture(about.image) },
      result.episodes.flatMap((row) => item(row) ?? []),
    );
  },
  async resolve(link, signal) {
    const value = await groq(
      `*[_type == "episode" && slug.current == $slug][0]{${episodeFields}}`,
      { slug: link.slug },
      signal,
    );
    const found = item(value);
    if (!object(value) || !found)
      throw new ProviderError("Internet Public Radio has no such episode.", 404);
    return { item: found, recording: recording(value.audioUrl) };
  },
};
