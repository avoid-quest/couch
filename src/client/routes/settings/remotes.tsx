import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsPageForPath, settingsPagePath } from "../../../shared/settings-pages";

// Old remotes page: connection settings absorbed it.
export const Route = createFileRoute("/settings/remotes")({
  beforeLoad: ({ location }) => {
    const page = settingsPageForPath(location.pathname);
    throw redirect({ href: settingsPagePath(page) });
  },
});
