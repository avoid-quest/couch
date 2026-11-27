import type { ProviderItem } from "../../../shared/providers";
import { ProviderError } from "../http";
import {
  clock,
  episode,
  label,
  maxList,
  object,
  picture,
  recording,
  searchSize,
  show,
  stationJson,
  wholeList,
  type Station,
  slugPattern,
} from "./station";

// LYL's site is a script shell over Strapi: a REST search (accent-insensitive) and the GraphQL queries its pages use.
const origin = "https://lyl.live";
const searchUrl = "https://strapi.lyl.live/api/lyl/search";
const graphql = "https://strapi.lyl.live/graphql";
// Strapi's page size for a show's episodes; a show holds at most a few hundred.
const batch = 100;
const fields =
  "slug title artists startAt duration mixcloud soundcloud audio { url } image { url }";

async function query(document: string, variables: Record<string, unknown>, signal: AbortSignal) {
  const value = await stationJson(graphql, signal, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  if (!object(value) || !object(value.data) || (Array.isArray(value.errors) && value.errors.length))
    throw new ProviderError("Lyl Radio's archive is unavailable. Try again shortly.");
  return value.data;
}

const aired = (value: Record<string, unknown>) =>
  typeof value.startAt === "string" && Date.parse(value.startAt) <= Date.now();

function showLink(value: unknown) {
  if (!object(value) || typeof value.slug !== "string" || !slugPattern.test(value.slug)) return;
  const title = label(value.title);
  return title ? { title, url: `${origin}/show/${value.slug}` } : undefined;
}

function image(value: unknown) {
  if (!object(value)) return;
  const formats = object(value.formats) ? value.formats : {};
  const small = object(formats.small) ? formats.small.url : undefined;
  return picture(small ?? value.url);
}

function item(value: unknown, parent?: { title: string; url: string }) {
  if (
    !object(value) ||
    !aired(value) ||
    typeof value.slug !== "string" ||
    !slugPattern.test(value.slug)
  )
    return null;
  return episode("lyl", {
    url: `${origin}/episode/${value.slug}`,
    title: label(value.title),
    by: label(value.artists),
    date: value.startAt,
    show: showLink(value.show) ?? parent,
    thumbnail: image(value.image),
    duration: clock(value.duration),
    copies: [recording(value.mixcloud), recording(value.soundcloud)],
  });
}

async function showEpisodes(
  slug: string,
  parent: { title: string; url: string },
  signal: AbortSignal,
) {
  const episodes: Record<string, unknown>[] = [];
  for (let start = 0; start < maxList; start += batch) {
    const data = await query(
      `query($show: String!, $limit: Int, $start: Int) { episodesByShow(show: $show, limit: $limit, start: $start, sort: "startAt:desc") { ${fields} } }`,
      { show: slug, limit: batch, start },
      signal,
    );
    const rows = Array.isArray(data.episodesByShow) ? data.episodesByShow.filter(object) : [];
    episodes.push(...rows);
    if (rows.length < batch) break;
  }
  return episodes.flatMap((row) => {
    const found = item(row, parent);
    return found ? [{ item: found, at: String(row.startAt) }] : [];
  });
}

export const lyl: Station = {
  async search(text, signal) {
    const value = await stationJson(`${searchUrl}?${new URLSearchParams({ q: text })}`, signal);
    if (!object(value)) throw new ProviderError("Lyl Radio returned invalid search results.");
    const shows = (Array.isArray(value.shows) ? value.shows : []).flatMap((row) => {
      const link = showLink(row);
      return link && object(row)
        ? (show("lyl", { ...link, by: label(row.artists), thumbnail: image(row.image) }) ?? [])
        : [];
    });
    const episodes = (Array.isArray(value.episodes) ? value.episodes : [])
      .filter(object)
      .filter(aired)
      .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)))
      .flatMap((row) => item(row) ?? []);
    return [...episodes, ...shows].slice(0, searchSize);
  },
  async list(link, cursor, signal) {
    if (link.style) {
      // The residents page for a style: every episode of every show in it.
      const data = await query(
        `query($styles: [String]) { showsByStyles(limit: ${batch}, start: 0, styles: $styles, studios: [], sort: "title:asc") { slug title } }`,
        { styles: [link.style] },
        signal,
      );
      const shows = (Array.isArray(data.showsByStyles) ? data.showsByStyles : []).flatMap((row) => {
        const found = showLink(row);
        return found && object(row) ? [{ ...found, slug: String(row.slug) }] : [];
      });
      const episodes = (
        await Promise.all(shows.map((found) => showEpisodes(found.slug, found, signal)))
      )
        .flat()
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((found) => found.item);
      return wholeList(
        link,
        cursor,
        { title: link.style, subtitle: `Lyl Radio residents · ${shows.length} shows` },
        episodes,
      );
    }
    const data = await query(
      `query($slug: String!) { showBySlug(slug: $slug) { slug title artists description image { url } } }`,
      { slug: link.slug },
      signal,
    );
    const about = object(data.showBySlug) ? data.showBySlug : undefined;
    const parent = showLink(about);
    if (!about || !parent) throw new ProviderError("Lyl Radio has no such show.", 404);
    const episodes = await showEpisodes(link.slug, parent, signal);
    return wholeList(
      link,
      cursor,
      {
        title: parent.title,
        subtitle: ["Lyl Radio", label(about.artists)].filter(Boolean).join(" · "),
        description: label(about.description, 2000),
        thumbnail: image(about.image),
      },
      episodes.map((found) => found.item),
    );
  },
  async resolve(link, signal) {
    const data = await query(
      `query($slug: String!) { episodeBySlug(slug: $slug) { ${fields} description show { slug title } } }`,
      { slug: link.slug },
      signal,
    );
    const value = object(data.episodeBySlug) ? data.episodeBySlug : undefined;
    const found: ProviderItem | null = value ? item(value) : null;
    if (!value || !found) throw new ProviderError("Lyl Radio has no such past episode.", 404);
    const audio = object(value.audio) ? value.audio.url : undefined;
    return {
      item: {
        ...found,
        ...(label(value.description, 2000) ? { description: label(value.description, 2000) } : {}),
      },
      recording: recording(audio) ?? recording(value.soundcloud) ?? recording(value.mixcloud),
    };
  },
};
