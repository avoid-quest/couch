import { createFileRoute, redirect } from "@tanstack/react-router";

// Discover folded into Home.
export const Route = createFileRoute("/discover/")({ beforeLoad: () => { throw redirect({ href: "/", replace: true }); } });
