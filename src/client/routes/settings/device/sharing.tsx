import { createFileRoute } from "@tanstack/react-router";
import { SharingPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/sharing")({ component: SharingPage });
