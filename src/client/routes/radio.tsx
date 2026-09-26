import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/radio")({
  beforeLoad: () => { throw redirect({ href: "/find?browse=radio" }); },
});
