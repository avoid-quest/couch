import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsAliases, settingsPagePath } from "../../../shared/settings-pages";
import { couchApp } from "../../session/native-context";

// Earlier Settings addresses open the page that now holds them; anything else opens Settings.
export const Route = createFileRoute("/settings/$")({
  beforeLoad: ({ location, context }) => {
    const page = settingsAliases[location.pathname.replace(/\/$/, "")] ?? null;
    // Updates used to open on this app's own updater, which the Couch's page shows when this app hosts it.
    const updates = page === "updates" && couchApp?.updates && context.identity?.authority !== "host" ? "device-updates" : page;
    throw redirect({ href: settingsPagePath(updates ?? "general"), replace: true });
  },
});
