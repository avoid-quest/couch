import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/home")({ component: HomePage });
