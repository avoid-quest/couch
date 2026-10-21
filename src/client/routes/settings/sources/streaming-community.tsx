import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/sources/streaming-community")({ component: () => <SourcesPage section="source-streaming-community" /> });
