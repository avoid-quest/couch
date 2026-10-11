import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../../shared/settings-pages";

// /settings/sources comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/sources/")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sources")!} />,
});
