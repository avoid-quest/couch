import { livePlayback, listeningLive, playbackControls } from "@/session/playback-controls";
import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import type { ClientSessionState } from "@/session/session";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ChevronRight,
  Maximize2,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersVertical,
  Volume2,
} from "lucide-react";
import { Link, useRouter, type AnyRouter } from "@tanstack/react-router";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PlaybackMenu, playbackMenuRow } from "@/components/PlaybackSettings";
import {
  PlaybackTimeline,
  PlaybackTransport,
  PlaybackVolume,
  playbackCapabilities,
  sharesLive,
} from "@/components/PlaybackTransport";
import { MediaArtwork, useArtRatio } from "@/components/MediaArtwork";
import { roomStyle, useArtworkLight } from "@/components/AmbientLight";
import { isAudioOnly } from "@/sections/now/player-presentation";
import { useStationShow } from "@/sections/home/on-air";
import { AddToHomeButton } from "@/sections/home/AddToHome";
import { detailHref, queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { deviceId, showsPicture } from "@/session/device-id";
import { usePlaybackClock } from "@/session/playback-clock";
import { renderInto } from "@/session/renderer";
import { focusPageControl } from "@/navigation";
import { formatDuration } from "@/time-format";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";
import { PlaybackPicker, playbackChoices } from "./PlaysOnLine";
import { WhereItPlays } from "./Outputs";
import type { Action, QueueEntry } from "../../../shared/protocol";
import { upcomingQueue } from "../../../shared/queue";
import { isRadio } from "../../../shared/radio";

// Bars at the bottom of the viewport (the shell's footer, the player band) can overlap
// for a commit during navigation, so the tallest registered one wins.
const bars = new Map<HTMLElement, number>();
function publishBars() {
  const height = Math.max(0, ...bars.values());
  if (height) document.documentElement.style.setProperty("--bottom-bar", `${height}px`);
  else document.documentElement.style.removeProperty("--bottom-bar");
}

/** Publishes --bottom-bar before paint; contentKey also measures when the shell adds/removes its playing bar. */
export function useBottomBar(
  ref: RefObject<HTMLElement | null>,
  shown = true,
  contentKey?: boolean,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shown) return;
    const measure = () => {
      bars.set(element, element.offsetHeight);
      publishBars();
    };
    const observer = new ResizeObserver(([entry]) => {
      bars.set(element, Math.round(entry!.borderBoxSize[0]!.blockSize));
      publishBars();
    });
    // The border box: the player band drops its scrim's padding when Up next opens.
    observer.observe(element, { box: "border-box" });
    measure();
    return () => {
      observer.disconnect();
      bars.delete(element);
      publishBars();
    };
  }, [ref, shown, contentKey]);
}

// Stop may reveal a loading page. Its heading/other controls are provisional
// until the primary control arrives, unless the user chooses or navigates away.
function recoverPageFocus(page: HTMLElement, router: AnyRouter) {
  let provisional: Element | null = document.body;
  let restoring = false;
  const restore = () => {
    if (
      !page.isConnected ||
      (document.activeElement !== document.body && document.activeElement !== provisional)
    ) {
      stop();
      return;
    }
    restoring = true;
    focusPageControl(page);
    provisional = document.activeElement;
    restoring = false;
    if (provisional?.matches("[data-page-first]")) stop();
  };
  const observer = new MutationObserver(restore);
  const chosen = () => {
    if (!restoring) stop();
  };
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("focusin", chosen, true);
  };
  const timer = setTimeout(stop, 15_000);
  const unsubscribe = router.subscribe("onBeforeNavigate", stop);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "inert"],
  });
  window.addEventListener("keydown", stop, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("focusin", chosen, true);
  restore();
}

/** Call while a commit removes the focused control: after it, return lost focus to the
 * same page, leaving navigation and any deliberately chosen target alone. */
export function returnLostFocus(router: AnyRouter) {
  const page = document.querySelector<HTMLElement>("[data-page]");
  const location = router.state.location;
  // The player puts focus on its own picture.
  queueMicrotask(() => {
    if (
      page?.isConnected &&
      !page.matches('[data-page="Now"]') &&
      router.state.location === location &&
      document.activeElement === document.body
    )
      recoverPageFocus(page, router);
  });
}

/** Now playing's three sizes: the side player (desktop, TV), its capsule once minimised, and the phone's dock. */
export type PlayerSize = "side" | "mini" | "dock";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  size: PlayerSize;
  /** Expand: the full player, or its Up next. */
  onOpen: (panel?: "queue") => void;
  /** Minimise to the capsule, or show the side player again: this window's own choice. */
  onSize: (size: "side" | "mini") => void;
};

/**
 * Now playing as a place (docs/design.md): while something plays it stands at the side of every screen on desktops
 * and the TV, a panel the window's height; Minimise folds it to a capsule at the bottom left, Expand opens the full
 * player; a phone keeps it as a dock above its tabs. Play/Pause, Next and a labelled Stop start from its bottom-left
 * corner at every size.
 */
export function NowPlaying({ state, connected, run, size, onOpen, onSize }: Props) {
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
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  // The light behind the player is the playing artwork's (index.css, .now-playing).
  const light = useArtworkLight(programme?.artworkUrl || current?.thumbnail);
  if (!current) return null;
  const title = programme?.title || current.title;
  // The player's words, less the title shown beside them and the plain states the transport already shows.
  const { label, quiet } = playbackStatus(state, connected);
  const status = quiet || listeningLive(state) ? "" : label;
  const live = livePlayback(state);
  // Minimise and Show player swap places; the one that appears takes the focus the other had.
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
    style: roomStyle(light),
  };
  const picture = (className: string, small = false) => (
    <Picture
      state={state}
      entry={current}
      title={title}
      thumbnail={programme?.artworkUrl || current.thumbnail}
      small={small}
      onClick={size === "mini" ? () => resize("side") : () => onOpen()}
      className={className}
    />
  );
  const statusLine = (
    <span role="status" className="min-w-0 truncate empty:hidden" title={status}>
      {status}
    </span>
  );
  const where = (compact: boolean) => (
    <span
      className={cn("flex min-w-0 gap-x-3 gap-y-0.5", compact ? "overflow-hidden" : "flex-wrap")}
    >
      <WhereTokens state={state} compact={compact} />
    </span>
  );

  if (size === "side")
    return (
      <aside
        {...shell}
        className="now-playing side-player fixed top-3 bottom-3 left-3 z-30 flex w-(--side-player-width) flex-col overflow-hidden rounded-[1.625rem]"
      >
        {/* The playing artwork's light, behind everything the panel holds. */}
        <div aria-hidden="true" className="now-playing-light" />
        <div className="relative flex min-h-0 flex-1 flex-col px-3 pt-3">
          <div className="drag-region window-controls-inset -mx-0.5 mb-2 flex h-(--player-target) shrink-0 items-center gap-0.5">
            <PlayingCount state={state} />
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
              <PanelLeftClose aria-hidden="true" />
            </Button>
            <Button
              data-player-last
              variant="ghost"
              size="icon-lg"
              aria-label="Open player"
              title="Open player"
              onClick={() => onOpen()}
            >
              <Maximize2 aria-hidden="true" />
            </Button>
          </div>
          {picture("w-full rounded-[0.875rem] shadow-[0_1rem_2.5rem_-0.875rem_rgb(0_0_0/75%)]")}
          <div className="flex min-h-0 flex-1 flex-col px-1">
            <h2
              title={title}
              className={cn(
                "mt-4 line-clamp-3 font-heading leading-[1.14] font-semibold tracking-[-0.02em] text-balance",
                title.length > 34 ? "text-lg" : "text-xl",
              )}
            >
              {title}
            </h2>
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
            {live ? (
              <div className="side-where mt-3.5 -mx-1 grid gap-1.5 rounded-2xl px-3 pt-2 pb-2.5">
                <span className="text-xs text-muted-foreground">Where it plays</span>
                {where(false)}
              </div>
            ) : (
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
                {where(false)}
              </WhereItPlays>
            )}
            <UpNext state={state} connected={connected} run={run} onOpen={() => onOpen("queue")} />
          </div>
        </div>
        <div className="relative shrink-0 px-3.5 pb-3.5">
          <PlaybackTimeline
            state={state}
            connected={connected}
            said
            className="px-0.5 pt-2 pb-1 [&_[data-time-labels]]:text-xs"
          />
          {isRadio(current) && state.player.status === "playing" && (
            <p className="px-1 pt-2.5 pb-2 text-sm text-muted-foreground">On air now</p>
          )}
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
          </div>
        </div>
      </aside>
    );

  if (size === "mini")
    return (
      <aside
        {...shell}
        className="now-playing now-capsule relative mb-3 ml-3 flex w-[min(37.5rem,calc(100vw-1.5rem))] items-center gap-1.5 overflow-hidden rounded-[2.125rem] py-2.5 pr-2.5 pl-3"
      >
        <div aria-hidden="true" className="now-playing-light" />
        <PlaybackTransport
          state={state}
          connected={connected}
          run={run}
          quiet
          className="now-transport relative"
        />
        <button
          type="button"
          aria-label={`Show player: ${title}`}
          title={title}
          onClick={() => resize("side")}
          className="relative flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full pr-2.5 text-left outline-none hover:bg-accent focus-visible:bg-foreground focus-visible:text-background"
        >
          {picture("h-11 shrink-0 rounded-lg", true)}
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
              {status ? statusLine : where(true)}
            </span>
          </span>
        </button>
        {!live && (
          <WhereItPlays state={state} connected={connected} run={run} className="relative" />
        )}
        <Button
          data-player-size
          data-player-last
          variant="ghost"
          size="icon-lg"
          className="relative"
          aria-label="Show player"
          title="Show player"
          onClick={() => resize("side")}
        >
          <PanelLeftOpen aria-hidden="true" />
        </Button>
        <Hairline state={state} />
      </aside>
    );

  // The dock: what plays and where on one line, the same transport line under it.
  return (
    <aside
      {...shell}
      className="now-playing now-dock relative mx-2 mb-1 grid gap-2 overflow-hidden rounded-3xl pt-2.5 pr-2 pb-2 pl-3"
    >
      <div aria-hidden="true" className="now-playing-light" />
      <div className="relative flex min-w-0 items-center gap-1">
        <button
          type="button"
          data-player-last
          aria-label={`Open player: ${title}`}
          title={title}
          onClick={() => onOpen()}
          className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:bg-foreground focus-visible:text-background"
        >
          {picture("h-11 shrink-0 rounded-lg", true)}
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="flex min-w-0 gap-2 text-xs text-muted-foreground">
              {status ? statusLine : where(true)}
            </span>
          </span>
        </button>
        {!live && <WhereItPlays state={state} connected={connected} run={run} />}
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
 * else the artwork. A pointer target that opens the player; the buttons beside it are the keyboard's way.
 */
function Picture({
  state,
  entry,
  title,
  thumbnail,
  small,
  onClick,
  className,
}: {
  state: ClientSessionState;
  entry: QueueEntry;
  title: string;
  thumbnail?: string;
  small: boolean;
  onClick: () => void;
  className: string;
}) {
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const video =
    showsPicture(state) &&
    !playback?.hostOnly &&
    !isAudioOnly(playback, entry, state.player.tracks);
  const into = useCallback(
    (element: HTMLDivElement | null) => (video ? renderInto(element) : undefined),
    [video],
  );
  const [measure, artRatio] = useArtRatio(thumbnail, isRadio(entry) ? 1 : 16 / 9);
  // A picture no taller than it is wide, so a square station's logo leaves the panel room.
  const ratio = video ? 16 / 9 : Math.max(1, artRatio);
  const paused = state.player.status === "paused";
  const content = video ? (
    <div ref={into} className="size-full" />
  ) : (
    <MediaArtwork thumbnail={thumbnail} title={title} className="size-full object-contain" />
  );
  const style = { aspectRatio: ratio } as CSSProperties;
  return (
    <button
      ref={video ? undefined : measure}
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onClick}
      style={style}
      className={cn(
        "relative block overflow-hidden bg-black motion-safe:transition-[filter] motion-safe:duration-500",
        paused && !small && "brightness-[.62] saturate-[.8]",
        className,
      )}
    >
      {content}
    </button>
  );
}

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

/** "2 playing" while several Playbacks run: it lists them, to choose the one this device controls. */
function PlayingCount({ state }: { state: ClientSessionState }) {
  const choices = playbackChoices(state);
  if (choices.length < 2) return null;
  return (
    <PlaybackPicker
      playbacks={choices}
      label={`${choices.length} playing. Choose which one you control`}
      className="ml-0.5 inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] outline-none hover:text-foreground focus-visible:bg-foreground focus-visible:text-background disabled:opacity-50"
    >
      {choices.length} playing
    </PlaybackPicker>
  );
}

/** The player's own Playback menu, for whatever plays, here or on another device. */
function PlaybackGear({ state, connected, run }: Omit<Props, "size" | "onOpen" | "onSize">) {
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

/**
 * Up next, as many of its first items as the panel has room for; each plays at once. Its heading opens the whole
 * list in the player, with its own verbs.
 */
function UpNext({
  state,
  connected,
  run,
  onOpen,
}: Omit<Props, "size" | "onOpen" | "onSize"> & { onOpen: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const entries = playbackControls(state).queue
    ? [...upcomingQueue(state), ...(state.autoplay?.enabled ? state.autoplay.upcoming : [])].slice(
        0,
        4,
      )
    : [];
  const ids = entries.map((entry) => entry.id).join(" ");
  // Rows that would be cut by the panel's foot wait unseen, as the prototype's do; none at all hides the list.
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const fit = () => {
      const rows = [...box.querySelectorAll<HTMLElement>("[data-up-next-row]")];
      for (const row of rows) row.hidden = false;
      const limit = box.getBoundingClientRect().bottom + 1;
      let shown = 0;
      for (const row of rows) {
        row.hidden = row.getBoundingClientRect().bottom > limit;
        if (!row.hidden) shown++;
      }
      box.style.visibility = rows.length && !shown ? "hidden" : "";
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    fit();
    return () => observer.disconnect();
  }, [ids]);
  const { available } = playbackCapabilities(state, connected);
  if (!entries.length) return <div className="flex-1" />;
  return (
    <div
      ref={list}
      className="mt-3.5 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border pt-2"
    >
      <Button
        variant="ghost"
        className="-mx-2 h-auto min-h-0 justify-start self-start px-2 py-1 font-heading text-sm font-semibold"
        onClick={onOpen}
      >
        Up next
      </Button>
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
