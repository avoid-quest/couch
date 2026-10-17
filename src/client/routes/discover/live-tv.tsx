import { createFileRoute } from "@tanstack/react-router";
import { LiveTvPage } from "../../sections/discover/LiveTvPage";

export const Route = createFileRoute("/discover/live-tv")({ component: LiveTvPage });
