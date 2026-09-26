import { createFileRoute } from "@tanstack/react-router";
import { NowPage } from "../sections/now/NowPage";

export const Route = createFileRoute("/now")({ component: NowPage });
