import { ProviderError, readProviderText } from "../http";
import {
  episode,
  label,
  matches,
  maxList,
  object,
  picture,
  recording,
  remembered,
  searchSize,
  show,
  stationJson,
  wholeList,
  type Station,
  slugPattern,
} from "./station";

// Sygma's backend JSON. It has no search: its site filters the whole catalogue (under a thousand episodes, embedded
// as a literal in the home page) on the device, and so does Couch, from a copy kept for an hour.
const origin = "https://radio.syg.ma";
const api = "https://backend.radio.syg.ma";

// "29/10/26", day first.
const date = (value: unknown) => {
  const match = typeof value === "string" ? /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value) : null;
  return match ? `20${match[3]}-${match[2]}-${match[1]}` : undefined;
};
const slug = (value: unknown) =>
  typeof value === "string" && slugPattern.test(value) ? value : undefined;

function item(value: unknown, parent?: { title: string; url: string }, thumbnail?: string) {
  if (!object(value) || !slug(value.slug)) return null;
  return episode("sygma", {
    url: `${origin}/episodes/${value.slug}`,
    title: label(value.title),
    date: date(value.date),
    show: parent,
    thumbnail: thumbnail ?? image(value.picture),
  });
}

const image = (value: unknown) =>
  object(value) ? picture(object(value.small) ? value.small.url : value.url) : undefined;

const catalogue = remembered(60 * 60_000, async (signal) => {
  const response = await fetch(`${origin}/`, { signal, redirect: "error", credentials: "omit" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(`Sygma Radio returned HTTP ${response.status}.`);
  }
  const html = await readProviderText(
    response,
    8 * 1024 * 1024,
    signal,
    new ProviderError("Sygma Radio returned too much data."),
  );
  const literal = /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/.exec(
    html,
  )?.[1];
  let data: unknown;
  try {
    data = JSON.parse(literal ?? "");
  } catch {
    throw new ProviderError("Sygma Radio's catalogue changed.");
  }
  const page =
    object(data) && object(data.props) && object(data.props.pageProps) ? data.props.pageProps : {};
  if (!Array.isArray(page.episodes)) throw new ProviderError("Sygma Radio's catalogue changed.");
  return page.episodes.filter(object);
});
const shows = remembered(60 * 60_000, async (signal) => {
  const rows = await stationJson(`${api}/shows.json`, signal);
  if (!Array.isArray(rows)) throw new ProviderError("Sygma Radio returned invalid shows.");
  return rows.filter(object);
});

export const sygma: Station = {
  async search(text, signal) {
    const [episodes, all] = await Promise.all([catalogue(signal), shows(signal)]);
    return [
      ...episodes
        .filter((row) => matches(text, String(row.title ?? "")))
        .slice(0, searchSize)
        .flatMap((row) => item(row) ?? []),
      ...all
        .filter((row) => slug(row.slug) && matches(text, String(row.title ?? "")))
        .slice(0, 4)
        .flatMap(
          (row) =>
            show("sygma", {
              url: `${origin}/shows/${row.slug}`,
              title: label(row.title),
              thumbnail: image(row.picture),
            }) ?? [],
        ),
    ];
  },
  async list(link, cursor, signal) {
    const rows: unknown[] = [];
    let about: Record<string, unknown> = {};
    for (let page = 1; rows.length < maxList; page++) {
      const value = await stationJson(
        `${api}/shows/${encodeURIComponent(link.slug)}.json?page=${page}`,
        signal,
      );
      if (!object(value) || !Array.isArray(value.episodes))
        throw new ProviderError("Sygma Radio has no such show.", 404);
      about = page === 1 ? value : about;
      rows.push(...value.episodes);
      if (value.has_more !== true || !value.episodes.length) break;
    }
    const parent = { title: label(about.title) ?? link.slug, url: link.url };
    const thumbnail = image(about.picture);
    return wholeList(
      link,
      cursor,
      {
        title: parent.title,
        subtitle: "Sygma Radio",
        description: label(about.short_description, 2000),
        thumbnail,
      },
      rows.flatMap((row) => item(row, parent, thumbnail) ?? []),
    );
  },
  async resolve(link, signal) {
    const value = await stationJson(
      `${api}/episodes/${encodeURIComponent(link.slug)}.json`,
      signal,
    );
    const first =
      object(value) && Array.isArray(value.shows) ? value.shows.find(object) : undefined;
    const parent =
      first && slug(first.slug)
        ? { title: label(first.title) ?? String(first.slug), url: `${origin}/shows/${first.slug}` }
        : undefined;
    const found = item(value, parent);
    if (!object(value) || !found) throw new ProviderError("Sygma Radio has no such episode.", 404);
    return { item: found, recording: recording(value.mc_link) };
  },
};
