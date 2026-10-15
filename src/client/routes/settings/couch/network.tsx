import { createFileRoute } from "@tanstack/react-router";
import { NetworkPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/network")({ component: NetworkPage });
