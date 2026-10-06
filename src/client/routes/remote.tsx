import { createFileRoute } from "@tanstack/react-router";
import { RemotePage } from "../sections/remote/RemotePage";
export const Route = createFileRoute("/remote")({ component: RemotePage });
