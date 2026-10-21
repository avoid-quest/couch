import { createFileRoute } from "@tanstack/react-router";
import { PlaybackPage } from "../../../sections/settings/CouchPages";

export const Route = createFileRoute("/settings/couch/playback")({ component: PlaybackPage });
