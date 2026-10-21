import { createFileRoute } from "@tanstack/react-router";
import { SoundPage } from "../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/sound")({ component: SoundPage });
