import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { DisplayPage } from "../../sections/settings/device/DisplayPage";

export const Route = createFileRoute("/settings/display")({
  beforeLoad: requireAdministrator,
  component: DisplayPage,
});
