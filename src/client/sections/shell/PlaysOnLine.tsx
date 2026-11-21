import { useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { MediaArtwork } from "@/components/MediaArtwork";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { deviceId, playsOn } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import type { PlaybackSummary } from "../../../shared/protocol";
import { isDesktop, subscribeDesktop } from "./Outputs";
import { useShell } from "./shell-context";

type Destination = NonNullable<ReturnType<typeof playsOn>>;

function destination(at: Destination) {
  if (!at.elsewhere) return "This device";
  return `on ${at.name}${at.more ? ` +${at.more}` : ""}`;
}

function PlaybackPicker({
  playbacks,
  children,
}: {
  playbacks: PlaybackSummary[];
  children: ReactNode;
}) {
  const { state, connected, tvPresentation } = useSessionGate();
  const { selectPlayback } = useShell();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const trigger = (
    <button
      type="button"
      disabled={!connected}
      className="flex min-w-0 max-w-full shrink-0 items-center gap-1 rounded-full px-1 font-medium text-foreground hover:bg-accent"
    >
      {children}
      <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
    </button>
  );
  const content = (playback: PlaybackSummary) => {
    const at = playsOn({
      outputs: playback.outputs,
      devices: state?.devices,
      controlling: state?.controlling,
      player: { status: playback.status },
    });
    return (
      <>
        <MediaArtwork
          thumbnail={playback.thumbnail}
          title={playback.title ?? ""}
          className="h-10 w-auto max-w-20 shrink-0 rounded-sm aspect-square object-contain [&:is(img)]:aspect-auto"
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium [overflow-wrap:anywhere]">{playback.title}</span>
          {at && <span className="text-meta text-muted-foreground">{destination(at)}</span>}
        </span>
      </>
    );
  };
  if (desktop && !tvPresentation)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuRadioGroup value={state?.playback ?? ""} onValueChange={selectPlayback}>
            {playbacks.map((playback) => (
              <DropdownMenuRadioItem
                key={playback.id}
                value={playback.id}
                textValue={playback.title ?? ""}
              >
                {content(playback)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="max-h-[85dvh] overflow-y-auto px-(--gutter) py-4"
      >
        <div className="mx-auto grid w-full max-w-3xl gap-1">
          <SheetTitle className="mb-2 pr-11">Choose what you control</SheetTitle>
          {playbacks.map((playback) => (
            <SheetClose asChild key={playback.id}>
              <Button
                variant="ghost"
                aria-pressed={playback.id === state?.playback}
                className="h-auto justify-start gap-3 rounded-md px-2 py-2 text-left whitespace-normal"
                onClick={() => void selectPlayback(playback.id)}
              >
                {content(playback)}
                {playback.id === state?.playback && <Check aria-hidden="true" />}
              </Button>
            </SheetClose>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Where it comes from, then where it plays; in the bar the context gives way first. */
export function PlaysOnLine({
  at,
  children,
  compact = false,
  overPicture = false,
}: {
  at: ReturnType<typeof playsOn>;
  children?: ReactNode;
  compact?: boolean;
  overPicture?: boolean;
}) {
  const { state } = useSessionGate();
  const choices =
    state?.playbacks?.filter((playback) => playback.running && !playback.private) ?? [];
  // Also when the controlled Playback stopped running (it can't play), so a running one stays in reach.
  const canPick = choices.some((playback) => playback.id !== state?.playback);
  // The same elements with or without where it plays, so a focused link survives another device joining.
  const shown = !!at && (canPick || (at.elsewhere && !overPicture));
  const label = at && (
    <>
      <span className="truncate">
        on {at.deviceId === deviceId() && !at.more ? "This device" : at.name}
      </span>
      {!!at.more && <span className="shrink-0">+{at.more}</span>}
    </>
  );
  return (
    <div
      className={
        !shown
          ? "contents"
          : compact
            ? "flex min-w-0 items-center gap-x-2"
            : "flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm"
      }
    >
      <div
        className={
          shown && compact
            ? "flex min-w-0 items-center gap-x-2 overflow-x-clip empty:hidden"
            : "contents"
        }
      >
        {children}
      </div>
      {shown &&
        (canPick ? (
          <PlaybackPicker playbacks={choices}>{label}</PlaybackPicker>
        ) : (
          <span className="flex min-w-0 max-w-full shrink-0 gap-1 font-medium text-foreground">
            {label}
          </span>
        ))}
    </div>
  );
}
