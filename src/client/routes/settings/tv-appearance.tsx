import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/tv-appearance comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/tv-appearance")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/tv-appearance")!} />,
});
