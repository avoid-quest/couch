import { useLayoutEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { livePlayback, playbackControls } from "@/session/playback-controls";
import type { ClientSessionState } from "@/session/session";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaArtwork } from "@/components/MediaArtwork";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { ProgrammeArt } from "@/components/MixerKeys";
import { playbackCapabilities, toolPanel } from "@/components/PlaybackTransport";
import { hasUpNext, QueuePanel } from "@/sections/now/QueuePanel";
import { useUpNextMenu } from "@/sections/now/UpNextMenu";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import { formatDuration } from "@/time-format";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import type { Action, PlaybackSummary } from "../../../shared/protocol";
import { upcomingQueue } from "../../../shared/queue";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

/** Where a Playback plays, in a few words: "This device", "Living room TV and Kitchen", "Living room TV +4". */
export function whereWords(state: ClientSessionState, playback?: PlaybackSummary) {
  if (!playback && livePlayback(state))
    return playbackControls(state).leave ? "Your sound, on this device" : "Not joined";
  const outputs = playback?.outputs ?? state.outputs ?? [];
  const names = [...new Set(outputs.map((output) => output.deviceId))].map((id) =>
    id === deviceId()
      ? "This device"
      : (state.devices?.find((device) => device.id === id)?.name ?? "Another device"),
  );
  if (!names.length) return "Not on any device";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

/** The Playbacks the strip shows: every one running, a private one too, as a plate nobody here can open. */
export const stripPlaybacks = (state: ClientSessionState) =>
  state.playbacks?.filter(
    (playback) => playback.id === state.playback || playback.running || playback.private,
  ) ?? [];

/**
 * Every Playback as its picture, at the left of the player's top line while more than one plays: the one in view is
 * ringed, the others half ink; pressing one makes it the one the player shows and changes. A private one is a plate with
 * a lock that can't be pressed. Up to three (two beside Identify song), "N playing" follows them.
 */
export function PlaybackStrip({
  state,
  crowded = false,
}: {
  state: ClientSessionState;
  /** Its line holds one more tool (Identify song), so the count gives way a picture sooner. */
  crowded?: boolean;
}) {
  const { connected } = useSessionGate();
  const { selectPlayback } = useShell();
  const strip = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  const playbacks = stripPlaybacks(state);
  useLayoutEffect(() => {
    const element = strip.current;
    if (!element) return;
    const measure = () =>
      setCut(element.scrollWidth - element.scrollLeft > element.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [playbacks.length]);
  if (playbacks.length < 2) return null;
  return (
    <div
      ref={strip}
      data-nav-row
      role="tablist"
      aria-label={`${playbacks.length} playing`}
      data-cut={cut ? "right" : undefined}
      className="mr-1 flex min-w-0 shrink items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {playbacks.map((playback) => {
        const selected = playback.id === state.playback;
        const label = playback.private
          ? `Something private, ${whereWords(state, playback)}`
          : `${playback.title ?? "Playing"}, ${playback.status === "paused" ? "paused, " : ""}${whereWords(state, playback)}`;
        return (
          <button
            key={playback.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={playback.private || undefined}
            aria-label={label}
            title={label}
            disabled={!connected}
            onClick={() => {
              if (!playback.private && !selected) void selectPlayback(playback.id);
            }}
            className={cn(
              "shrink-0 rounded-lg p-[0.1875rem] opacity-50 outline-none hover:opacity-85 aria-disabled:cursor-default aria-selected:opacity-100 aria-selected:shadow-[inset_0_0_0_0.125rem_var(--foreground)]",
            )}
          >
            {playback.private ? (
              <span className="grid aspect-square h-[1.625rem] place-items-center rounded-[0.3125rem] bg-(--fill-2) text-muted-foreground">
                <Lock aria-hidden="true" className="size-3" />
              </span>
            ) : (
              <ProgrammeArt
                thumbnail={playback.thumbnail}
                title={playback.title ?? ""}
                className="block aspect-video h-[1.625rem] w-auto rounded-[0.3125rem] object-cover"
              />
            )}
          </button>
        );
      })}
      {playbacks.length < (crowded ? 3 : 4) && (
        <span className="ml-1.5 shrink-0 text-meta whitespace-nowrap text-subtle-foreground max-sm:hidden">
          {playbacks.length} playing
        </span>
      )}
    </div>
  );
}

/**
 * Up next, on the room: at least two of its first items when it has them, cut softly where the desk begins; each plays
 * at once. Its heading opens the whole list beside the player (or, with `onOpen`, in the full player's own place for
 * it), and its "…" holds the list's own verbs.
 */
export function UpNext({
  state,
  connected,
  run,
  onOpen,
  className,
}: Props & { onOpen?: () => void; className?: string }) {
  const { credentials } = useShell();
  const box = useRef<HTMLElement>(null);
  const [cut, setCut] = useState(false);
  const entries = playbackControls(state).queue
    ? [...upcomingQueue(state), ...(state.autoplay?.enabled ? state.autoplay.upcoming : [])].slice(
        0,
        6,
      )
    : [];
  const { available } = playbackCapabilities(state, connected);
  const list = useUpNextMenu({
    state,
    credentials,
    connected,
    run,
    upcoming: upcomingQueue(state).length,
    options: () => box.current?.querySelector<HTMLElement>("[data-row-options]"),
  });
  const menu = useItemMenu(list.actions);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [entries.length]);
  // Offered as the full player's Up next button is: while there is anything to show, played rows included.
  if (!hasUpNext(state)) return null;
  return (
    <section
      ref={box}
      aria-label="Up next"
      data-cut={cut ? "end" : undefined}
      style={{ minHeight: entries.length > 1 ? "8.5rem" : entries.length ? "5.25rem" : "2rem" }}
      className={cn("mt-4 flex shrink-[100] flex-col overflow-hidden px-3.5", className)}
    >
      <div className="-mr-1.5 flex h-8 shrink-0 items-center justify-between">
        {onOpen ? (
          <Button
            variant="ghost"
            className="-ml-2 h-7 px-2 text-meta font-semibold text-muted-foreground"
            onClick={onOpen}
          >
            Up next
          </Button>
        ) : (
          <UpNextPanel state={state} connected={connected} run={run} />
        )}
        <ItemMenu menu={menu} title="Up next" className="size-7" />
        {list.dialog}
      </div>
      <ul className="m-0 grid list-none p-0">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              disabled={!available}
              onClick={() => void run({ type: "play", entryId: entry.id })}
              className="flex h-13 w-full min-w-0 items-center gap-3 rounded-lg text-left outline-none disabled:opacity-50 [&:is(:hover,:focus-visible)_.up-next-art]:outline-3 [&:is(:hover,:focus-visible)_.up-next-art]:outline-offset-2 [&:is(:hover,:focus-visible)_.up-next-art]:outline-foreground"
            >
              <span className="up-next-art block aspect-video w-18 shrink-0 overflow-hidden rounded-md bg-black">
                <MediaArtwork
                  thumbnail={entry.thumbnail}
                  title={entry.title}
                  className="size-full"
                />
              </span>
              <span className="grid min-w-0">
                <span className="truncate text-sm font-medium">{entry.title}</span>
                {entry.duration != null && !entry.endless && (
                  <span className="text-caption text-subtle-foreground tabular-nums">
                    {formatDuration(Math.round(entry.duration))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The whole of Up next, opening from its heading beside the side player; closing returns focus to the heading. */
function UpNextPanel({ state, connected, run }: Props) {
  const { credentials } = useShell();
  const { nativeHost, videoQualityPreference } = useSessionGate();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          data-panel="queue"
          variant="ghost"
          className="-ml-2 h-7 px-2 text-meta font-semibold text-muted-foreground"
        >
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
