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
}

export interface RadioPlaylist {
  id: string;
  name: string;
  url: string;
  stationCount: number;
  updatedAt: number | null;
  error: string | null;
}

export type RadioPlaylistSummary = Omit<RadioPlaylist, "url">;

export const avoidRadioPlaylistId = "544da8af-6077-80f3-a15b-884c42740444";
export const avoidRadioPlaylistUrl = "https://radio.avoid.quest/playlist.m3u";

export interface RadioProgrammeDetails {
  stationId: string;
  provider: "radio.avoid.quest";
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
}

export interface AvoidRadioCatalog {
  playlist: RadioPlaylistSummary;
  stations: RadioStation[];
}
