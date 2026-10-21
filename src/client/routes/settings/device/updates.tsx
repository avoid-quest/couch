import { createFileRoute } from "@tanstack/react-router";
import { DeviceUpdatesPage } from "../../../sections/settings/app/UpdatesPage";

export const Route = createFileRoute("/settings/device/updates")({ component: DeviceUpdatesPage });
