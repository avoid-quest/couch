import { createFileRoute } from "@tanstack/react-router";
import { GeneralPage } from "../../sections/settings/system/GeneralPage";

export const Route = createFileRoute("/settings/tv")({ component: GeneralPage });
