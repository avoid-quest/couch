import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyPaths } from "../../shared/page-paths";

// Old links keep working: sources became filters, the queue moved onto Home.
export const Route = createFileRoute("/up-next")({
  beforeLoad: ({ location }) => { throw redirect({ href: `${legacyPaths["/up-next"]}${location.searchStr}` }); },
});
