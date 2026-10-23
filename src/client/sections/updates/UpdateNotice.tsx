import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { useUpdateCenter } from "@/session/update-center";
import { StatusLine } from "@/sections/shell/StatusLine";
import { UpdateReviewDialog } from "./UpdateReview";
import { updateInterrupts, updateNoticeKey, updateReady } from "./update-presentation";

export function UpdateNotice() {
  const { targets, batch, busy, clearBatch } = useUpdateCenter();
  const { identity, credentials, details, state, tvPresentation } = useSessionGate();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    changed(); document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const viewer = identity?.device?.id ?? deviceId();
  const installation = credentials?.installationId ?? details?.installationId ?? credentials?.origin ?? "local";
  const notices = targets.filter(target => updateReady(target.state)).map(target => updateNoticeKey(viewer, installation, target.id, target.state!.available!));
  const unread = notices.filter(key => {
    if (dismissed.includes(key)) return false;
    try { return localStorage.getItem(key) !== "later"; } catch { return true; }
  });
  if (fullscreen || tvPresentation && updateInterrupts(state, ["app"], viewer) || !unread.length && !busy && !batch) return null;
  const later = () => {
    for (const key of notices) { try { localStorage.setItem(key, "later"); } catch { /* Keep the choice for this tab. */ } }
    setDismissed(previous => [...previous, ...notices]);
  };
  const count = notices.length;
  const failed = batch?.items.filter(item => item.status === "failed").length ?? 0;
  const progress = batch?.items.length ? `${batch.items.filter(item => item.status === "updated").length} of ${batch.items.length} devices updated` : busy ? "Updating media tools…" : "Media tools checked.";
  return <StatusLine busy={busy} actions={<>
    <UpdateReviewDialog><Button variant="ghost" size="sm">{busy ? "View progress" : batch ? "View results" : "Review update"}</Button></UpdateReviewDialog>
    {!busy && (batch ? <Button variant="ghost" size="sm" onClick={clearBatch}>Dismiss results</Button> : <Button variant="ghost" size="sm" onClick={later}>Later</Button>)}
  </>}>
    {batch ? failed ? `${failed} ${failed === 1 ? "device couldn’t" : "devices couldn’t"} update.` : batch.helpers === "failed" ? "Media tools couldn’t update." : progress
      : `Couch has an update for ${count} ${count === 1 ? "device" : "devices"}.`}
  </StatusLine>;
}
