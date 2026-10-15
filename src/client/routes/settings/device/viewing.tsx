import { createFileRoute } from "@tanstack/react-router";
import { ViewingPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/viewing")({ component: ViewingPage });
