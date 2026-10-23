import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { useUpdateCenter } from "@/session/update-center";
import { updateInterrupts, updateReady } from "./update-presentation";

/** One route to updates; completed work never occupies the header. */
export function UpdateCue() {
  const { targets, batch, busy, canMaintain, checkFailed } = useUpdateCenter();
  const { state, tvPresentation } = useSessionGate();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    changed(); document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const ready = targets.filter(target => updateReady(target.state)).length;
  const downloading = targets.some(target => target.state?.status === "downloading");
  const failed = checkFailed || batch?.helpers === "failed" || batch?.items.some(item => item.status === "failed");
  if (!canMaintain && !targets.length || fullscreen || tvPresentation && updateInterrupts(state, ["app"], deviceId()) || !ready && !busy && !downloading && !failed) return null;
  const label = busy ? batch?.items.length && !["waiting", "checking"].includes(batch.helpers)
    ? `Updating ${Math.min(batch.items.filter(item => item.status === "updated").length + 1, batch.items.length)} of ${batch.items.length}` : "Updating media tools"
    : ready ? ready === 1 ? "Update ready" : `${ready} updates ready` : failed ? "Update failed" : "Downloading update";
  return <Button variant="ghost" asChild className={cn("touch:size-11 touch:p-0 tv:w-auto tv:px-3.5", failed && !ready && !busy && "text-destructive")}>
    <Link to={canMaintain ? "/settings/couch/updates" : "/settings/device/updates"} aria-label={label} title={label} data-update-cue>
      {busy ? <Spinner role="presentation" aria-hidden="true" aria-label={undefined} /> : ready ? <CircleArrowUp aria-hidden="true" /> : failed ? <CircleAlert aria-hidden="true" /> : <Spinner role="presentation" aria-hidden="true" aria-label={undefined} />}
      <span className="touch:sr-only tv:not-sr-only">{label}</span>
    </Link>
  </Button>;
}
