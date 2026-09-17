import { createFileRoute } from "@tanstack/react-router";
import { requireAdministrator } from "./-administrator";
import { SoundPage } from "../../sections/settings/device/SoundPage";

export const Route = createFileRoute("/settings/sound")({
  beforeLoad: requireAdministrator,
  component: SoundPage,
});
