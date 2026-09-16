import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../../shared/settings-pages";

// /settings/sources/jellyfin comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/sources/jellyfin")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sources/jellyfin")!} />,
});
