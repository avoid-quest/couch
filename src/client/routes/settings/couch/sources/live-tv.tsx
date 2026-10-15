import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "../../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/sources/live-tv")({ component: () => <SourcesPage section="source-iptv" /> });
