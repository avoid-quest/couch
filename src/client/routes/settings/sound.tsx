import { createFileRoute } from "@tanstack/react-router";
import { SoundPage } from "../../sections/settings/device/SoundPage";

export const Route = createFileRoute("/settings/sound")({ component: SoundPage });
