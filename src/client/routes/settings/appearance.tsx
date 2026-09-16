import { createFileRoute } from "@tanstack/react-router";
import { AppearancePage } from "../../sections/settings/device/AppearancePage";

export const Route = createFileRoute("/settings/appearance")({ component: AppearancePage });
