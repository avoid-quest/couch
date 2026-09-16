import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/advanced comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/advanced")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/advanced")!} />,
});
