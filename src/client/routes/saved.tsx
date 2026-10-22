import { createFileRoute } from "@tanstack/react-router";
import { SavedPage } from "../sections/saved/SavedPage";
import { savedTabs, type SavedTab } from "../sections/saved/SavedSections";

// The open tab lives in the URL, so Back and the player return to it; without one, Saved opens the first that holds something.
export const Route = createFileRoute("/saved")({
  validateSearch: (search: Record<string, unknown>): { tab?: SavedTab } =>
    savedTabs.includes(search.tab as SavedTab) ? { tab: search.tab as SavedTab } : {},
  component: SavedPage,
});
