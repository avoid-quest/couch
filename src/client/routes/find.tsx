import { createFileRoute } from "@tanstack/react-router";
import { FindPage } from "../sections/find/FindPage";

export const Route = createFileRoute("/find")({ component: FindPage });
