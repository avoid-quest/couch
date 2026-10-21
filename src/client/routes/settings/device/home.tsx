import { createFileRoute } from "@tanstack/react-router";
import { HomeDiscoverPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/home")({ component: HomeDiscoverPage });
