import { createFileRoute } from "@tanstack/react-router";
import { ApproveTv } from "../../sections/shell/ApproveTv";

// A TV's pairing QR opens this on a paired phone (TvPairing).
export const Route = createFileRoute("/pair/tv")({ component: ApproveTv });
