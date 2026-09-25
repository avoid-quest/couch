import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/music")({
  beforeLoad: () => { throw redirect({ href: "/find?browse=music" }); },
});
