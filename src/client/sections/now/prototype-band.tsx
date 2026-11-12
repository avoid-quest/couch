// PROTOTYPE, throwaway (branch prototype/clean-player, never main): layout D for the player, switchable with ?variant=D
// (kept for the tab; the switcher flips between D and today's player). It uses the screen rather than a bottom strip:
// over a picture, who and what at the top left with the tools at the top right, and one stable row at the bottom for
// Play/Pause, Next and the timeline; beside artwork, the transport and the programme's or track's progress sit in the
// title's column and only the tools stay at the top right. No fills, rings or pills: icons and text, Play the same size.
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, SkipForward, Square } from "lucide-react";
import {
  PlaybackTimeline,
  PlaybackVolume,
  playbackCapabilities,
} from "@/components/PlaybackTransport";
import { Button } from "@/components/ui/button";
import { WhereItPlays } from "@/sections/shell/Outputs";
import { deviceId } from "@/session/device-id";
import type { ClientSessionState } from "@/session/session";
import type { Action } from "../../../shared/protocol";

const storageKey = "couch.player-variant";
const read = () => {
  const asked = new URLSearchParams(location.search).get("variant");
  try {
    if (asked) sessionStorage.setItem(storageKey, asked);
    return sessionStorage.getItem(storageKey) === "D";
  } catch {
    return asked === "D";
  }
};

export function usePlayerVariant() {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const changed = () => setOn(read());
    window.addEventListener("couch-player-variant", changed);
    return () => window.removeEventListener("couch-player-variant", changed);
  }, []);
  return on;
}

export function PlayerVariantSwitcher({ on }: { on: boolean }) {
  const flip = () => {
    try {
      sessionStorage.setItem(storageKey, on ? "off" : "D");
    } catch {
      /* The tab can't keep it; the switch still applies until reload. */
    }
    window.dispatchEvent(new Event("couch-player-variant"));
  };
  return (
    <div
      data-tv-local-only
      className="fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-white/40 bg-black/80 px-1 text-xs"
    >
      <Button variant="ghost" size="icon-sm" aria-label="Switch layout" onClick={flip}>
        <ChevronLeft />
      </Button>
      <span>{on ? "Prototype D" : "Today's player"}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Switch layout" onClick={flip}>
        <ChevronRight />
      </Button>
    </div>
  );
}

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

/** Play/Pause (Stop for a stream that can't pause), the same size as every other control; Next only when there is one. */
export function PrototypeTransport({ state, connected, run }: Props) {
  const caps = playbackCapabilities(state, connected);
  const player = state.player;
  const playing = player.status === "playing";
  const stopOnly = !caps.pausable && caps.stoppable;
  const label = stopOnly ? "Stop" : playing ? "Pause" : "Play";
  return (
    <div className="flex shrink-0 items-center">
      <Button
        data-page-first
        data-play-button
        variant="ghost"
        size="icon-lg"
        aria-label={label}
        title={label}
        disabled={stopOnly ? false : !caps.transportReady || !caps.pausable}
        onClick={() => {
          if (stopOnly) void run({ type: "stop" });
          else if (player.playbackId)
            void run({ type: "pause", playbackId: player.playbackId, paused: playing });
        }}
      >
        {stopOnly ? (
          <Square className="fill-current" />
        ) : playing ? (
          <Pause className="fill-current" />
        ) : (
          <Play className="fill-current" />
        )}
      </Button>
      {caps.hasNext && (
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Next"
          title="Next"
          disabled={!caps.nextReady}
          onClick={() => {
            if (player.playbackId) void run({ type: "next", playbackId: player.playbackId });
          }}
        >
          <SkipForward className="fill-current" />
        </Button>
      )}
    </div>
  );
}

function soundingLabel(state: ClientSessionState) {
  const ids = new Set(
    state.outputs?.filter((output) => output.sound).map((output) => output.deviceId),
  );
  if (!ids.size) ids.add(deviceId());
  const names = [...ids]
    .map((id) => state.devices?.find((device) => device.id === id)?.name)
    .filter(Boolean);
  return names.length > 1 ? `${names.length} devices` : (names[0] ?? "Where it plays");
}

/**
 * The tools, one click each: the quick volume where a pointer can use it, the mixer (named for where it plays, an icon
 * on a phone), Playback settings and fullscreen (Minimize on the TV). The TV's clock leads them.
 */
export function PrototypeTools({
  state,
  connected,
  run,
  tv,
  clock,
  settings,
  fullscreen,
}: Props & { tv: boolean; clock?: ReactNode; settings: ReactNode; fullscreen: ReactNode }) {
  return (
    <div className="-mr-2.5 flex shrink-0 items-center gap-1">
      {clock && <span className="mr-3 text-muted-foreground">{clock}</span>}
      {!tv && (
        <PlaybackVolume
          state={state}
          connected={connected}
          run={run}
          showValue={false}
          className="w-36 min-w-0 flex-none max-md:hidden"
        />
      )}
      <span className="max-md:hidden">
        <WhereItPlays
          state={state}
          connected={connected}
          run={run}
          label={soundingLabel(state)}
          className="max-w-48 font-normal text-muted-foreground"
        />
      </span>
      <span className="md:hidden">
        <WhereItPlays state={state} connected={connected} run={run} />
      </span>
      {settings}
      {fullscreen}
    </div>
  );
}

/** Info and Up next as words, quiet until focused or pointed at. */
export function PrototypeLinks({
  info,
  onInfo,
  queue,
  queueOpen,
  onQueue,
  queueRef,
}: {
  info: boolean;
  onInfo: () => void;
  queue: boolean;
  queueOpen: boolean;
  onQueue: () => void;
  queueRef: Ref<HTMLButtonElement>;
}) {
  const word = "h-8 px-2 text-sm font-medium text-muted-foreground hover:text-foreground";
  return (
    <div className="-ml-2 flex items-center">
      <Button variant="ghost" className={word} aria-pressed={info} onClick={onInfo}>
        Info
      </Button>
      {queue && (
        <Button
          ref={queueRef}
          variant="ghost"
          className={word}
          aria-expanded={queueOpen}
          onClick={onQueue}
        >
          Up next
        </Button>
      )}
    </div>
  );
}

/** Over a picture: Back, the title and its facts with Info and Up next under them, the tools at the right. */
export function PrototypeVideoTop({
  back,
  title,
  meta,
  links,
  tools,
}: {
  back: ReactNode;
  title?: string;
  meta: ReactNode;
  links: ReactNode;
  tools: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-(--gutter)">
      {back}
      <div className="grid min-w-0 flex-1 gap-0.5 pt-1.5">
        <h1 className="truncate font-display text-lg leading-tight font-bold tracking-[-0.01em] md:text-2xl">
          {title}
        </h1>
        <div className="flex min-w-0 items-baseline gap-x-3 truncate text-sm text-muted-foreground [&_[data-media-context]]:text-sm">
          {meta}
        </div>
        {links}
      </div>
      {tools}
    </div>
  );
}

/** One row that never wraps: Play/Pause and Next, then the timeline when the item has one. */
export function PrototypeVideoBottom({
  transport,
  state,
  connected,
  run,
}: Props & { transport: ReactNode }) {
  const { seekable } = playbackCapabilities(state, connected);
  return (
    <div className="flex items-center gap-3 px-(--gutter) pb-2">
      {transport}
      {seekable && (
        <div className="min-w-0 flex-1">
          <PlaybackTimeline state={state} connected={connected} run={run} compact />
        </div>
      )}
    </div>
  );
}

/** Beside artwork: the track's timeline or the show's slot (never a Live badge), then the transport with Info and Up next. */
export function PrototypeAudioControls({
  state,
  connected,
  run,
  transport,
  slot,
  links,
}: Props & { transport: ReactNode; slot: ReactNode; links: ReactNode }) {
  const { seekable } = playbackCapabilities(state, connected);
  return (
    <div className="grid max-w-xl gap-2">
      {seekable ? <PlaybackTimeline state={state} connected={connected} run={run} compact /> : slot}
      <div className="-ml-2.5 flex flex-wrap items-center gap-x-3">
        {transport}
        {links}
      </div>
    </div>
  );
}
