import { createFileRoute } from "@tanstack/react-router";
import { MusicPage } from "../sections/music-radio/MusicPage";

export const Route = createFileRoute("/music")({ component: MusicPage });
