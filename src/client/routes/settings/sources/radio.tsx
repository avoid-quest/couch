import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../../shared/settings-pages";

// /settings/sources/radio comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/sources/radio")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sources/radio")!} />,
});
