import { useState } from "react";
import { Radio, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { errorText, useSessionGate } from "@/session/session-context";

/** In the player's top band, local capture stays visible and stoppable; the header has its capsule (sections/share). */
export function LiveSharingStatus({ className }: { className?: string }) {
  const { state, endLive, localLiveSourceId, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const source = state?.liveSources?.find(item => item.id === localLiveSourceId);
  if (!source) return null;
  const status = `Sharing ${source.kind === "system-audio" ? "system audio" : source.kind === "screen" ? "screen" : "microphone"}`;
  const stop = (className?: string) => <Button variant="ghost" size="sm" className={className} disabled={pending} onClick={async () => {
    if (pending) return;
    setPending(true);
    try { await endLive(); setOpen(false); } catch (reason) { setError(errorText(reason)); }
    finally { setPending(false); }
  }}><Square aria-hidden="true" />{pending ? "Stopping…" : "Stop sharing"}</Button>;
  // No background of its own: the header has one, and the player's top band shades a picture with its scrim.
  return <div data-live-sharing data-tv-local-only className={cn("flex shrink-0 items-center gap-1 text-sm whitespace-nowrap", className)}>
    <span role="status" className="text-muted-foreground max-sm:sr-only">{status}</span>
    {stop("max-sm:hidden")}
    {/* On a phone the status is one icon: hover reads its title, and a press (touch has no hover) opens the status with
        Stop sharing as its action, so a stray tap beside the search never ends sharing for every receiver. */}
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="sm:hidden" aria-label={`${status} · Show sharing controls`} title={`${status} · Show sharing controls`}><Radio aria-hidden="true" /></Button>
      </PopoverTrigger>
      <PopoverContent data-tv-local-only align="end" collisionPadding={16} className="w-auto flex-row items-center gap-3 py-1.5 pr-1.5"><span className="text-muted-foreground">{status}</span>{stop()}</PopoverContent>
    </Popover>
  </div>;
}
