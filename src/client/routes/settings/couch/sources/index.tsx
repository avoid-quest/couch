import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "../../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/sources/")({ component: () => <SourcesPage section="sources" /> });
