// PROTOTYPE, throwaway (branch prototype/clean-player, never main): three layouts for the player's controls, switchable
// with ?variant=A|B|C (kept for the tab): A a floating capsule (Infuse, Apple Music), B Apple TV's title, pills and round
// buttons, C YouTube's grouped pills. Same controls in each: Play/Pause (■ for live radio), Next when there is one, a quick
// volume where a pointer can use it, the mixer, Playback settings, fullscreen (Minimize on the TV), Info and Up next as pills.
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
import { cn } from "@/lib/utils";
import type { Action } from "../../../shared/protocol";

type Variant = "A" | "B" | "C";
const variants: { key: Variant; name: string }[] = [
  { key: "A", name: "Capsule" },
  { key: "B", name: "Title, pills, round buttons" },
  { key: "C", name: "Grouped pills" },
];
const storageKey = "couch.player-variant";
const read = (): Variant | null => {
  const asked = new URLSearchParams(location.search).get("variant");
  try {
    if (asked) sessionStorage.setItem(storageKey, asked);
    const kept = sessionStorage.getItem(storageKey);
    return variants.some((item) => item.key === kept) ? (kept as Variant) : null;
  } catch {
    return variants.some((item) => item.key === asked) ? (asked as Variant) : null;
  }
};

export function usePlayerVariant() {
  const [variant, setVariant] = useState(read);
  useEffect(() => {
    const changed = () => setVariant(read());
    window.addEventListener("couch-player-variant", changed);
    return () => window.removeEventListener("couch-player-variant", changed);
  }, []);
  return variant;
}

export function PlayerVariantSwitcher({ variant }: { variant: Variant }) {
  const at = variants.findIndex((item) => item.key === variant);
  const go = (by: number) => {
    const next = variants[(at + by + variants.length) % variants.length]!.key;
    try {
      sessionStorage.setItem(storageKey, next);
    } catch {
      /* The tab can't keep it; the switch still applies until reload. */
    }
    window.dispatchEvent(new Event("couch-player-variant"));
  };
  return (
    <div
      data-tv-local-only
      className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-dashed border-white/40 bg-black/80 px-1 text-sm"
    >
      <Button variant="ghost" size="icon" aria-label="Previous layout" onClick={() => go(-1)}>
        <ChevronLeft />
      </Button>
      <span>
        Prototype {variant}: {variants[at]?.name}
      </span>
      <Button variant="ghost" size="icon" aria-label="Next layout" onClick={() => go(1)}>
        <ChevronRight />
      </Button>
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

export function PrototypeBand({
  variant,
  state,
  connected,
  run,
  video,
  tv,
  title,
  meta,
  live,
  info,
  onInfo,
  queue,
  queueOpen,
  onQueue,
  queueRef,
  settings,
  fullscreen,
}: {
  variant: Variant;
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  video: boolean;
  tv: boolean;
  title?: string;
  meta: ReactNode;
  live: ReactNode;
  info: boolean;
  onInfo: () => void;
  queue: boolean;
  queueOpen: boolean;
  onQueue: () => void;
  queueRef: Ref<HTMLButtonElement>;
  settings: ReactNode;
  fullscreen: ReactNode;
}) {
  const caps = playbackCapabilities(state, connected);
  const player = state.player;
  const playing = player.status === "playing";
  const stopOnly = !caps.pausable && caps.stoppable;
  const primaryLabel = stopOnly ? "Stop" : playing ? "Pause" : "Play";
  const round = variant === "B";
  const primary = (
    <Button
      data-page-first
      data-play-button
      variant={round ? "secondary" : "ghost"}
      size="icon-lg"
      className={cn(round && "size-14 rounded-full bg-white/15 backdrop-blur-md")}
      aria-label={primaryLabel}
      title={primaryLabel}
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
  );
  const next = caps.hasNext && (
    <Button
      variant={round ? "secondary" : "ghost"}
      size="icon-lg"
      className={cn(round && "size-12 rounded-full bg-white/15 backdrop-blur-md")}
      aria-label="Next"
      title="Next"
      disabled={!caps.nextReady}
      onClick={() => {
        if (player.playbackId) void run({ type: "next", playbackId: player.playbackId });
      }}
    >
      <SkipForward className="fill-current" />
    </Button>
  );
  // A pointer gets the quick volume in the bar; phones keep their keys, the TV its mixer (L1/R1 later).
  const volume = !tv && (
    <PlaybackVolume
      state={state}
      connected={connected}
      run={run}
      showValue={false}
      className="min-w-32 max-w-40 max-sm:hidden"
    />
  );
  const pill = "h-9 rounded-full bg-white/12 px-4 text-sm font-medium backdrop-blur-md";
  const pills = (
    <div className="flex items-center gap-2">
      <Button variant="secondary" className={pill} aria-pressed={info} onClick={onInfo}>
        Info
      </Button>
      {queue && (
        <Button
          ref={queueRef}
          variant="secondary"
          className={pill}
          aria-expanded={queueOpen}
          onClick={onQueue}
        >
          Up next
        </Button>
      )}
    </div>
  );
  // On a phone the chip's name would crowd Play, so it stays an icon there.
  const mixerChip = (
    <>
      <WhereItPlays
        state={state}
        connected={connected}
        run={run}
        label={soundingLabel(state)}
        className="max-w-48 rounded-full max-sm:hidden"
      />
      <span className="sm:hidden">
        <WhereItPlays state={state} connected={connected} run={run} />
      </span>
    </>
  );
  const mixerIcon = <WhereItPlays state={state} connected={connected} run={run} />;
  const timeline = caps.seekable ? (
    <PlaybackTimeline state={state} connected={connected} run={run} compact />
  ) : (
    live
  );
  const titleBlock = video && title && (
    <div className="grid min-w-0 gap-1">
      <h2
        className={cn(
          "line-clamp-2 font-display font-bold tracking-[-0.02em] text-balance",
          variant === "B" ? "text-3xl md:text-5xl" : "text-xl md:text-3xl",
        )}
      >
        {title}
      </h2>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm text-muted-foreground md:text-base">
        {meta}
      </div>
    </div>
  );

  if (variant === "A")
    return (
      <div className="grid gap-3 px-(--gutter) pb-4">
        {titleBlock}
        {pills}
        <div className="mx-auto grid w-full max-w-5xl gap-1 rounded-[1.75rem] bg-black/45 px-3 py-2 shadow-[var(--float-shadow)] ring-1 ring-white/10 backdrop-blur-xl">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex min-w-0 items-center">{volume}</div>
            <div className="flex items-center gap-1">
              {primary}
              {next}
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1">
              {mixerChip}
              {settings}
              {fullscreen}
            </div>
          </div>
          <div className="px-2">{timeline}</div>
        </div>
      </div>
    );

  if (variant === "B")
    return (
      <div className="grid gap-4 px-(--gutter) pb-6">
        {titleBlock}
        <div>{timeline}</div>
        <div className="flex items-center gap-3">
          {primary}
          {next}
          {pills}
          <div className="ml-auto flex items-center gap-3 [&_button]:size-12 [&_button]:rounded-full [&_button]:bg-white/15 [&_button]:backdrop-blur-md">
            {mixerIcon}
            {settings}
            {fullscreen}
          </div>
        </div>
      </div>
    );

  const group =
    "flex items-center rounded-full bg-black/40 px-1 ring-1 ring-white/10 backdrop-blur-md";
  return (
    <div className="grid gap-2 px-(--gutter) pb-4">
      {titleBlock}
      <div>{timeline}</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={group}>
          {primary}
          {next}
        </div>
        {volume && <div className={cn(group, "px-3 max-sm:hidden")}>{volume}</div>}
        {pills}
        <div className="ml-auto flex items-center gap-2">
          <div className={group}>{mixerChip}</div>
          <div className={group}>
            {settings}
            {fullscreen}
          </div>
        </div>
      </div>
    </div>
  );
}
