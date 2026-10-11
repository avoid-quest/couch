import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { TvAppearancePage } from "../../sections/settings/device/TvAppearancePage";

export const Route = createFileRoute("/settings/tv-appearance")({
  beforeLoad: requireAdministrator,
  component: TvAppearancePage,
});
