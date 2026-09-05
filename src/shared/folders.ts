import type { LibrarySource } from "./library";

export type FolderLocation = { name: string; path: string; selectable: boolean; error?: string };
export type FolderBrowse = { path: string | null; parent: string | null; locations: FolderLocation[]; offset: number; more: boolean };
export type ManagedFolder = LibrarySource & { path: string; verified: boolean; scannedItems: number };
