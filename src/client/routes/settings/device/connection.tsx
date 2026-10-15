import { createFileRoute } from "@tanstack/react-router";
import { ConnectionPage } from "../../../sections/settings/ThisDevicePages";

export const Route = createFileRoute("/settings/device/connection")({ component: ConnectionPage });
