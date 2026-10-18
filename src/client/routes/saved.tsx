import { createFileRoute } from "@tanstack/react-router";
import { SavedPage } from "../sections/saved/SavedPage";
import { savedTabs, type SavedTab } from "../sections/saved/SavedSections";

// The open tab lives in the URL, so Back and the player return to it.
export const Route = createFileRoute("/saved")({
  validateSearch: (search: Record<string, unknown>): { tab?: SavedTab } =>
    savedTabs.includes(search.tab as SavedTab) && search.tab !== "later" ? { tab: search.tab as SavedTab } : {},
  component: SavedPage,
});
