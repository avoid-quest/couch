import { createFileRoute } from "@tanstack/react-router";
import { DiscoverPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/discover")({ component: DiscoverPage });
