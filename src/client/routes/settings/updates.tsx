import { createFileRoute } from "@tanstack/react-router";
import { UpdatesPage } from "../../sections/settings/system/UpdatesPage";

export const Route = createFileRoute("/settings/updates")({ component: UpdatesPage });
