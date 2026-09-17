import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { SettingsPage } from "../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../shared/settings-pages";

// /settings/connection comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/connection")({
  beforeLoad: requireAdministrator,
  component: () => <SettingsPage section={settingsPageForPath("/settings/connection")!} />,
});
