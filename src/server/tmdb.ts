import type { MetadataCandidate, MetadataMatch, MetadataValues } from "../shared/metadata";
import { MetadataError, metadataChanges } from "./metadata-values";
import { videoArtwork, type VideoArtwork } from "./video-metadata";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, length = 300) => typeof value === "string" ? value.trim().slice(0, length) : "";
const number = (value: unknown, max = 2_147_483_647) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max ? Number(value) : null;
export async function boundedMetadataBody(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new MetadataError("TMDB is unavailable or rejected the request. Local metadata is unchanged.", 502); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new MetadataError("Metadata response exceeds the size limit.", 502);
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
export function createTmdb(fetcher: typeof fetch = fetch) {
  const closing = new AbortController();
  let pending = 0;
  async function operation<T>(token: string, signal: AbortSignal, run: (read: (path: string) => Promise<Json>, image: (path: string, still: boolean) => Promise<VideoArtwork>) => Promise<T>) {
    if (!token) throw new MetadataError("Add a TMDB API Read Access Token in Settings → Sources first.", 409);
    if (pending >= 2) throw new MetadataError("Two metadata requests are already running. Try again shortly.", 429);
    pending++;
    const bounded = AbortSignal.any([signal, closing.signal, AbortSignal.timeout(10_000)]);
    const read = async (path: string) => record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedMetadataBody(await fetcher(`https://api.themoviedb.org/3/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal: bounded,
    }), 1024 * 1024))));
    const image = async (path: string, still: boolean) => {
      if (!/^\/[a-zA-Z0-9]+\.(?:jpg|png)$/.test(path)) throw new MetadataError("TMDB returned an unsupported artwork path.", 502);
      const configuration = record((await read("configuration")).images);
      const size = still ? "w300" : "w500", sizes = configuration[still ? "still_sizes" : "poster_sizes"];
      if (configuration.secure_base_url !== "https://image.tmdb.org/t/p/" || !Array.isArray(sizes) || !sizes.includes(size)) throw new MetadataError("TMDB artwork configuration is unsupported.", 502);
      const result = videoArtwork(await boundedMetadataBody(await fetcher(`https://image.tmdb.org/t/p/${size}${path}`, { redirect: "error", signal: bounded }), 2 * 1024 * 1024));
      if (!result) throw new MetadataError("TMDB artwork is invalid or too large.", 502);
      return result;
    };
    try { const result = await run(read, image); bounded.throwIfAborted(); return result; }
    catch (error) { if (error instanceof MetadataError) throw error; throw new MetadataError("TMDB lookup failed or timed out. Local metadata is unchanged.", 502); }
    finally { pending--; }
  }
  return {
    search(token: string, kind: "movie" | "episode", query: string, signal: AbortSignal): Promise<MetadataCandidate[]> {
      if (!query.trim() || query.length > 200 || /[\u0000-\u001f]/.test(query)) throw new MetadataError("Enter a movie or series title, up to 200 characters.");
      return operation(token, signal, async read => {
        const response = await read(`search/${kind === "movie" ? "movie" : "tv"}?${new URLSearchParams({ query, language: "en-US", include_adult: "false", page: "1" })}`);
        if (!Array.isArray(response.results)) throw new MetadataError("TMDB returned invalid search results.", 502);
        return response.results.slice(0, 20).map(record).filter(item => number(item.id) !== null && text(item.title ?? item.name)).map(item => ({ id: Number(item.id), title: text(item.title ?? item.name), year: text(item.release_date ?? item.first_air_date, 10), description: text(item.overview, 400) }));
      });
    },
    preview(token: string, kind: "movie" | "episode", id: number, season: number | null, episode: number | null, signal: AbortSignal): Promise<{ match: MetadataMatch; values: MetadataValues; artwork: VideoArtwork | null }> {
      if (number(id) === null || kind === "episode" && (number(season, 999) === null || number(episode, 9999) === null)) throw new MetadataError("Choose a valid match and episode numbers.");
      return operation(token, signal, async (read, image) => {
        const series = kind === "episode" ? await read(`tv/${id}?language=en-US`) : null;
        const details = await read(kind === "movie" ? `movie/${id}?language=en-US` : `tv/${id}/season/${season}/episode/${episode}?language=en-US`);
        if (number(details.id) === null || kind === "movie" && details.id !== id || kind === "episode" && (series?.id !== id || details.season_number !== season || details.episode_number !== episode)) throw new MetadataError("TMDB returned a different item.", 502);
        const title = text(details.title ?? details.name);
        const premiered = text(details.release_date ?? details.air_date, 10) || null;
        const genres = (Array.isArray((series ?? details).genres) ? (series ?? details).genres as unknown[] : []).slice(0, 16).map(v => text(record(v).name, 80)).filter(Boolean);
        const path = details.poster_path ?? details.still_path;
        const artwork = typeof path === "string" && path ? await image(path, kind === "episode") : null;
        const values: MetadataValues = { title, showTitle: series ? text(series.name) : null, originalTitle: text(details.original_title) || null, plot: text(details.overview, 4000) || null,
          year: premiered ? Number(premiered.slice(0, 4)) : null, premiered, genres: [...new Set(genres)], season: kind === "episode" ? season : null,
          episode: kind === "episode" ? episode : null, artworkId: artwork?.id ?? null };
        metadataChanges(values, kind === "episode");
        return { match: { kind, id: Number(details.id), title: series ? `${text(series.name)}: ${title}` : title, ...(series ? { seriesId: id, season: season!, episode: episode! } : {}) }, values, artwork };
      });
    },
    close() { closing.abort(); },
  };
}
