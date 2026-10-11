import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsPage } from "../../sections/settings/device/ConnectionsPage";

// /settings/connection comes from settings-pages, the single path truth.
// Every Device sees the Devices page; admin actions stay admin-only.
export const Route = createFileRoute("/settings/connection")({
  component: ConnectionsPage,
});
