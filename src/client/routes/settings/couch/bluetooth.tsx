import { createFileRoute } from "@tanstack/react-router";
import { BluetoothPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/bluetooth")({ component: BluetoothPage });
