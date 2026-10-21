import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsAliases, settingsPagePath } from "../../../shared/settings-pages";

// Earlier Settings addresses open the page that now holds them; anything else opens Settings.
export const Route = createFileRoute("/settings/$")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: settingsPagePath(settingsAliases[location.pathname.replace(/\/$/, "")] ?? "device"), replace: true });
  },
});
