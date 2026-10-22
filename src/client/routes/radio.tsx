import { createFileRoute } from "@tanstack/react-router";
import { RadioPage } from "../sections/home/RadioPage";

export const Route = createFileRoute("/radio")({ component: RadioPage });
