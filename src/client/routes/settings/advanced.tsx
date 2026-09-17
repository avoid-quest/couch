import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { AdvancedPage } from "../../sections/settings/system/AdvancedPage";

export const Route = createFileRoute("/settings/advanced")({
  beforeLoad: requireAdministrator, component: AdvancedPage });
