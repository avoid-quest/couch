import { createFileRoute } from "@tanstack/react-router";
import { AdvancedPage } from "../../sections/settings/system/AdvancedPage";

export const Route = createFileRoute("/settings/advanced")({ component: AdvancedPage });
