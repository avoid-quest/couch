import { useState } from "react";
import { Headphones, Radio, ScreenShare, Square, Users, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { errorText, useSessionGate } from "@/session/session-context";
import { ShareButton } from "./ShareDialog";
import { viewersOf } from "./share";
import { showShare, useShareView } from "./share-view";
import { useShowShare } from "./show-share";
import { liveTitle } from "../../../shared/live-input";

/**
 * The header's Share (docs/live-inputs.md): a button that opens the Share panel on a device that can capture, and,
 * while this device shares, the same spot as its pill on every screen: "Sharing, 2" or "Live, 10", hollow while nobody
 * receives it, with Stop sharing. Pressing it shows the share in the player. Both stay this device's own: another
 * device's Remote never reaches them on a TV. Settings can hide the button (a TV does by default), never the pill.
 */
export function ShareControl() {
  const { localLiveSourceId, tvPresentation } = useSessionGate();
  const { shown } = useShowShare();
  // Share again opens the panel even where the header hides Share.
  const { ask } = useShareView();
  return (
    <div className="app-header-share-entry flex min-w-11 justify-end">
      {localLiveSourceId ? (
        <SharingPill />
      ) : (
        (shown || ask) &&
        !!navigator.mediaDevices?.getUserMedia && (
          <ShareButton header className="size-11 px-0" tv={tvPresentation}>
            <ScreenShare aria-hidden="true" />
          </ShareButton>
        )
      )}
    </div>
  );
}

/**
 * The share as a fact in the header, the full player's band and the full share: what it is, how many get it, and Stop
 * sharing, one press from anywhere. Nobody receiving it is said here, not in a message: "Still sharing, on no screens".
 */
export function SharingPill({ className }: { className?: string }) {
  const { state, localLiveSourceId } = useSessionGate();
  const stop = useStop();
  const source = state?.liveSources?.find((item) => item.id === localLiveSourceId);
  if (!source) return null;
  const viewers = viewersOf(state, source.id);
  const live = source.intent === "live";
  const none = !viewers.length;
  const label = none
    ? live
      ? "Still live, with no listeners"
      : `Still sharing, on no ${source.video ? "screens" : "speakers"}`
    : live
      ? "Live"
      : "Sharing";
  const Icon = live ? Radio : source.video ? ScreenShare : Volume2;
  const Count = live || !source.video ? Headphones : Users;
  const counted = `${viewers.length} ${live ? "listening" : source.video ? "watching" : "listening"}`;
  return (
    <div
      data-live-sharing
      data-tv-local-only
      data-receivers={viewers.length}
      className={cn(
        "flex h-10 max-w-full min-w-0 shrink items-center rounded-full p-0.5 text-sm font-medium",
        none
          ? "text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)]"
          : "bg-foreground text-background",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`${label}: ${liveTitle(source)}, ${counted}. Show it in the player`}
        title={`${liveTitle(source)}: show it in the player`}
        onClick={() => showShare(true)}
        className="flex h-9 min-w-0 items-center gap-2 rounded-full pr-2.5 pl-3 outline-none hover:bg-current/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span role="status" className="min-w-0 truncate">
          {label}
        </span>
        {!none && (
          <span className="flex shrink-0 items-center gap-1 border-l border-current/25 pl-2 tabular-nums">
            <Count aria-hidden="true" className="size-3.5" />
            {viewers.length}
          </span>
        )}
      </button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-9 rounded-full px-3 text-inherit hover:bg-current/10 hover:text-inherit",
          !none && "bg-background/15",
        )}
        aria-label={stop.pending ? "Stopping…" : "Stop sharing"}
        title="Stop sharing"
        disabled={stop.pending}
        onClick={() => void stop.run()}
      >
        <Square aria-hidden="true" className="fill-current" />
        <span className="max-sm:sr-only">{stop.pending ? "Stopping…" : "Stop"}</span>
      </Button>
    </div>
  );
}

export function useStop() {
  const { endLive, setError } = useSessionGate();
  const [pending, setPending] = useState(false);
  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      await endLive();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}
