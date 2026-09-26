import { createFileRoute } from "@tanstack/react-router";
import { SettingsHome } from "../../sections/settings/device/SettingsHome";

export const Route = createFileRoute("/settings/home")({ component: SettingsHome });
