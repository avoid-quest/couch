import { createFileRoute } from "@tanstack/react-router";
import { UpdatesPage } from "../../sections/settings/app/UpdatesPage";

export const Route = createFileRoute("/settings/updates")({ component: UpdatesPage });
