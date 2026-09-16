import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/updates comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/updates")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/updates")!} />,
});
