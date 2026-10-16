import { createFileRoute } from "@tanstack/react-router";
import { SearchPage } from "../sections/find/SearchPage";

export const Route = createFileRoute("/search")({ component: SearchPage });
