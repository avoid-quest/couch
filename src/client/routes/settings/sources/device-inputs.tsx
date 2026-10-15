import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../sections/settings/SettingsPage";
import { settingsPageForPath } from "../../../../shared/settings-pages";

export const Route = createFileRoute("/settings/sources/device-inputs")({
  component: () => <SettingsPage section={settingsPageForPath("/settings/sources/device-inputs")!} />,
});
