import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/tv comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/tv")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/tv")!} />,
});
