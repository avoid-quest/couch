import { createFileRoute } from "@tanstack/react-router";
import { CouchGeneralPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/general")({ component: CouchGeneralPage });
