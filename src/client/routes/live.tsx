import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "../sections/live/LivePage";

export const Route = createFileRoute("/live")({ component: LivePage });
