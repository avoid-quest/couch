import { createFileRoute } from "@tanstack/react-router";
import { TvAppearancePage } from "../../sections/settings/device/TvAppearancePage";

export const Route = createFileRoute("/settings/tv-appearance")({ component: TvAppearancePage });
