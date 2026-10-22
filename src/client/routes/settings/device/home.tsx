import { createFileRoute } from "@tanstack/react-router";
import { HomeSettingsPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/home")({ component: HomeSettingsPage });
