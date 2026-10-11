import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsPagePath } from "../../../shared/settings-pages";

export const Route = createFileRoute("/settings/")({
  beforeLoad: () => { throw redirect({ href: settingsPagePath("general") }); },
});
