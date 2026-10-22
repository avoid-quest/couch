import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsIndex } from "../../sections/settings/SettingsNav";
import { settingsPagePath } from "../../../shared/settings-pages";

// Wide screens and the TV open on General beside the rail; below md, Settings lists its pages by owner.
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => { if (matchMedia("(width >= 48rem)").matches) throw redirect({ href: settingsPagePath("device"), replace: true }); },
  component: SettingsIndex,
});
