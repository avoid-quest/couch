import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../../shared/settings-pages";

// /settings/sources/live-tv comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/sources/live-tv")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sources/live-tv")!} />,
});
