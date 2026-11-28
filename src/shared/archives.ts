import type { MediaShape } from "./media";

export type ArchiveStation =
  | "lyl"
  | "nts"
  | "cashmere"
  | "sygma"
  | "hkcr"
  | "ipr"
  | "blackout"
  | "resonance";

/** A station's archive page: one recorded episode (atom), or a show, resident, series or style (playlist). */
export type ArchiveLink = {
  provider: "archives";
  station: ArchiveStation;
  shape: MediaShape;
  /** The station's own page, the one Couch saves and shows. */
  url: string;
  /** The page's last path segment: the episode, show, resident or series. */
  slug: string;
  /** LYL's residents filtered by one style, rather than one show. */
  style?: string;
};

export const archiveStationNames: Record<ArchiveStation, string> = {
  lyl: "Lyl Radio",
  nts: "NTS",
  cashmere: "Cashmere Radio",
  sygma: "Sygma Radio",
  hkcr: "HKCR",
  ipr: "Internet Public Radio",
  blackout: "Radio BlackOut",
  resonance: "Resonance Extra",
};

// A slug of at most 300 characters, starting with a letter, a digit or an escape (WordPress encodes "☽" as "%e2%98%bd").
const segment = "((?=[^/]{1,300}(?:/|$))(?:[A-Za-z0-9]|%[\\da-f]{2})[A-Za-z0-9_.~%-]*)";
// Each station's public pages: origin, accepted hosts, and its episode and list paths. A trailing slash is kept
// where the station's own links have one (WordPress), so a saved page is the station's canonical link.
const stations: Record<
  ArchiveStation,
  { origin: string; hosts: string[]; slash?: boolean; atoms: RegExp[]; lists: RegExp[] }
> = {
  lyl: {
    origin: "https://lyl.live",
    hosts: ["lyl.live", "www.lyl.live"],
    atoms: [new RegExp(`^/episode/${segment}$`)],
    lists: [new RegExp(`^/show/${segment}$`)],
  },
  nts: {
    origin: "https://www.nts.live",
    hosts: ["nts.live", "www.nts.live"],
    atoms: [new RegExp(`^/shows/${segment}/episodes/${segment}$`)],
    lists: [new RegExp(`^/shows/${segment}(?:/episodes)?$`)],
  },
  cashmere: {
    origin: "https://cashmereradio.com",
    hosts: ["cashmereradio.com", "www.cashmereradio.com"],
    slash: true,
    atoms: [new RegExp(`^/episode/${segment}$`)],
    lists: [new RegExp(`^/shows/${segment}$`)],
  },
  sygma: {
    origin: "https://radio.syg.ma",
    hosts: ["radio.syg.ma"],
    atoms: [new RegExp(`^/episodes/${segment}$`)],
    lists: [new RegExp(`^/shows/${segment}$`)],
  },
  hkcr: {
    origin: "https://hkcr.live",
    hosts: ["hkcr.live", "www.hkcr.live"],
    // HKCR calls each broadcast a show; its shows are residents.
    atoms: [new RegExp(`^/shows/${segment}$`)],
    lists: [new RegExp(`^/residents/${segment}$`)],
  },
  ipr: {
    origin: "https://www.internetpublicradio.live",
    hosts: ["internetpublicradio.live", "www.internetpublicradio.live"],
    atoms: [new RegExp(`^/${segment}/episodes/${segment}$`)],
    lists: [new RegExp(`^/(?:residents|series)/${segment}$`)],
  },
  blackout: {
    origin: "https://radioblackout.org",
    hosts: ["radioblackout.org", "www.radioblackout.org"],
    slash: true,
    atoms: [new RegExp(`^/podcast/${segment}$`)],
    lists: [new RegExp(`^/(?:shows|podcastfilter)/${segment}$`)],
  },
  resonance: {
    origin: "https://extra.resonance.fm",
    hosts: ["extra.resonance.fm"],
    atoms: [new RegExp(`^/episodes/${segment}$`)],
    lists: [new RegExp(`^/series/${segment}$`)],
  },
};

export const isArchiveHost = (host: string) =>
  Object.values(stations).some((station) => station.hosts.includes(host));

// Each station's site: an archive's hosts, and Radio Alhara's, whose archive is on Mixcloud.
const stationSites = [
  ...Object.values(stations).map((station) => station.hosts),
  ["radioalhara.net", "www.radioalhara.net"],
];
/** Whether a host is one of the stations' own sites, whose pages besides episodes and shows play the station live. */
export const isStationSite = (host: string) => stationSites.some((hosts) => hosts.includes(host));

/** Whether `address` is on the same station's site as the page `link`: its hosts, or under them (icecast.lyl.live). */
export function onStationSite(link: string, address: string) {
  try {
    const page = new URL(link).hostname;
    const host = new URL(address).hostname;
    const site = stationSites.find((hosts) => hosts.includes(page));
    return !!site?.some((own) => host === own || host.endsWith(`.${own}`));
  } catch {
    return false;
  }
}

/** What a station's link is, from the link alone: Couch can tell before fetching anything. */
export function archiveLink(value: string): ArchiveLink | undefined {
  if (value.length > 2048) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port)
    return;
  const station = (Object.keys(stations) as ArchiveStation[]).find((id) =>
    stations[id].hosts.includes(url.hostname),
  );
  if (!station) return;
  const { origin, slash, atoms, lists } = stations[station];
  // WordPress spells a slug's escapes in lower case, as its own links do.
  const path = url.pathname
    .replace(/\/$/, "")
    .replace(/%[\dA-F]{2}/g, (escape) => escape.toLowerCase());
  try {
    decodeURIComponent(path);
  } catch {
    return;
  }
  if (station === "lyl" && path === "/shows/residents") {
    const style = url.searchParams.get("styles")?.trim();
    if (!style || style.length > 100 || /[\u0000-\u001f\u007f]/.test(style)) return;
    return {
      provider: "archives",
      station,
      shape: "playlist",
      url: `${origin}/shows/residents?styles=${encodeURIComponent(style)}`,
      slug: "residents",
      style,
    };
  }
  for (const [shape, patterns] of [
    ["atom", atoms],
    ["playlist", lists],
  ] as const) {
    const match = patterns.map((pattern) => pattern.exec(path)).find(Boolean);
    if (!match) continue;
    // An NTS show's episode list is its show's page; anywhere else, "episodes" is a slug.
    const page = station === "nts" && shape === "playlist" ? `/shows/${match[1]}` : path;
    return {
      provider: "archives",
      station,
      shape,
      url: `${origin}${page}${slash ? "/" : ""}`,
      slug: match.at(-1)!,
    };
  }
}
