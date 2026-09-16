import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyPaths } from "../../../shared/page-paths";

// Old links keep working: sources became filters, the queue moved onto Now.
export const Route = createFileRoute("/browse/library")({
  beforeLoad: ({ location }) => { throw redirect({ href: `${legacyPaths["/browse/library"]}${location.searchStr}` }); },
});
