import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsAliases, settingsPagePath } from "../../../shared/settings-pages";
import { updatesPage } from "../../sections/updates/update-presentation";

// Earlier Settings addresses open the page that now holds them; anything else opens Settings.
export const Route = createFileRoute("/settings/$")({
  beforeLoad: ({ location, context }) => {
    const page = settingsAliases[location.pathname.replace(/\/$/, "")] ?? null;
    // Updates opens the viewer's one Updates page, which moves again if the role turns out otherwise.
    // Full mode hosts before this app's identity arrives.
    const authority = context?.identity?.authority;
    const administrator = authority ? authority === "host" || authority === "administrator" : !!context?.localHost;
    throw redirect({ href: settingsPagePath(page === "updates" ? updatesPage(administrator) ?? page : page ?? "device"), replace: true });
  },
});
