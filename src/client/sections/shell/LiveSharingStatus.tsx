import { useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorText, useSessionGate } from "@/session/session-context";

/** Local capture remains visible and stoppable while browsing or controlling another device. */
export function LiveSharingStatus() {
  const { state, endLive, localLiveSourceId, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const source = state?.liveSources?.find(item => item.id === localLiveSourceId);
  if (!source) return null;
  return <div data-live-sharing className="flex shrink-0 items-center gap-1 bg-background text-sm">
    <span role="status" className="text-muted-foreground max-sm:sr-only">Sharing {source.kind === "system-audio" ? "system audio" : source.kind === "screen" ? "screen" : "microphone"}</span>
    <Button variant="ghost" size="sm" disabled={pending} onClick={async () => {
      if (pending) return;
      setPending(true);
      try { await endLive(); } catch (reason) { setError(errorText(reason)); }
      finally { setPending(false); }
    }}><Square aria-hidden="true" />{pending ? "Stopping…" : "Stop sharing"}</Button>
  </div>;
}
