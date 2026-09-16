import { createFileRoute } from "@tanstack/react-router";
import { RadioPage } from "../sections/music-radio/RadioPage";

export const Route = createFileRoute("/radio")({ component: RadioPage });
