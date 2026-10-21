import { createFileRoute } from "@tanstack/react-router";
import { DevicesPage } from "../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/devices")({ component: DevicesPage });
