import { createFileRoute } from "@tanstack/react-router";
import { KindRoom } from "../sections/find/SourceRooms";

export const Route = createFileRoute("/anime")({ component: () => <KindRoom kind="anime" /> });
