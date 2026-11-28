import {
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Time } from "@videojs/react";
import { SlidersVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FilterInput } from "@/components/ContentFilters";
import { MediaArtwork } from "@/components/MediaArtwork";
import { CompressorControls } from "@/components/CompressorControls";
import {
  LiveParticipation,
  PlaybackTimeline,
  PlaybackTransport,
  PlaybackVolume,
  toolPanel,
} from "@/components/PlaybackTransport";
import {
  busyWith,
  MixerColumns,
  MixerHeader,
  programmeStyle,
  useProgrammeColours,
  whyLocked,
  type Channel,
} from "@/components/MixerKeys";
import { livePlayback } from "@/session/playback-controls";
import { cn } from "@/lib/utils";
import { sounding } from "@/playback-status";
import { deviceId } from "@/session/device-id";
import { isTvPresentation } from "@/session/presentation";
import { SessionGateContext } from "@/session/gate-context";
import type { ClientSessionState } from "@/session/session";
import {
  arrange,
  chooserFor,
  chooserRequest,
  counts,
  crowded,
  offlineNames,
  orderOf,
  picker,
  reopens,
  soleSound,
  type Filter,
  type Order,
  type Row,
} from "@/session/where-it-plays";
import { isRadio } from "../../../shared/radio";
import type { Action, PlaybackSummary } from "../../../shared/protocol";
import { GroupChips, GroupsScope } from "./MixerGroups";
import { deviceRow, SyncScope, tvRow } from "./MixerRows";
import { ShellContext } from "./shell-context";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};
type Side = "popover" | "bottom";

// A mouse wider than a phone (Settings' own 48rem): there, as on the TV, the panel hangs from its button; a phone's
// rises from the bottom.
const desktopQuery = "(min-width: 48rem) and (pointer: fine)";
export const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
export const isDesktop = () => window.matchMedia(desktopQuery).matches;

type TriggerProps = {
  className?: string;
  label?: string;
  /** The trigger's own content (the side player's Where it plays box, the full player's pill), in place of its icon. */
  children?: ReactNode;
};

/**
 * Where it plays: the Mixer for one Couch's devices, opened from the player wherever it stands (the side player, its
 * capsule, the phone's dock, the full player). Its playback's title, the playbacks to choose between, the groups, then
 * every device's row, the playback's first, and the transport at its foot. The rules are the model's
 * (session/where-it-plays.ts).
 */
export function WhereItPlays(props: Props & TriggerProps) {
  return <Panel {...props} />;
}

// From the band or the bar its Popover opens above the whole row, clear of the timeline, as their menus do (toolPanel).
function Panel({ state, connected, run, className, label, children }: Props & TriggerProps) {
  const button = useRef<HTMLButtonElement>(null);
  const tv = isTvPresentation();
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  // Radix's controlled open state: a changed defaultOpen would not open a mounted panel. The session remembers the
  // closed request, so Now playing and the full player each open it at most once. Core's request opens every
  // window viewing the playback; this window's own request opens only here.
  const gate = useContext(SessionGateContext);
  const [opened, setOpened] = useState(false);
  const requested = chooserFor(
    chooserRequest(state),
    state.playback ?? null,
    gate?.requestedChooser,
  );
  const open = opened || reopens(gate?.dismissedChooser ?? null, requested);
  // Taken as it opens: rows keep their order and the panel its kind until it closes.
  const [view, setView] = useState<{ order: Order; side: Side } | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const rows = picker(state, { here: deviceId() }).rows;
  const fresh = () => ({
    order: orderOf(rows),
    side: (tv || desktop ? "popover" : "bottom") as Side,
  });
  // A new playback starts closed, with its own order, unless the Mixer's own tabs chose it: then it stays open on it.
  const [shown, setShown] = useState(state.playback);
  const [picked, setPicked] = useState<string | null>(null);
  if (shown !== state.playback) {
    setShown(state.playback);
    setPicked(null);
    setFilter(null);
    setQuery("");
    if (picked && picked === state.playback) setView(fresh());
    else {
      setOpened(false);
      setView(null);
    }
  }
  if (open && !view) setView(fresh());
  const side = view?.side ?? fresh().side;
  const change = (next: boolean) => {
    setOpened(next);
    if (next) return;
    if (requested) gate?.dismissChooser(requested);
    setView(null);
    setFilter(null);
    setQuery("");
  };
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
  const closeButton = (
    <Button
      variant="ghost"
      size="icon-lg"
      className="-mr-2.5 size-11 shrink-0"
      aria-label="Close"
      title="Close"
      onClick={() => change(false)}
    >
      <X aria-hidden="true" />
    </Button>
  );
  const body = (close: ReactNode) => (
    <GroupsScope state={state} connected={connected} close={close}>
      <Mixer
        state={state}
        connected={connected}
        run={run}
        tv={tv}
        order={view?.order}
        filter={filter}
        query={query}
        onFilter={setFilter}
        onQuery={setQuery}
        onPick={setPicked}
        close={close}
      />
    </GroupsScope>
  );
  // It opens on the first device on the TV, else on the Volume, never on a control that changes where it plays.
  const focusFirst = (event: Event) => {
    const target = (event.currentTarget as HTMLElement).querySelector<HTMLElement>(
      tv ? "[data-device-row]" : '[aria-label="Volume"] [role="slider"], [data-device-row]',
    );
    if (target) {
      event.preventDefault();
      target.focus({ preventScroll: true });
    }
  };
  if (side === "popover")
    return (
      <Popover open={open} onOpenChange={change}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        {/* The rows scroll between the title and the transport, so both stay put on one surface. */}
        {open && (
          <PopoverContent
            {...toolPanel(button.current)}
            aria-label="Where it plays"
            onOpenAutoFocus={focusFirst}
            className="max-h-[min(48rem,calc(var(--radix-popover-content-available-height)-var(--player-top,0px)-1rem))] w-[min(36rem,calc(100vw-2rem))] gap-0 overflow-hidden px-4 pt-4 pb-3"
          >
            <SyncScope>{body(closeButton)}</SyncScope>
          </PopoverContent>
        )}
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onOpenAutoFocus={focusFirst}
        showCloseButton={false}
        className="max-h-[92dvh] items-center gap-0 overflow-hidden px-(--gutter) pt-4 pb-4"
      >
        <SheetTitle className="sr-only">Where it plays</SheetTitle>
        <SyncScope>
          <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col bg-inherit">
            {body(closeButton)}
          </div>
        </SyncScope>
      </SheetContent>
    </Sheet>
  );
}

type MixerProps = Props & {
  tv?: boolean;
  order?: Order;
  filter?: Filter | null;
  query?: string;
  onFilter?: (filter: Filter | null) => void;
  onQuery?: (query: string) => void;
  onPick?: (playbackId: string) => void;
  close: ReactNode;
};

/** "Living room TV and this device", in a tab's second line. */
const whereNames = (state: ClientSessionState, playback: PlaybackSummary) => {
  const names = playback.outputs.map((output) =>
    output.deviceId === deviceId()
      ? "this device"
      : (state.devices?.find((device) => device.id === output.deviceId)?.name ?? "a device"),
  );
  const where = names.length
    ? new Intl.ListFormat("en", { type: "conjunction" }).format(names)
    : "Not on any device";
  return playback.status === "paused" ? `Paused, ${where}` : where;
};

/**
 * One tab per playback this device may control, while there are several: its picture, title and where it plays, the
 * one the Mixer changes outlined in its colour. Choosing one makes it the playback this window controls.
 */
function PlaybackTabs({
  state,
  connected,
  run,
  colour,
  onPick,
}: Props & {
  colour: (id: string) => string | undefined;
  onPick?: (playbackId: string) => void;
}) {
  const shell = useContext(ShellContext);
  const playbacks =
    state.playbacks?.filter(
      (playback) => playback.id === state.playback || (playback.running && !playback.private),
    ) ?? [];
  if (playbacks.length < 2) return null;
  return (
    <div
      data-nav-row
      role="group"
      aria-label="Playing now"
      className="flex shrink-0 gap-2 pb-3 max-sm:flex-col"
    >
      {playbacks.map((playback) => (
        <button
          key={playback.id}
          type="button"
          aria-pressed={playback.id === state.playback}
          disabled={!connected}
          onClick={() => {
            if (playback.id === state.playback) return;
            onPick?.(playback.id);
            // The shell's own picker keeps the page, as the player's "on {device}" does.
            if (shell) void shell.selectPlayback(playback.id);
            else void run({ type: "selectPlayback", playbackId: playback.id });
          }}
          style={{ "--tab": colour(playback.id) } as CSSProperties}
          className="flex min-w-0 flex-1 basis-0 items-center gap-2.5 rounded-lg py-1.5 pr-3 pl-1.5 text-left text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)] hover:bg-accent disabled:opacity-50 aria-pressed:bg-[color-mix(in_oklab,var(--tab)_22%,transparent)] aria-pressed:text-foreground aria-pressed:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--tab)_70%,white)] max-sm:basis-auto"
        >
          <MediaArtwork
            thumbnail={playback.thumbnail}
            title={playback.title ?? ""}
            className="aspect-video h-9 w-auto max-w-16 shrink-0 rounded-md object-cover [&:is(img)]:aspect-auto"
          />
          <span className="grid min-w-0">
            <span className="truncate text-meta font-semibold">{playback.title}</span>
            <span className="truncate text-caption text-muted-foreground">
              {whereNames(state, playback)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The Mixer's foot: the timeline, then Play/Pause, Next, Stop, the Volume and the time, as at the player's foot. */
function MixerTransport({ state, connected, run }: Props) {
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const timed = !!current && !current.endless && !isRadio(current) && !!current.duration;
  return (
    // Play/Pause leads as a round white key and Stop wears its own fill, as at the player's foot.
    <div className="-mx-4 grid shrink-0 gap-1 border-t px-4 pt-2 [&_[aria-label=Stop]]:bg-secondary [&_[data-play-button]]:mr-1 [&_[data-play-button]]:size-11 [&_[data-play-button]]:bg-foreground [&_[data-play-button]]:text-background [&_[data-play-button]_svg]:opacity-100 [&_[data-time-labels]]:hidden">
      <PlaybackTimeline state={state} connected={connected} />
      <div data-nav-row className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <PlaybackTransport state={state} connected={connected} run={run} quiet />
        <PlaybackVolume
          state={state}
          connected={connected}
          run={run}
          showValue={false}
          className="max-w-44 min-w-32 flex-1"
        />
        {timed && (
          <span className="text-meta whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
            <Time.Value type="current" /> / <Time.Value type="duration" />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The panel's content: the title, the playbacks' tabs, then (scrolling) a shared source's "Choose where {title}
 * plays", the groups, the column heads and the rows, the playback's devices first and the rest after a hairline,
 * offline ones folded into one line, In sync and the Compressor; the transport stays at the foot.
 */
function Mixer({
  state,
  connected,
  run,
  tv = false,
  order,
  filter = null,
  query = "",
  onFilter,
  onQuery,
  onPick,
  close,
}: MixerProps) {
  const colours = useProgrammeColours(state.playbacks);
  const [why, setWhy] = useState<{ id: string; channel: Channel } | null>(null);
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const header = (
    <>
      <MixerHeader
        heading="Where it plays"
        title={current?.title ?? playback?.title}
        thumbnail={playback?.thumbnail ?? current?.thumbnail}
        close={close}
      />
      <PlaybackTabs
        state={state}
        connected={connected}
        run={run}
        colour={colours}
        onPick={onPick}
      />
    </>
  );
  if (livePlayback(state)) {
    return (
      <div className="grid gap-3" style={programmeStyle(colours(state.playback))}>
        {header}
        <PlaybackVolume state={state} connected={connected} run={run} />
        <LiveParticipation state={state} connected={connected} run={run} />
      </div>
    );
  }
  const { choose, inSync, rows } = picker(state, { here: deviceId() });
  // The filter and search apply only while their controls show: a device going offline or a count clearing drops them.
  const summary = counts(rows),
    many = arrange(rows, order).listed > crowded;
  const offered = many && summary.some((item) => item.filter === filter) ? filter : null;
  const { playing, rest, offline } = arrange(rows, order, offered, many ? query : "");
  // One device sounding: the Volume at the foot is its level, so its row doesn't repeat the fader.
  const sole = soleSound(rows);
  const sounds = sounding(state, connected);
  const canCompress =
    !state.outputs?.length ||
    state.outputs.some((output) => {
      const sharing = state.devices?.find((device) => device.id === output.deviceId)?.sharing;
      return (
        output.deviceId === deviceId() ||
        ((!output.picture || sharing?.video) && (!output.sound || sharing?.audio))
      );
    });
  const whyOf = (item: Row) => {
    if (why?.id !== item.device.id) return undefined;
    const reason = item[why.channel].reason;
    return (
      reason && { text: whyLocked(item.device, why.channel, reason), offline: reason === "Offline" }
    );
  };
  const shared = {
    connected,
    run,
    playing: sounds,
    dot: (item: Row) => {
      const busy = !item.output && busyWith(state.playbacks, item.device.id, state.playback);
      return busy && item.status.includes("Playing") ? colours(busy.id) : undefined;
    },
    onWhy: (item: Row, channel: Channel) =>
      setWhy((was) =>
        was?.id === item.device.id && was.channel === channel
          ? null
          : { id: item.device.id, channel },
      ),
  };
  const row = (item: Row) =>
    tv
      ? tvRow({ ...shared, row: item, why: whyOf(item) })
      : deviceRow({ ...shared, row: item, fader: item.device.id !== sole, why: whyOf(item) });
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={programmeStyle(colours(state.playback))}>
      {header}
      {/* Room at the sides for the controls that pull back past the text ("…", Move here) and their focus. */}
      <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
        {choose && <p className="pb-3 text-body [overflow-wrap:anywhere]">{choose}</p>}
        <GroupChips
          state={state}
          connected={connected}
          rows={rows}
          title={playback?.title ?? current?.title}
        />
        {many && (
          <div className="grid gap-1 pb-2">
            <ToggleGroup
              data-nav-row
              type="single"
              aria-label="Show"
              spacing={1}
              value={offered ?? ""}
              onValueChange={(next) => onFilter?.(next ? (next as Filter) : null)}
              className="-ml-2 max-w-full flex-wrap"
            >
              {summary.map((item) => (
                <ToggleGroupItem
                  key={item.filter}
                  value={item.filter}
                  className="rounded-none border-b-2 border-transparent px-2 font-normal text-muted-foreground data-[state=on]:border-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground"
                >
                  {item.label} <span className="tabular-nums">{item.count}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div data-nav-row className="flex pt-1">
              <FilterInput
                label="Find a device"
                placeholder="Find a device"
                value={query}
                onChange={(value) => onQuery?.(value)}
                className="sm:max-w-none"
              />
            </div>
          </div>
        )}
        <MixerColumns volume />
        {playing.length > 0 && (
          <ul aria-label="Playing" className="grid">
            {playing.map(row)}
          </ul>
        )}
        {rest.length > 0 && (
          <ul
            aria-label="Not playing"
            className={cn("grid", playing.length > 0 && "mt-1.5 border-t pt-1.5")}
          >
            {rest.map(row)}
          </ul>
        )}
        {offline.length > 0 && (
          <p className="mt-1.5 border-t pt-2.5 text-meta text-muted-foreground [overflow-wrap:anywhere]">
            Offline: {offlineNames(offline)}
          </p>
        )}
        {many && !playing.length && !rest.length && !offline.length && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
            <p role="status" className="text-sm text-muted-foreground">
              No devices match.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                onFilter?.(null);
                onQuery?.("");
                event.currentTarget
                  .closest('[data-slot="popover-content"], [data-slot="sheet-content"]')
                  ?.querySelector<HTMLInputElement>('input[aria-label="Find a device"]')
                  ?.focus();
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {(inSync !== undefined || (state.compressor && state.player.playbackId)) && (
          <div className="mt-2.5 border-t pt-1">
            {inSync !== undefined && (
              <div data-nav-row className="flex min-h-11 items-center justify-between gap-4">
                <Label htmlFor="where-it-plays-in-sync" className="text-base font-normal">
                  In sync
                </Label>
                <Switch
                  id="where-it-plays-in-sync"
                  checked={inSync}
                  disabled={!connected}
                  onCheckedChange={(on) => void run({ type: "inSync", inSync: on })}
                />
              </div>
            )}
            {state.compressor && state.player.playbackId && (
              <CompressorControls
                key={state.playback}
                settings={state.compressor}
                playbackId={state.player.playbackId}
                run={run}
                unavailable={
                  !connected
                    ? "Reconnect to change the compressor."
                    : !canCompress
                      ? "This playback is private."
                      : current?.liveSourceId
                        ? "Unavailable for live sharing."
                        : undefined
                }
              />
            )}
          </div>
        )}
      </div>
      <MixerTransport state={state} connected={connected} run={run} />
    </div>
  );
}
