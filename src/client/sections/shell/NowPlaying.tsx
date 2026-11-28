import { livePlayback, playbackControls } from "@/session/playback-controls";
import { LiveClock } from "@/components/LiveClock";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AudioLines, ChevronDown, Settings, SlidersVertical, Volume2, X } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PlaybackMenu } from "@/components/PlaybackSettings";
import { PlaybackTransport, playbackCapabilities } from "@/components/PlaybackTransport";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { useArtworkPicture } from "@/components/AmbientLight";
import { isAudioOnly } from "@/sections/now/player-presentation";
import { useStationShow } from "@/sections/home/on-air";
import { PlayingMenu } from "@/sections/now/PlayingMenu";
import { viewersOf } from "@/sections/share/share";
import { showsPicture } from "@/session/device-id";
import { renderInto } from "@/session/renderer";
import { cn } from "@/lib/utils";
import { useChooseRequest } from "@/components/choose-view";
import { useShell } from "./shell-context";
import { returnLostFocus } from "./lost-focus";
import type { PlayerSide } from "./player-side";
import { PlaybackStrip, stripPlaybacks, UpNext, whereWords } from "./NowPlayingParts";
import { Deck, DeskPanel, sharedFrom } from "./Deck";
import { useWhereOpen, WhereList } from "./Desk";
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
 * Now playing as a place (docs/design.md): while something plays it stands at one side of every screen on desktops and
 * the TV, a column with no ground of its own: its tools, the picture standing in the room, its title and Up next, and
 * at its foot the desk, the one glass object (where it plays, Volume, the timeline, the transport). Minimised, the desk
 * is a capsule in that side's bottom corner; a phone keeps it as a dock above its tabs, and its sheet is the whole desk.
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
  const [open, setOpen] = useWhereOpen(state);
  const [sheet, setSheet] = useState(false);
  const dock = useRef<HTMLButtonElement>(null);
  // Choose where it plays takes the side player's column while it is open.
  const choosing = !!useChooseRequest();
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const thumbnail = programme?.artworkUrl || current?.thumbnail;
  // The side player throws its picture, blurred, on the wall behind its column (index.css, .side-player).
  const wall = useArtworkPicture(size === "side" ? thumbnail : undefined);
  if (!current) return null;
  const title = programme?.title || current.title;
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
    // Escape folds the desk's list before anything else closes; a key that folds away hands the focus to its handle.
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !open) return;
      event.preventDefault();
      setOpen(false);
      const from = event.target as HTMLElement;
      requestAnimationFrame(() => {
        if (!from.isConnected || document.activeElement === document.body)
          document.querySelector<HTMLElement>("[data-now-playing] [data-desk-handle]")?.focus();
      });
    },
  };
  const parts = { state, connected, run, title, thumbnail, entry: current };
  const desk = (bar?: ReactNode) => (
    <DeskPanel className="desk-foot">
      {live ? (
        <ListenersLine state={state} />
      ) : (
        <WhereList state={state} connected={connected} run={run} open={open} onOpen={setOpen} />
      )}
      <Deck state={state} connected={connected} run={run} bar={bar} />
    </DeskPanel>
  );

  if (size === "side")
    return (
      <aside
        {...shell}
        className={cn(
          "now-playing side-player fixed top-3 bottom-3 z-30 flex w-(--side-player-width) flex-col overflow-hidden rounded-[1.625rem]",
          side === "left" ? "left-3" : "right-3",
          choosing && "invisible",
        )}
      >
        {wall && <img src={wall} alt="" aria-hidden="true" className="room-picture" />}
        <SideColumn {...parts} side={side} open={open} onOpen={onOpen} resize={resize}>
          {desk()}
        </SideColumn>
      </aside>
    );

  // The capsule's and the dock's identity: the picture, the title and where it plays, one button.
  const identity = (action: string, onClick: () => void, attributes: object) => (
    <button
      type="button"
      {...attributes}
      aria-label={`${action}: ${title}`}
      title={title}
      onClick={onClick}
      className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2.5 pl-1 text-left outline-none hover:bg-(--fill) touch:rounded-[0.875rem]"
    >
      <Picture {...parts} small className="h-9 shrink-0 rounded-[0.4375rem] touch:h-10" />
      <span className="grid min-w-0">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="truncate text-caption text-subtle-foreground">
          {whereWords(state)}
          {size === "mini" && stripPlaybacks(state).length > 1
            ? `, ${stripPlaybacks(state).length} playing`
            : ""}
        </span>
      </span>
    </button>
  );

  if (size === "mini") {
    const bar = (
      <div data-nav-row className="flex h-11 min-w-0 items-center gap-0.5">
        <PlaybackTransport state={state} connected={connected} run={run} quiet />
        {identity("Show player", () => resize("side"), { "data-player-size": "" })}
        {!live && (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Where it plays"
            title="Where it plays"
            aria-pressed={open}
            onClick={() => setOpen(!open)}
            className="aria-pressed:bg-(--fill-2)"
          >
            <SlidersVertical aria-hidden="true" />
          </Button>
        )}
      </div>
    );
    return (
      <aside
        {...shell}
        className={cn(
          "now-playing relative mb-3 h-[3.5rem] w-[min(30rem,calc(100vw-1.5rem))]",
          side === "left" ? "ml-3" : "mr-3 ml-auto",
        )}
      >
        {/* Where it plays rises from the capsule, over the page, and folds back into it. */}
        {open ? (
          <div className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-var(--top-bar,0px)-1.5rem)] flex-col">
            {desk(bar)}
          </div>
        ) : (
          <DeskPanel className="px-3.5 py-1.5">{bar}</DeskPanel>
        )}
      </aside>
    );
  }

  // The dock: what plays and where, which opens the full player; Play/Pause and Stop; then Where it plays, or a Live
  // listener's own volume, which raises the desk as a sheet.
  return (
    <aside
      {...shell}
      className="now-playing desk lit-panel relative mx-2 mb-2 flex h-15 items-center gap-0.5 rounded-[1.25rem] px-1.5"
    >
      {identity("Open player", () => onOpen(), { "data-player-last": "" })}
      {live ? (
        <PlaybackTransport state={state} connected={connected} run={run} quiet />
      ) : (
        <PlaybackTransport state={state} connected={connected} run={run} quiet next={false} />
      )}
      {(!live || playbackControls(state).leave) && (
        <Button
          ref={dock}
          variant="ghost"
          size="icon-lg"
          aria-label={live ? "Your volume" : "Where it plays"}
          title={live ? "Your volume" : "Where it plays"}
          onClick={() => setSheet(true)}
        >
          {live ? <Volume2 aria-hidden="true" /> : <SlidersVertical aria-hidden="true" />}
        </Button>
      )}
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          showCloseButton={false}
          // It closes back onto the dock's control that raised it.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dock.current?.focus();
          }}
          className="now-playing max-h-[calc(100dvh-2.75rem)] gap-0 overflow-hidden rounded-t-[1.75rem] px-4 pt-4 pb-3"
        >
          <SheetTitle className="sr-only">{live ? "Your volume" : "Where it plays"}</SheetTitle>
          <Tools {...parts} close={() => setSheet(false)} />
          <Beside {...parts} onOpen={onOpen} />
          <div className="mt-2 flex min-h-0 flex-col">
            {live ? (
              <ListenersLine state={state} />
            ) : (
              <WhereList
                state={state}
                connected={connected}
                run={run}
                open
                fixed
                onOpen={() => {}}
              />
            )}
            <Deck state={state} connected={connected} run={run} />
          </div>
        </SheetContent>
      </Sheet>
    </aside>
  );
}

type Parts = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  title: string;
  thumbnail?: string;
  entry: QueueEntry;
};

/**
 * The side player's column, on the room. The picture keeps the top and the desk the foot; between them Up next (or a
 * station's notes) takes what is spare. When the devices or Up next would be squeezed, the picture steps beside its
 * title; opening the list hides Up next.
 */
function SideColumn({
  side,
  open,
  onOpen,
  resize,
  children,
  ...parts
}: Parts & {
  side: PlayerSide;
  open: boolean;
  onOpen: () => void;
  resize: (size: "side" | "mini") => void;
  children: ReactNode;
}) {
  const { state, entry } = parts;
  const column = useRef<HTMLDivElement>(null);
  const small = useCrowded(column, `${state.playback}:${open}:${entry.id}`);
  const [identify, setIdentify] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={column} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Tools
        {...parts}
        identify={isRadio(entry) ? setIdentify : undefined}
        minimise={() => resize("mini")}
        className={side === "left" ? "window-controls-inset" : undefined}
      />
      {small ? <Beside {...parts} onOpen={onOpen} /> : <Whole {...parts} onOpen={onOpen} />}
      {/* Up next or the notes keep their least room, so the picture steps beside its title before they are cut. */}
      <div hidden={open} className="contents">
        <Middle {...parts} identify={identify} />
      </div>
      <span className="min-h-4 flex-1" />
      {children}
    </div>
  );
}

/**
 * Whether the column is crowded: its content overflows, or the open list scrolls. Measured again whenever what it
 * shows (`key`) changes or the window resizes, from the whole picture.
 */
export function useCrowded(column: React.RefObject<HTMLDivElement | null>, key: string) {
  const [small, setSmall] = useState(false);
  const [measured, setMeasured] = useState(key);
  if (measured !== key) {
    setMeasured(key);
    setSmall(false);
  }
  useLayoutEffect(() => {
    const element = column.current;
    if (!element || small) return;
    const crowded = () => {
      const list = element.querySelector<HTMLElement>('[data-where-list="whole"]');
      return (
        element.scrollHeight > element.clientHeight + 1 ||
        (!!list && list.scrollHeight > list.clientHeight + 2)
      );
    };
    if (crowded()) setSmall(true);
  });
  useEffect(() => {
    const reset = () => setSmall(false);
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);
  return small;
}

/** The top line: every Playback's picture, then Identify song (a station), the item's "…", the gear, Minimise or Close. */
function Tools({
  state,
  connected,
  run,
  identify,
  minimise,
  close,
  className,
}: Parts & {
  identify?: (element: HTMLDivElement | null) => void;
  minimise?: () => void;
  close?: () => void;
  className?: string;
}) {
  const live = livePlayback(state) && !!playbackControls(state).leave;
  return (
    <div
      data-nav-row
      className={cn("drag-region mb-2 flex h-10 shrink-0 items-center gap-0.5", className)}
    >
      <PlaybackStrip state={state} crowded={!!identify} />
      <span className="flex-1" />
      {identify && <div ref={identify} className="contents" />}
      {!live && (
        <>
          <PlayingMenu
            state={state}
            connected={connected}
            run={run}
            back="[data-now-playing] [data-playing-menu]"
          />
          <PlaybackGear state={state} connected={connected} run={run} />
        </>
      )}
      {minimise && (
        <Button
          data-player-size
          variant="ghost"
          size="icon-lg"
          aria-label="Minimise player"
          title="Minimise player"
          onClick={minimise}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      )}
      {close && (
        <Button variant="ghost" size="icon-lg" aria-label="Close" title="Close" onClick={close}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** What plays, its context and what the source says, under the title. */
function Context({ state, entry }: Parts) {
  const programme = useStationShow();
  const { label, quiet } = playbackStatus(state, true);
  const status = quiet || livePlayback(state) ? "" : label;
  return (
    <>
      <p className="mt-1 flex min-w-0 flex-wrap gap-x-2.5 text-meta text-muted-foreground [&_a]:min-h-0">
        <MediaContext
          creator={entry.creator}
          collection={entry.collection}
          radio={
            isRadio(entry) && programme && entry.source.startsWith("radio:")
              ? { id: entry.source.slice(6), title: entry.title }
              : undefined
          }
        />
        {livePlayback(state) && (
          <span className="text-subtle-foreground">
            Live audio{sharedFrom(state, entry) ? ` from ${sharedFrom(state, entry)}` : ""}
          </span>
        )}
      </p>
      {entry.subtitle && !isRadio(entry) && (
        <p className="mt-1.5 line-clamp-2 text-meta text-subtle-foreground">{entry.subtitle}</p>
      )}
      {status && (
        <p role="status" className="mt-1.5 truncate text-meta text-muted-foreground" title={status}>
          {status}
        </p>
      )}
    </>
  );
}

/** The picture whole, the column's width, standing in the room with its title under it; it opens the full player. */
function Whole({ onOpen, ...parts }: Parts & { onOpen: () => void }) {
  const { title } = parts;
  return (
    <>
      <button
        type="button"
        data-player-last
        aria-label={`Open player: ${title}`}
        onClick={onOpen}
        className="group/open relative block shrink-0 rounded-[0.875rem] outline-none"
      >
        <Picture
          {...parts}
          className="w-full rounded-[0.875rem] shadow-[0_1.25rem_2.75rem_-1rem_rgb(0_0_0/80%)] group-focus-visible/open:outline-3 group-focus-visible/open:-outline-offset-3 group-focus-visible/open:outline-foreground"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm motion-safe:transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100"
        >
          Open player
        </span>
      </button>
      <div className="shrink-0 px-3.5 pt-4">
        <h2
          title={title}
          className="line-clamp-2 font-heading text-[1.25rem] leading-6 font-semibold tracking-[-0.015em]"
        >
          {title}
        </h2>
        <Context {...parts} />
      </div>
    </>
  );
}

/** The picture beside its title, for a station's square art and whenever the devices need the room. */
function Beside({ onOpen, ...parts }: Parts & { onOpen: () => void }) {
  const { title, entry } = parts;
  return (
    <div className="flex shrink-0 items-center gap-3.5 rounded-[0.875rem] py-1 pr-2 pl-1">
      <button
        type="button"
        data-player-last
        aria-label={`Open player: ${title}`}
        onClick={onOpen}
        className="shrink-0 rounded-lg outline-none focus-visible:outline-3 focus-visible:outline-foreground"
      >
        <Picture
          {...parts}
          small
          className={cn(
            "rounded-lg shadow-[0_0.75rem_1.5rem_-0.75rem_rgb(0_0_0/80%)]",
            isRadio(entry) ? "w-22" : "w-26",
          )}
        />
      </button>
      <div className="grid min-w-0 flex-1">
        <h2
          title={title}
          className={cn(
            "font-heading text-[1.0625rem] leading-[1.375rem] font-semibold",
            isRadio(entry) ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {title}
        </h2>
        <Context {...parts} />
      </div>
    </div>
  );
}

/** Between the title and the desk: a station's notes, how a share behaves, or Up next. */
function Middle({ identify, ...parts }: Parts & { identify: HTMLElement | null }) {
  const { state, connected, run, entry } = parts;
  const programme = useStationShow();
  if (isRadio(entry))
    return (
      <StationNotes
        state={state}
        connected={connected}
        station={entry}
        show={programme}
        identify={identify}
      />
    );
  if (entry.liveSourceId && !livePlayback(state)) {
    const from = sharedFrom(state, entry) ?? "the device sharing it";
    return (
      <section className="mt-4 grid content-start gap-1.5 px-3.5 text-meta">
        <h3 className="font-semibold text-muted-foreground">Shared as it happens</h3>
        <p className="text-muted-foreground">
          It follows {from}: no timeline, nothing to skip. Pause and Stop work on these devices
          only; only {from} can stop sharing.
        </p>
      </section>
    );
  }
  if (entry.liveSourceId) return null;
  return <UpNext state={state} connected={connected} run={run} />;
}

/** A Live listener's desk says how Live audio goes: everyone joins from their own device, at their own volume. */
function ListenersLine({ state }: { state: ClientSessionState }) {
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const listening = playback?.liveSourceId ? viewersOf(state, playback.liveSourceId).length : 0;
  return (
    <p className="pt-3 pb-2.5 text-meta text-subtle-foreground">
      {listening} listening. With Live audio everyone joins from their own device, at their own
      volume.
    </p>
  );
}

/**
 * The picture: the video itself while it shows on this device (renderInto moves the one video element here and back),
 * else the artwork; a shared sound's plate, with Live audio's clock set large, where there is no artwork.
 */
function Picture({
  state,
  entry,
  title,
  thumbnail,
  small = false,
  className,
}: Parts & { small?: boolean; className: string }) {
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
  // A picture no taller than it is wide, so a square station's logo leaves the column room.
  const ratio = video ? 16 / 9 : Math.max(1, artRatio);
  const paused = state.player.status === "paused";
  const source = state.liveSources?.find((item) => item.id === entry.liveSourceId);
  return (
    <span
      ref={video ? undefined : measure}
      aria-hidden="true"
      style={{ aspectRatio: entry.liveSourceId && !thumbnail ? 16 / 9 : ratio } as CSSProperties}
      className={cn(
        "relative block overflow-hidden bg-black motion-safe:transition-[filter] motion-safe:duration-500",
        paused && !small && "brightness-[.62] saturate-[.8]",
        className,
      )}
    >
      {video ? (
        <span ref={into} className="block size-full" />
      ) : entry.liveSourceId && !thumbnail ? (
        // A shared sound has no artwork: its mark, plainly, and Live audio's clock where it is Live.
        <span className="flex size-full flex-col justify-end bg-[linear-gradient(160deg,rgb(246_242_236/10%),rgb(246_242_236/3%))] p-[8%] text-left">
          {small || source?.intent !== "live" ? (
            <AudioLines className={cn("self-center", small ? "size-5" : "m-auto size-8")} />
          ) : (
            <>
              <LiveClock
                time
                startedAt={source.startedAt}
                className="font-heading text-5xl leading-none font-bold tracking-[-0.02em] tabular-nums"
              />
              <span className="mt-1.5 text-meta text-muted-foreground">
                Live audio{sharedFrom(state, entry) ? ` from ${sharedFrom(state, entry)}` : ""}
              </span>
            </>
          )}
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

/** The player's own Playback menu, for whatever plays, here or on another device. */
function PlaybackGear({ state, connected, run }: Pick<Parts, "state" | "connected" | "run">) {
  const { credentials } = useShell();
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
        />
      )}
    </Popover>
  );
}
