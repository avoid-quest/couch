import { createFileRoute } from "@tanstack/react-router";
import { CouchUpdatesPage } from "../../../sections/settings/app/UpdatesPage";

export const Route = createFileRoute("/settings/couch/updates")({ component: CouchUpdatesPage });
