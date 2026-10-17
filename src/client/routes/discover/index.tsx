import { createFileRoute } from "@tanstack/react-router";
import { DiscoverPage } from "../../sections/discover/DiscoverPage";

export const Route = createFileRoute("/discover/")({ component: DiscoverPage });
