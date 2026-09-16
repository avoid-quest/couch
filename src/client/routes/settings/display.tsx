import { createFileRoute } from "@tanstack/react-router";
import { DisplayPage } from "../../sections/settings/device/DisplayPage";

export const Route = createFileRoute("/settings/display")({ component: DisplayPage });
