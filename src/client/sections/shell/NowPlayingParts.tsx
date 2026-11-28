import { useRef, useState } from "react";
import { Monitor, SlidersVertical, Volume2 } from "lucide-react";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import type { ClientSessionState } from "@/session/session";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaArtwork } from "@/components/MediaArtwork";
import { playbackCapabilities, toolPanel } from "@/components/PlaybackTransport";
import { hasUpNext, QueuePanel } from "@/sections/now/QueuePanel";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { formatDuration } from "@/time-format";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { PlaybackPicker, playbackChoices } from "./PlaysOnLine";
import { WhereItPlays } from "./Outputs";
import { useUncut } from "./uncut";
import type { Action } from "../../../shared/protocol";
import { upcomingQueue } from "../../../shared/queue";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

/** Where it plays, said as what each device gives: its picture, its sound, its name. */
export function WhereTokens({ state, compact }: { state: ClientSessionState; compact: boolean }) {
  const icon = compact ? "size-3" : "size-3.5";
  if (livePlayback(state)) {
    const joined = playbackControls(state).leave;
    return (
      <span className={cn("inline-flex items-center gap-1.5", !compact && "text-sm font-medium")}>
        {joined && <Volume2 aria-hidden="true" className={cn(icon, "text-muted-foreground")} />}
        {joined ? "Your sound, on This device" : "Not joined"}
      </span>
    );
  }
  const outputs = state.outputs ?? [];
  const ids = [...new Set(outputs.map((output) => output.deviceId))];
  if (!ids.length) return <span className="text-muted-foreground">Not on any device</span>;
  const shown = compact ? ids.slice(0, 2) : ids;
  return (
    <>
      {shown.map((id) => {
        const device = state.devices?.find((item) => item.id === id);
        const name = id === deviceId() ? "This device" : (device?.name ?? "Another device");
        const picture = outputs.some((output) => output.deviceId === id && output.picture),
          sound = outputs.some((output) => output.deviceId === id && output.sound);
        return (
          <span
            key={id}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
              !compact && "text-sm font-medium",
              device && !device.online && "text-muted-foreground line-through",
            )}
          >
            {picture && (
              <Monitor aria-label="Picture" className={cn(icon, "text-muted-foreground")} />
            )}
            {sound && <Volume2 aria-label="Sound" className={cn(icon, "text-muted-foreground")} />}
            {name}
          </span>
        );
      })}
      {shown.length < ids.length && <span>+{ids.length - shown.length}</span>}
    </>
  );
}

/** Where it plays as a box that opens the Mixer: the side player's, and the phone's full player's. */
export function WhereBox({ state, connected, run }: Props) {
  const where = (
    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
      <WhereTokens state={state} compact={false} />
    </span>
  );
  if (livePlayback(state))
    return (
      <div className="side-where mt-3.5 -mx-1 grid gap-1.5 rounded-2xl px-3 pt-2 pb-2.5">
        <span className="text-xs text-muted-foreground">Where it plays</span>
        {where}
      </div>
    );
  return (
    <WhereItPlays
      state={state}
      connected={connected}
      run={run}
      className="side-where mt-3.5 -mx-1 grid h-auto min-h-0 w-[calc(100%+0.5rem)] justify-stretch gap-1.5 rounded-2xl px-3 pt-2 pb-2.5 text-left font-normal whitespace-normal"
    >
      <span className="flex items-center justify-between text-xs text-muted-foreground">
        Where it plays
        <SlidersVertical aria-hidden="true" className="size-4 text-foreground" />
      </span>
      {where}
    </WhereItPlays>
  );
}

/**
 * "2 playing" whenever another Playback this device may control runs: it lists them, to choose the one this device
 * controls. The side player's head has it; the capsule's and the dock's line end with a smaller one.
 */
export function PlayingChip({
  state,
  compact = false,
}: {
  state: ClientSessionState;
  compact?: boolean;
}) {
  const choices = playbackChoices(state);
  if (!choices.some((playback) => playback.id !== state.playback)) return null;
  // The one controlled here counts too while it runs, private or not.
  const selected = state.playbacks?.find((playback) => playback.id === state.playback);
  const count =
    choices.length + (selected?.running && !choices.some(({ id }) => id === selected.id) ? 1 : 0);
  return (
    <PlaybackPicker
      playbacks={choices}
      label={`${count} playing. Choose which one you control`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] outline-none hover:text-foreground focus-visible:bg-foreground focus-visible:text-background disabled:opacity-50",
        compact ? "relative h-6 px-2 text-xs" : "ml-0.5 h-8 px-3 text-xs",
      )}
    >
      {count} playing
    </PlaybackPicker>
  );
}

/**
 * Up next, as many of its first items as the panel has room for; each plays at once. Its heading opens the whole list,
 * with its own verbs, beside it (or, with `onOpen`, in the full player's own place for it).
 */
export function UpNext({
  state,
  connected,
  run,
  onOpen,
  className,
}: Props & { onOpen?: () => void; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const entries = playbackControls(state).queue
    ? [...upcomingQueue(state), ...(state.autoplay?.enabled ? state.autoplay.upcoming : [])].slice(
        0,
        4,
      )
    : [];
  const ids = entries.map((entry) => entry.id).join(" ");
  // Rows that would be cut by the panel's foot wait unseen, as the prototype's do; none at all hides the list.
  useUncut(list, "[data-up-next-row]", ids);
  const { available } = playbackCapabilities(state, connected);
  // Offered as the full player's Up next button is: while there is anything to show, played rows included.
  if (!hasUpNext(state)) return null;
  const heading =
    "-mx-2 h-auto min-h-0 justify-start self-start px-2 py-1 font-heading text-sm font-semibold";
  return (
    <div
      ref={list}
      className={cn(
        "mt-3.5 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border pt-2",
        className,
      )}
    >
      {onOpen ? (
        <Button variant="ghost" className={heading} onClick={onOpen}>
          Up next
        </Button>
      ) : (
        <UpNextPanel state={state} connected={connected} run={run} className={heading} />
      )}
      <ul aria-label="Up next" className="m-0 mt-1 grid list-none gap-0 p-0">
        {entries.map((entry) => (
          <li key={entry.id} data-up-next-row>
            <button
              type="button"
              disabled={!available}
              onClick={() => void run({ type: "play", entryId: entry.id })}
              className="grid w-full grid-cols-[4.625rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg py-1.5 text-left outline-none disabled:opacity-50 [&:is(:hover,:focus-visible)_.up-next-art]:outline-3 [&:is(:hover,:focus-visible)_.up-next-art]:outline-offset-2 [&:is(:hover,:focus-visible)_.up-next-art]:outline-foreground"
            >
              <span className="up-next-art block aspect-video overflow-hidden rounded-md bg-black">
                <MediaArtwork
                  thumbnail={entry.thumbnail}
                  title={entry.title}
                  className="size-full"
                />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="line-clamp-2 text-[0.8125rem] leading-tight font-medium">
                  {entry.title}
                </span>
                {entry.duration != null && !entry.endless && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(Math.round(entry.duration))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The whole of Up next, opening from its heading beside the side player; closing returns focus to the heading. */
function UpNextPanel({ state, connected, run, className }: Props & { className: string }) {
  const { credentials } = useShell();
  const { nativeHost, videoQualityPreference } = useSessionGate();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button ref={trigger} data-panel="queue" variant="ghost" className={className}>
          Up next
        </Button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          aria-label="Up next"
          className="flex max-h-[min(40rem,calc(var(--radix-popover-content-available-height)-1rem))] w-[min(28rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden px-3 pt-1 pb-3"
        >
          <QueuePanel
            state={state}
            credentials={credentials}
            connected={connected}
            available={playbackCapabilities(state, connected).available}
            nativeHost={nativeHost}
            defaultQuality={videoQualityPreference.quality}
            run={run}
            current={false}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}
