import { createFileRoute } from "@tanstack/react-router";
import { DisplayPage } from "../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/display")({ component: DisplayPage });
