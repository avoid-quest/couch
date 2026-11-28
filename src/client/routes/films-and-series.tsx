import { createFileRoute } from "@tanstack/react-router";
import { KindRoom } from "../sections/find/SourceRooms";

export const Route = createFileRoute("/films-and-series")({
  component: () => <KindRoom kind="films" />,
});
