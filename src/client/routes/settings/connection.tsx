import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { ConnectionsPage } from "../../sections/settings/device/ConnectionsPage";

// /settings/connection comes from settings-pages, the single path truth.
export const Route = createFileRoute("/settings/connection")({
  beforeLoad: requireAdministrator,
  component: ConnectionsPage,
});
