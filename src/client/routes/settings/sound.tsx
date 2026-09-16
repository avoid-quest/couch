import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/sound comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/sound")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sound")!} />,
});
