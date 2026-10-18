import { useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, useSessionGate } from "@/session/session-context";

/** Local capture remains visible and stoppable while browsing, controlling another device or in the player. */
export function LiveSharingStatus({ className, header = false }: { className?: string; header?: boolean }) {
  const { state, endLive, localLiveSourceId, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const source = state?.liveSources?.find(item => item.id === localLiveSourceId);
  if (!source) return null;
  // No background of its own: the header has one, and the player's top band shades a picture with its scrim.
  return <div data-live-sharing className={cn("flex shrink-0 items-center gap-1 text-sm whitespace-nowrap", className)}>
    <span role="status" className={cn("text-muted-foreground max-sm:sr-only", header && "max-xl:sr-only")}>Sharing {source.kind === "system-audio" ? "system audio" : source.kind === "screen" ? "screen" : "microphone"}</span>
    {/* Below 24rem, the labeled stop button, 11rem search and Couch switch cannot fit on one row. */}
    <Button variant="ghost" size="sm" className={header ? "max-[24rem]:size-11" : undefined} disabled={pending} onClick={async () => {
      if (pending) return;
      setPending(true);
      try { await endLive(); } catch (reason) { setError(errorText(reason)); }
      finally { setPending(false); }
    }}><Square aria-hidden="true" /><span className={header ? "max-[24rem]:sr-only" : undefined}>{pending ? "Stopping…" : "Stop sharing"}</span></Button>
  </div>;
}
