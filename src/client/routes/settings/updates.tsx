import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { UpdatesPage } from "../../sections/settings/system/UpdatesPage";

export const Route = createFileRoute("/settings/updates")({
  beforeLoad: requireAdministrator,
  component: UpdatesPage,
});
