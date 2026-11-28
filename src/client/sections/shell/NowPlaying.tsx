import { livePlayback, listeningLive, playbackControls } from "@/session/playback-controls";
import { Level } from "@/components/Level";
import { LiveClock } from "@/components/LiveClock";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AudioLines, ChevronDown, ChevronRight, Settings } from "lucide-react";
import { Link, useRouter } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import {
  PlaybackTimeline,
  PlaybackTransport,
  PlaybackVolume,
  VolumeButton,
  playbackCapabilities,
  sharesLive,
} from "@/components/PlaybackTransport";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { useArtworkPicture } from "@/components/AmbientLight";
import { isAudioOnly } from "@/sections/now/player-presentation";
import { useStationShow } from "@/sections/home/on-air";
import { AddToHomeButton } from "@/sections/home/AddToHome";
import { detailHref, queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { showsPicture } from "@/session/device-id";
import { usePlaybackClock } from "@/session/playback-clock";
import { renderInto } from "@/session/renderer";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { returnLostFocus } from "./lost-focus";
import type { PlayerSide } from "./player-side";
import { PlayingChip, UpNext, WhereBox, WhereTokens } from "./NowPlayingParts";
import { WhereItPlays } from "./Outputs";
import { StationNotes } from "./StationNotes";
import type { Action, QueueEntry } from "../../../shared/protocol";
import { isRadio } from "../../../shared/radio";

/** Now playing's three sizes: the side player (desktop, TV), its capsule once minimised, and the phone's dock. */
export type PlayerSize = "side" | "mini" | "dock";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  size: PlayerSize;
  /** The edge the side player and the capsule stand at (Player side). */
  side: PlayerSide;
  /** The full player. */
  onOpen: () => void;
  /** Minimise to the capsule, or show the side player again: this window's own choice. */
  onSize: (size: "side" | "mini") => void;
};

/**
 * Now playing as a place (docs/design.md): while something plays it stands at one side of every screen on desktops
 * and the TV, a panel the window's height whose picture opens the full player; Minimise folds it to a capsule in that
 * side's bottom corner, which shows it again when pressed; a phone keeps it as a dock above its tabs, which opens the
 * full player. Play/Pause, Next and a labelled Stop start from its bottom-left corner at every size.
 */
export function NowPlaying({ state, connected, run, size, side, onOpen, onSize }: Props) {
  const router = useRouter();
  // React focus events include this player's portalled popovers and sheets.
  const focusWithin = useRef(false);
  // Stop removes the focused player; the full player hides it as it opens.
  useLayoutEffect(
    () => () => {
      if (focusWithin.current) returnLostFocus(router);
    },
    [router],
  );
  const programme = useStationShow();
  // Identify song's button sits beside Volume; what it finds shows in the station's notes.
  const [identify, setIdentify] = useState<HTMLDivElement | null>(null);
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const thumbnail = programme?.artworkUrl || current?.thumbnail;
  // The side player throws its picture, blurred, on the wall behind it (index.css, .lit-panel).
  const wall = useArtworkPicture(size === "side" ? thumbnail : undefined);
  if (!current) return null;
  const title = programme?.title || current.title;
  // The player's words, less the title shown beside them and the plain states the transport already shows.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet || listeningLive(state) ? "" : label;
  const live = livePlayback(state);
  // Minimise and the capsule swap places; the one that appears takes the focus the other had.
  const resize = (next: "side" | "mini") => {
    focusWithin.current = false;
    onSize(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-now-playing] [data-player-size]")?.focus(),
    );
  };
  const shell = {
    "data-now-playing": "",
    "data-size": size,
    "aria-label": "Now playing",
    onFocusCapture: () => {
      focusWithin.current = true;
    },
    onBlurCapture: () => {
      focusWithin.current = false;
    },
  };
  const picture = (className: string, small = false) => (
    <Picture
      state={state}
      entry={current}
      title={title}
      thumbnail={thumbnail}
      small={small}
      className={className}
    />
  );
  const statusLine = (
    <span role="status" className="min-w-0 truncate empty:hidden" title={status}>
      {status}
    </span>
  );
  // The capsule's and the dock's identity: one button under the picture, the title and where it plays, so the
  // playback chip on its line stays a button of its own.
  const identity = (action: string, onClick: () => void, attributes: object) => (
    <div className="relative flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full pr-2.5 has-[>button:hover]:bg-accent has-[>button:focus-visible]:bg-foreground has-[>button:focus-visible]:text-background">
      <button
        type="button"
        {...attributes}
        aria-label={`${action}: ${title}`}
        title={title}
        onClick={onClick}
        className="absolute inset-0 rounded-[inherit] outline-none"
      />
      {picture("pointer-events-none h-11 shrink-0 rounded-lg", true)}
      <span className="pointer-events-none grid min-w-0 gap-0.5">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 gap-2 overflow-hidden">
            {status ? statusLine : <WhereTokens state={state} compact />}
          </span>
          <span className="pointer-events-auto empty:hidden">
            <PlayingChip state={state} compact />
          </span>
        </span>
      </span>
    </div>
  );
  // Where it plays, or for Live audio its listener's Volume.
  const tool = live ? (
    <VolumeButton state={state} connected={connected} run={run} className="relative" />
  ) : (
    <WhereItPlays state={state} connected={connected} run={run} className="relative" />
  );

  if (size === "side")
    return (
      <aside
        {...shell}
        className={cn(
          "now-playing lit-panel side-player fixed top-3 bottom-3 z-30 flex w-(--side-player-width) flex-col overflow-hidden rounded-[1.625rem]",
          side === "left" ? "left-3" : "right-3",
        )}
      >
        {wall && <img src={wall} alt="" aria-hidden="true" className="room-picture" />}
        <div className="relative flex min-h-0 flex-1 flex-col px-3 pt-3">
          {/* At the left it takes the macOS window controls' corner. */}
          <div
            className={cn(
              "drag-region -mx-0.5 mb-2 flex h-(--player-target) shrink-0 items-center gap-0.5",
              side === "left" && "window-controls-inset",
            )}
          >
            <PlayingChip state={state} />
            <span className="flex-1" />
            {!live && <PlaybackGear state={state} connected={connected} run={run} />}
            <Button
              data-player-size
              variant="ghost"
              size="icon-lg"
              aria-label="Minimise player"
              title="Minimise player"
              onClick={() => resize("mini")}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </div>
          {/* The picture and the title are the way into the full player. */}
          <button
            type="button"
            data-player-last
            aria-label={`Open player: ${title}`}
            onClick={() => onOpen()}
            className="group/open grid min-w-0 gap-4 px-0 text-left outline-none"
          >
            <span className="relative block">
              {picture(
                "w-full rounded-[0.875rem] shadow-[0_1rem_2.5rem_-0.875rem_rgb(0_0_0/75%)] group-focus-visible/open:outline-3 group-focus-visible/open:-outline-offset-3 group-focus-visible/open:outline-foreground",
              )}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm motion-safe:transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100"
              >
                Open player
              </span>
            </span>
            <span
              title={title}
              className={cn(
                "line-clamp-3 px-1 font-heading leading-[1.14] font-semibold tracking-[-0.02em] text-balance",
                title.length > 34 ? "text-lg" : "text-xl",
              )}
            >
              {title}
            </span>
          </button>
          <div className="flex min-h-0 flex-1 flex-col px-1">
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground [&_a]:min-h-0">
              {live && current.subtitle && <span>{current.subtitle}</span>}
              <MediaContext
                creator={current.creator}
                collection={current.collection}
                radio={
                  isRadio(current) && programme && current.source.startsWith("radio:")
                    ? { id: current.source.slice(6), title: current.title }
                    : undefined
                }
              />
              {!isRadio(current) && (
                <span className="inline-flex [&>button]:mx-0 [&>button]:h-7 [&>button]:rounded-full [&>button]:px-2.5 [&>button]:text-xs [&>button]:shadow-[inset_0_0_0_1px_var(--border)]">
                  <AddToHomeButton entry={current} />
                </span>
              )}
            </div>
            {status && <p className="mt-1.5 flex text-sm text-muted-foreground">{statusLine}</p>}
            <WhereBox state={state} connected={connected} run={run} />
            {/* What's left of the panel: only the notes give way, never the title or Where it plays above them. */}
            <div className="flex min-h-0 flex-1 flex-col">
              {isRadio(current) && (
                <StationNotes
                  state={state}
                  connected={connected}
                  station={current}
                  show={programme}
                  identify={identify}
                />
              )}
              {current.liveSourceId ? (
                <SharedNote state={state} entry={current} />
              ) : (
                <UpNext
                  state={state}
                  connected={connected}
                  run={run}
                  // After a station's notes, room for its heading and first row (the notes give way).
                  className={isRadio(current) ? "min-h-24" : undefined}
                />
              )}
            </div>
          </div>
        </div>
        <div className="relative shrink-0 px-3.5 pb-3.5">
          <PlaybackTimeline
            state={state}
            connected={connected}
            said
            className="px-0.5 pt-2 pb-1 [&_[data-time-labels]]:text-xs"
          />
          {current.liveSourceId && <SharedLine state={state} entry={current} />}
          <div className="flex min-h-(--player-target) items-center gap-1.5">
            <PlaybackTransport
              state={state}
              connected={connected}
              run={run}
              quiet
              className="now-transport"
            />
            {!sharesLive(state) && (
              <PlaybackVolume
                state={state}
                connected={connected}
                run={run}
                showValue={false}
                className="ml-auto max-w-32 min-w-0 flex-1 gap-0"
              />
            )}
            {isRadio(current) && <div ref={setIdentify} className="contents" />}
          </div>
        </div>
      </aside>
    );

  if (size === "mini")
    return (
      <aside
        {...shell}
        className={cn(
          "now-playing lit-panel now-capsule relative mb-3 flex w-[min(37.5rem,calc(100vw-1.5rem))] items-center gap-1.5 overflow-hidden rounded-[2.125rem] py-2.5 pr-2.5 pl-3",
          side === "left" ? "ml-3" : "mr-3 ml-auto",
        )}
      >
        <PlaybackTransport
          state={state}
          connected={connected}
          run={run}
          quiet
          className="now-transport relative"
        />
        {identity("Show player", () => resize("side"), { "data-player-size": "" })}
        {tool}
        <Hairline state={state} />
      </aside>
    );

  // The dock: what plays and where on one line, which opens the full player; the same transport line under it.
  return (
    <aside
      {...shell}
      className="now-playing lit-panel now-dock relative mx-2 mb-1 grid gap-2 overflow-hidden rounded-3xl pt-2.5 pr-2 pb-2 pl-3"
    >
      <div className="relative flex min-w-0 items-center gap-1">
        {identity("Open player", () => onOpen(), { "data-player-last": "" })}
        {tool}
      </div>
      <PlaybackTransport
        state={state}
        connected={connected}
        run={run}
        quiet
        className="now-transport relative"
      />
    </aside>
  );
}

/**
 * The picture: the video itself while it shows on this device (renderInto moves the one video element here and back),
 * else the artwork. It sits inside the button that opens the player or shows the side player again.
 */
function Picture({
  state,
  entry,
  title,
  thumbnail,
  small,
  className,
}: {
  state: ClientSessionState;
  entry: QueueEntry;
  title: string;
  thumbnail?: string;
  small: boolean;
  className: string;
}) {
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const video =
    showsPicture(state) &&
    !playback?.hostOnly &&
    !isAudioOnly(playback, entry, state.player.tracks);
  const into = useCallback(
    (element: HTMLSpanElement | null) => (video ? renderInto(element) : undefined),
    [video],
  );
  // Through Core, so a phone refused the host's picture (RaiPlay's) still shows it.
  const shown = useArtworkPicture(video ? undefined : thumbnail, true);
  const [measure, artRatio] = useArtRatio(shown, isRadio(entry) ? 1 : 16 / 9);
  // A picture no taller than it is wide, so a square station's logo leaves the panel room.
  const ratio = video ? 16 / 9 : Math.max(1, artRatio);
  const paused = state.player.status === "paused";
  const style = { aspectRatio: ratio } as CSSProperties;
  return (
    <span
      ref={video ? undefined : measure}
      aria-hidden="true"
      style={style}
      className={cn(
        "relative block overflow-hidden bg-black motion-safe:transition-[filter] motion-safe:duration-500",
        paused && !small && "brightness-[.62] saturate-[.8]",
        className,
      )}
    >
      {video ? (
        <span ref={into} className="block size-full" />
      ) : entry.liveSourceId && !thumbnail ? (
        // A shared sound has no artwork: its mark, plainly, never a letter that pretends to be one.
        <span className="grid size-full place-items-center bg-black/40 text-foreground">
          <AudioLines className={small ? "size-5" : "size-8"} />
        </span>
      ) : (
        <MediaArtwork
          bare={!!thumbnail && !shown}
          thumbnail={shown}
          title={title}
          className="size-full object-contain"
        />
      )}
    </span>
  );
}

/** Who shares what plays here: its device's name, or the source's own (an AirPlay sender's). */
function sharedFrom(state: ClientSessionState, entry: QueueEntry) {
  const source = state.liveSources?.find((item) => item.id === entry.liveSourceId);
  return state.devices?.find((device) => device.id === source?.deviceId)?.name ?? source?.name;
}

/**
 * A shared screen or sound in Up next's place: it follows its source as it happens, so there is no timeline and nothing
 * to skip, and only the device that shares it can stop sharing.
 */
function SharedNote({ state, entry }: { state: ClientSessionState; entry: QueueEntry }) {
  const from = sharedFrom(state, entry) ?? "the device sharing it";
  const live = livePlayback(state);
  return (
    <div className="mt-3.5 grid content-start gap-1 border-t border-border pt-2.5">
      <h3 className="font-heading text-sm font-semibold">
        {live ? "Live audio" : "Shared as it happens"}
      </h3>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {live
          ? `Close to live, in step on every device that joins. There's no Pause and no Up next: you join or leave, and your volume is your own. Only ${from} can stop sharing.`
          : `It follows ${from}: no timeline, nothing to skip. Pause and Stop work on these devices only; only ${from} can stop sharing.`}
      </p>
    </div>
  );
}

/**
 * The full player's plate for a shared sound, which has no artwork, so nothing pretends: its mark, Live audio's clock
 * set large, and who shares it.
 */
export function SharedPlate({ state, entry }: { state: ClientSessionState; entry: QueueEntry }) {
  const source = state.liveSources?.find((item) => item.id === entry.liveSourceId);
  const from = sharedFrom(state, entry);
  const live = source?.intent === "live";
  return (
    <span className="bg-black/35">
      <span className="flex size-full flex-col justify-between p-5 text-left">
        <AudioLines aria-hidden="true" className="size-6" />
        <span className="grid gap-1">
          {live && (
            <LiveClock
              time
              startedAt={source?.startedAt}
              className="font-heading text-[clamp(2.5rem,12vw,4.5rem)] leading-none font-semibold tracking-[-0.03em] tabular-nums"
            />
          )}
          <span className="text-sm text-muted-foreground">
            {live
              ? "Live audio"
              : source?.kind === "system-audio"
                ? "System audio"
                : "Shared sound"}
            {from ? `, from ${from}` : ""}
          </span>
        </span>
      </span>
    </span>
  );
}

/** The line above a share's controls: how it follows its source. */
function SharedLine({ state, entry }: { state: ClientSessionState; entry: QueueEntry }) {
  const from = sharedFrom(state, entry);
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const playing = state.player.status === "playing" && !state.player.buffering;
  const source = state.liveSources?.find((item) => item.id === entry.liveSourceId);
  return (
    <p className="flex min-w-0 items-center gap-2 px-0.5 pb-1 text-xs text-muted-foreground">
      <Level moving={playing} className="shrink-0" />
      <span className="truncate">
        {livePlayback(state) ? (
          playbackControls(state).leave ? (
            <LiveClock prefix="Listening, live" startedAt={source?.startedAt} />
          ) : (
            <LiveClock startedAt={source?.startedAt} />
          )
        ) : playback?.delivery === "scheduled" ? (
          `In sync, a few seconds behind ${from ?? "its source"}`
        ) : (
          `As it happens${from ? ` on ${from}` : ""}`
        )}
      </span>
    </p>
  );
}

/** The player's own Playback menu, for whatever plays, here or on another device. */
function PlaybackGear({
  state,
  connected,
  run,
}: Omit<Props, "size" | "side" | "onOpen" | "onSize">) {
  const { credentials } = useShell();
  const detailNavigation = useDetailNavigation();
  const [menu, setMenu] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const current = state.queue.find((entry) => entry.id === state.currentEntryId)!;
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const settings =
    state.preferences && playbackControls(state).programme
      ? {
          entry: current,
          player: state.player,
          ready: playbackCapabilities(state, connected).transportReady,
          connected,
          credentials,
          preferences: state.preferences,
          profile: state.activeProfile,
          videoQualities: state.videoQualities,
          onCommand: run,
          controls: state.controls,
        }
      : null;
  const details = current.liveSourceId ? undefined : queueItemLocation(current);
  return (
    <Popover open={menu} onOpenChange={setMenu}>
      <PopoverTrigger asChild>
        <Button
          ref={gear}
          data-panel="settings"
          variant="ghost"
          size="icon-lg"
          aria-label="Playback"
          title="Playback"
          disabled={!settings}
        >
          <Settings aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      {menu && settings && (
        <PlaybackMenu
          {...settings}
          trigger={gear.current}
          tracks={!isAudioOnly(playback, current, state.player.tracks)}
          details={
            details && (
              <Button asChild variant="ghost" className={playbackMenuRow}>
                <Link
                  to={detailHref(details)}
                  aria-label="Details"
                  onClick={(event) => {
                    // As the player's own Details: in the section it was opened from, and Back returns to the gear.
                    setMenu(false);
                    if (
                      event.button ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    detailNavigation.open(
                      details,
                      '[data-now-playing] button[aria-label="Playback"]',
                    );
                  }}
                >
                  Details
                  <ChevronRight aria-hidden="true" className="-mr-1 ml-auto" />
                </Link>
              </Button>
            )
          }
        />
      )}
    </Popover>
  );
}

/** How far it has got, as a hairline along the capsule's foot. */
function Hairline({ state }: { state: ClientSessionState }) {
  const clock = usePlaybackClock();
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const length = clock.duration || current?.duration || 0;
  if (!length || !current || current.endless || isRadio(current)) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 left-0 h-0.5 bg-foreground/90"
      style={{ width: `${Math.min(100, (clock.position / length) * 100)}%` }}
    />
  );
}
