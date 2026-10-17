import { useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, useSessionGate } from "@/session/session-context";

/** Local capture remains visible and stoppable while browsing, controlling another device or in the player. */
export function LiveSharingStatus({ className }: { className?: string }) {
  const { state, endLive, localLiveSourceId, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const source = state?.liveSources?.find(item => item.id === localLiveSourceId);
  if (!source) return null;
  // No background of its own: the header has one, and the player's top band shades a picture with its scrim.
  return <div data-live-sharing className={cn("flex shrink-0 items-center gap-1 text-sm", className)}>
    <span role="status" className="text-muted-foreground max-sm:sr-only">Sharing {source.kind === "system-audio" ? "system audio" : source.kind === "screen" ? "screen" : "microphone"}</span>
    <Button variant="ghost" size="sm" disabled={pending} onClick={async () => {
      if (pending) return;
      setPending(true);
      try { await endLive(); } catch (reason) { setError(errorText(reason)); }
      finally { setPending(false); }
    }}><Square aria-hidden="true" />{pending ? "Stopping…" : "Stop sharing"}</Button>
  </div>;
}
