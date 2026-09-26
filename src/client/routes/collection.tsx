import { createFileRoute } from "@tanstack/react-router";
import { ProviderPage } from "../sections/find/ProviderPage";

export const Route = createFileRoute("/collection")({ component: ProviderPage });
