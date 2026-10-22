import { createFileRoute } from "@tanstack/react-router";
import { LiveTvPage } from "../sections/home/LiveTvPage";

export const Route = createFileRoute("/live-tv")({ component: LiveTvPage });
