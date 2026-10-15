import { createFileRoute } from "@tanstack/react-router";
import { GeneralPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/general")({ component: GeneralPage });
