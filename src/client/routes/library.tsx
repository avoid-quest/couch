import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "../sections/saved/LibraryPage";
import { savedTabs, type SavedTab } from "../sections/saved/SavedSection";

// The open tab lives in the URL, so Back and the player return to it.
export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>): { tab?: SavedTab } =>
    savedTabs.includes(search.tab as SavedTab) && search.tab !== "later" ? { tab: search.tab as SavedTab } : {},
  component: LibraryPage,
});
