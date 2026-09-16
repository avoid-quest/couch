import { createFileRoute } from "@tanstack/react-router";
import { BluetoothPage } from "../../sections/settings/device/BluetoothPage";

export const Route = createFileRoute("/settings/bluetooth")({ component: BluetoothPage });
