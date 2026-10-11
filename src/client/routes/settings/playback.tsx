import { createFileRoute } from "@tanstack/react-router";
import { PlaybackPage } from "../../sections/settings/device/PlaybackPage";

export const Route = createFileRoute("/settings/playback")({ component: PlaybackPage });
