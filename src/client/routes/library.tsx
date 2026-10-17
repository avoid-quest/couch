import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "../sections/library/LibraryPage";
import { libraryTabs, type LibraryTab } from "../sections/library/LibrarySections";

// The open tab lives in the URL, so Back and the player return to it.
export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>): { tab?: LibraryTab } =>
    libraryTabs.includes(search.tab as LibraryTab) && search.tab !== "later" ? { tab: search.tab as LibraryTab } : {},
  component: LibraryPage,
});
