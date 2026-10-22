import { createFileRoute } from "@tanstack/react-router";
import { ThisDevicePage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/")({ component: ThisDevicePage });
