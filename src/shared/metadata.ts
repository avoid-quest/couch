import type { VideoMetadata } from "./library";

export type MetadataValues = Pick<VideoMetadata, "originalTitle" | "plot" | "year" | "premiered" | "genres" | "season" | "episode"> & { title: string; showTitle: string | null; artworkId: string | null };
export type MetadataOrigin = "Imported/local" | "Manual" | "TMDB";
export type MetadataMatch = { kind: "movie" | "episode"; id: number; seriesId?: number; season?: number; episode?: number; title: string };
export type MetadataView = {
  id: string; type: "movie" | "episode"; revision: string; values: MetadataValues;
  origins: Record<keyof MetadataValues, MetadataOrigin>; match: MetadataMatch | null;
};
export type MetadataCandidate = { id: number; title: string; year: string; description: string };
export type MetadataPreview = { id: string; expiresAt: number; match: MetadataMatch; values: MetadataValues; artwork: string | null };
