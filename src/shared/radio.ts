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
