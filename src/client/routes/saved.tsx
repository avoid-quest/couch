import { createFileRoute } from "@tanstack/react-router";
import { SavedPage } from "../sections/saved/SavedPage";

export const Route = createFileRoute("/saved")({ component: SavedPage });
