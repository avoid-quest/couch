import { useContext, useRef, useSyncExternalStore, type ReactNode } from "react";
import { SlidersVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toolPanel } from "@/components/PlaybackTransport";
import { isTvPresentation } from "@/session/presentation";
import type { ClientSessionState } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { Deck } from "./Deck";
import { useWhereOpen, WhereList } from "./Desk";
import { RoomStyle } from "./shell-context";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

// A mouse wider than a phone (Settings' own 48rem): there, as on the TV, a panel hangs from its button; a phone's
// rises from the bottom.
const desktopQuery = "(min-width: 48rem) and (pointer: fine)";
export const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
export const isDesktop = () => window.matchMedia(desktopQuery).matches;

/**
 * Where it plays from a control outside the side player's desk (the full player's band, the capsule, the phone's
 * dock): the same list. On desktops and the TV it rises from its control at that control's edge, over the picture,
 * the band keeping its own transport; on a phone it is a Sheet that is the whole desk, Volume and transport included.
 */
export function WhereItPlays({
  state,
  connected,
  run,
  className,
  label,
  children,
}: Props & {
  className?: string;
  label?: string;
  /** The trigger's own content, in place of its icon. */
  children?: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const tv = isTvPresentation();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const [open, setOpen] = useWhereOpen(state);
  const lit = useContext(RoomStyle);
  const trigger = (
    <Button
      ref={button}
      variant="ghost"
      size={label || children ? "default" : "icon-lg"}
      className={className}
      disabled={!state.playback}
      aria-label={children ? undefined : "Where it plays"}
      title="Where it plays"
    >
      {children ?? (
        <>
          <SlidersVertical aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  );
  const list = (
    <WhereList state={state} connected={connected} run={run} open fixed onOpen={setOpen} />
  );
  if (tv || desktop)
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {open && (
          <PopoverContent
            {...toolPanel(button.current)}
            aria-label="Where it plays"
            style={lit}
            className="desk lit-panel max-h-[min(44rem,calc(var(--radix-popover-content-available-height)-1rem))] w-(--side-player-width) gap-0 overflow-hidden px-3.5 pt-1.5 pb-2"
          >
            <div className="flex min-h-0 flex-1 flex-col">{list}</div>
          </PopoverContent>
        )}
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        showCloseButton={false}
        style={lit}
        className="now-playing max-h-[92dvh] gap-0 overflow-hidden px-4 pt-4 pb-3"
      >
        <SheetTitle className="sr-only">Where it plays</SheetTitle>
        <div className="flex min-h-0 flex-col">
          {list}
          <Deck state={state} connected={connected} run={run} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
