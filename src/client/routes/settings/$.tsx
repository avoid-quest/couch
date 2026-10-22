import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsAliases, settingsPagePath } from "../../../shared/settings-pages";
import { couchApp } from "../../session/native-context";

// Earlier Settings addresses open the page that now holds them; anything else opens Settings.
export const Route = createFileRoute("/settings/$")({
  beforeLoad: ({ location, context }) => {
    const page = settingsAliases[location.pathname.replace(/\/$/, "")] ?? null;
    // Updates used to open on this app's own updater, which the Couch's page shows when this app hosts it.
    // Full mode hosts before this app's identity arrives.
    const host = context?.identity ? context.identity.authority === "host" : context?.localHost;
    throw redirect({ href: settingsPagePath(page === "updates" && couchApp?.updates && !host ? "device-updates" : page ?? "device"), replace: true });
  },
});
