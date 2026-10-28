export interface RadioStation {
  id: string;
  name: string;
  url: string;
  homepage: string | null;
  countryCode: string;
  codec: string;
  bitrate: number;
  logoUrl?: string;
  groupTitle?: string;
  sourceId?: string;
  tvgId?: string;
  tags?: string[];
}

export interface RadioPlaylist {
  id: string;
  name: string;
  url: string;
  stationCount: number;
  updatedAt: number | null;
  error: string | null;
  guideUrl?: string | null;
  discoveredGuideUrl?: string | null;
}

export type RadioPlaylistSummary = Omit<RadioPlaylist, "url" | "guideUrl" | "discoveredGuideUrl">;

/** A radio station: Couch's own catalog entries say so by kind, a radio playlist's by their `radio:` source. */
export const isRadio = (entry: { kind?: string; source: string } | null | undefined) => entry?.kind === "radio" || !!entry?.source.startsWith("radio:");

/** The addresses a station's queue entry can have: its Couch source, or the stream it plays. */
export const stationSources = (station: Pick<RadioStation, "id" | "url">) => [`radio:${station.id}`, station.url] as const;

export const avoidRadioPlaylistId = "544da8af-6077-80f3-a15b-884c42740444";
export const avoidRadioPlaylistUrl = "https://radio.avoid.quest/playlist.m3u";

export interface RadioProgrammeDetails {
  stationId: string;
  provider: "radio.avoid.quest" | "xmltv";
  title: string;
  artworkUrl?: string;
  description?: string;
  genre?: string;
  artist?: string;
  album?: string;
  bitrate?: number;
  programmeUrl?: string;
  sampledAt: number;
  expiresAt: number;
  start?: number;
  end?: number;
  categories?: string[];
}

export type RadioScheduleEntry = { id: string; title: string; start: number; end: number; description?: string; artworkUrl?: string; categories?: string[] };
export type RadioGuide = { programmes: RadioScheduleEntry[]; live: RadioProgrammeDetails | null };

/** Keep punctuation and spelling; fold only whitespace, Unicode form and case. */
export function radioLabels(values: readonly string[]): string[] {
  const labels = new Map<string, string>();
  for (const value of values) {
    const label = value.normalize("NFC").trim().replace(/\s+/g, " ");
    if (label && label.length <= 500 && !/[\u0000-\u001f\u007f]/.test(label) && !labels.has(label.toLowerCase())) labels.set(label.toLowerCase(), label);
  }
  return [...labels.values()];
}

export const freshRadioProgramme = (value: RadioProgrammeDetails | null | undefined, now = Date.now()) =>
  value && value.expiresAt > now && (value.start === undefined || value.start <= now) && (value.end === undefined || now < value.end) ? value : null;

/** Matching titles share guide fields. A fresh different live show stays whole, without borrowing the slot's metadata or times. */
export function radioNow(guide: RadioGuide | undefined, stationId: string, now = Date.now()): RadioProgrammeDetails | null {
  const scheduled = guide?.programmes.filter(item => item.start <= now && now < item.end).sort((a, b) => b.start - a.start)[0];
  const live = freshRadioProgramme(guide?.live, now);
  const nextStart = radioNext(guide, now)?.start ?? Infinity;
  if (!scheduled) {
    const ended = live && guide?.programmes.some(item => live.sampledAt < item.end && item.end <= now);
    return ended || !live ? null : { ...live, expiresAt: Math.min(live.expiresAt, nextStart) };
  }
  const observed = live && live.sampledAt >= scheduled.start && live.sampledAt < scheduled.end ? live : null;
  if (observed && radioLabels([observed.title])[0]?.toLowerCase() !== radioLabels([scheduled.title])[0]?.toLowerCase()) {
    return { ...observed, expiresAt: Math.min(observed.expiresAt, scheduled.end, nextStart) };
  }
  const matching = observed;
  return { ...matching, ...scheduled, stationId, provider: "xmltv", sampledAt: matching?.sampledAt ?? scheduled.start,
    expiresAt: Math.min(scheduled.end, nextStart, matching?.expiresAt ?? scheduled.end),
    description: scheduled.description || matching?.description, artworkUrl: scheduled.artworkUrl || matching?.artworkUrl,
    categories: radioShowLabels({ categories: scheduled.categories, genre: matching?.genre }) };
}

export const radioNext = (guide: RadioGuide | undefined, now = Date.now()) => guide?.programmes.filter(item => item.start > now).sort((a, b) => a.start - b.start)[0];
/** Only a complete list of known categories is redundant; a partial match may belong to a compound label. */
export function radioShowLabels(show: Pick<RadioProgrammeDetails, "categories" | "genre"> | null | undefined) {
  const categories = radioLabels(show?.categories ?? []);
  const genre = radioLabels(show?.genre ? [show.genre] : [])[0] ?? "";
  let unmatched = genre;
  for (const category of categories.toSorted((a, b) => b.length - a.length)) {
    unmatched = unmatched.replace(new RegExp(`(^|,\\s*)${RegExp.escape(category)}(?=\\s*(?:,|$))`, "giu"), "$1");
  }
  const repeated = unmatched !== genre && /^[\s,]*$/.test(unmatched);
  return radioLabels([...categories, repeated ? "" : genre]);
}
/** A show's host, unless the show is named after them ("DJ Alé" hosted by DJ Alé): its title already says it. */
export const radioHost = (show: RadioProgrammeDetails | null | undefined) => show?.artist && show.artist.localeCompare(show.title, undefined, { sensitivity: "base" }) ? show.artist : undefined;
export function radioMatches(station: RadioStation, query: string, show?: RadioProgrammeDetails | null) {
  return [station.name, station.groupTitle, ...(station.tags ?? []), show?.title, show?.artist, ...radioShowLabels(show)].filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase());
}

export interface AvoidRadioCatalog {
  playlist: RadioPlaylistSummary;
  stations: RadioStation[];
}
