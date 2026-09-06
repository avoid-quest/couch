import type { LibraryItem } from "./library";

export type CollectionFilter = {
  kind: "movie" | "episode" | "audio";
  title?: string;
  artist?: string;
  album?: string;
  show?: string;
  genre?: string;
  year?: number;
};
export type CollectionSort = "manual" | "title" | "year" | "album";
export type CollectionDefinition = {
  name: string;
  sort: CollectionSort;
  descending: boolean;
  filter: CollectionFilter | null;
  members: Array<{ id: string; title: string }>;
};
export type SavedCollection = CollectionDefinition & { id: string; revision: number; updatedAt: number };
export type CollectionPreview = { collection: SavedCollection; items: LibraryItem[]; total: number; digest: string };
