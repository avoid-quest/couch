import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { BluetoothPage } from "../../sections/settings/device/BluetoothPage";

export const Route = createFileRoute("/settings/bluetooth")({
  beforeLoad: requireAdministrator,
  component: BluetoothPage,
});
