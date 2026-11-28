import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FilterInput } from "@/components/ContentFilters";
import { busyWith } from "@/components/MixerKeys";
import { cn } from "@/lib/utils";
import { sounding } from "@/playback-status";
import { deviceId } from "@/session/device-id";
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
import type { Action } from "../../../shared/protocol";
import { Advanced } from "./DeskAdvanced";
import { DeskRow, Folds } from "./DeskRows";
import { GroupChips, GroupsScope } from "./MixerGroups";

type Props = {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
};

/**
 * Whether the desk's list is open: as this window left it, and open again for each new request to choose where a
 * shared source plays (Core's, or this window's own after Play on its publisher). Closing it dismisses the request.
 */
export function useWhereOpen(state: ClientSessionState) {
  const gate = useContext(SessionGateContext);
  const [opened, setOpened] = useState(false);
  const requested = chooserFor(
    chooserRequest(state),
    state.playback ?? null,
    gate?.requestedChooser,
  );
  const open = opened || reopens(gate?.dismissedChooser ?? null, requested);
  // A new playback starts folded.
  const [shown, setShown] = useState(state.playback);
  if (shown !== state.playback) {
    setShown(state.playback);
    setOpened(false);
  }
  const set = (next: boolean) => {
    setOpened(next);
    if (!next && requested) gate?.dismissChooser(requested);
  };
  return [open, set] as const;
}

/** A device out of the list: offline, or lending nothing that could play this now (private to someone else). */
const folded = (row: Row) =>
  row.output
    ? null
    : !row.device.online
      ? "offline"
      : !row.mine &&
          !row.picture.enabled &&
          !row.sound.enabled &&
          (row.picture.reason === "Private" || row.sound.reason === "Private")
        ? "private"
        : null;

/**
 * Where it plays, the desk's upper part. Folded, this device first, then every device that plays what is in view (every
 * device while there are four or fewer). Open, in place: the groups, the same rows, "Other devices", the devices folded
 * into "Private now" and "Offline", then Advanced. Its handle says "5 of 14 devices"; Escape folds it.
 */
export function WhereList({
  state,
  connected,
  run,
  open,
  onOpen,
  heading = "Where it plays",
  fixed = false,
  extra,
}: Props & {
  open: boolean;
  onOpen: (open: boolean) => void;
  heading?: string;
  /** A phone's sheet: always whole, its handle only words. */
  fixed?: boolean;
  /** Rows after the playback's devices (Live audio's guests). */
  extra?: ReactNode;
}) {
  const here = deviceId();
  const { inSync, rows } = picker(state, { here });
  // Rows keep their order while it is open, so nothing jumps under a press; it is taken again as it opens or folds.
  const [order, setOrder] = useState<Order | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  const [was, setWas] = useState({ open, playback: state.playback });
  if (was.open !== open || was.playback !== state.playback) {
    setWas({ open, playback: state.playback });
    setOrder(null);
    setDetails(null);
    setFinding(false);
    setFilter(null);
    setQuery("");
  }
  const kept = order ?? orderOf(rows);
  if (!order && open) setOrder(kept);
  const whole = open || fixed;
  const listed = arrange(rows, kept).listed;
  const many = whole && listed > crowded;
  const summary = counts(rows);
  const offered = many && summary.some((item) => item.filter === filter) ? filter : null;
  // The rows, folds and "No devices match" all show what Find and its filters leave.
  const { playing, rest, offline } = arrange(rows, kept, offered, many ? query : "");
  const shown = [...playing, ...rest];
  const mine = rows.find((row) => row.mine);
  const playback = state.playbacks?.find((item) => item.id === state.playback);
  const publisher = mine?.picture.reason === "Sharing this source";
  const first = mine && !publisher && !folded(mine) && shown.includes(mine) ? [mine] : [];
  const top = [...first, ...shown.filter((row) => row.output && !row.mine && !folded(row))];
  const others = shown.filter((row) => !row.output && !row.mine && !folded(row));
  const small = rows.filter((row) => !folded(row)).length <= 4;
  const privately = shown.filter((row) => folded(row) === "private");
  const sole = soleSound(rows);
  const sounds = sounding(state, connected);
  const audioOnly = !!playback?.audioOnly;
  const count = (state.outputs ?? []).length;
  const fold = () => onOpen(!open);
  const row = (item: Row) => (
    <DeskRow
      key={item.device.id}
      row={item}
      busy={busyWith(state.playbacks, item.device.id, state.playback)}
      sounding={sounds}
      sole={item.device.id === sole}
      audioOnly={audioOnly}
      others={(state.outputs ?? []).filter((output) => output.deviceId !== item.device.id).length}
      open={details === item.device.id}
      onOpen={() => setDetails((id) => (id === item.device.id ? null : item.device.id))}
    />
  );
  const nothing = !count && !extra && (
    <p className="pt-2 pb-3 text-meta text-subtle-foreground">
      {state.queue.find((entry) => entry.id === state.currentEntryId)?.liveSourceId
        ? "On no screens yet. Turn on a screen or speakers below, or leave it in Shared sources for people to play."
        : "Not on any device. Turn one on below."}
    </p>
  );
  const find = many && (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={finding || !!offered || !!query}
      aria-label="Find a device"
      title="Find a device"
      onClick={() => {
        const next = !(finding || offered || query);
        setFinding(next);
        if (!next) {
          setFilter(null);
          setQuery("");
        }
      }}
      className="size-7 aria-pressed:bg-(--fill-2)"
    >
      <Search aria-hidden="true" className="size-4" />
    </Button>
  );
  const handle = fixed ? (
    <div className="flex h-10 shrink-0 items-center gap-1 text-meta">
      <span className="min-w-0 flex-1 font-semibold text-muted-foreground">{heading}</span>
      {find}
      <span className="text-subtle-foreground">
        {count} of {rows.length} devices
      </span>
    </div>
  ) : (
    <div className="-mx-2 flex h-10 shrink-0 items-center gap-1 text-meta">
      <button
        type="button"
        aria-expanded={open}
        onClick={fold}
        className="flex h-8 min-w-0 flex-1 items-center rounded-full px-2 text-left font-semibold text-muted-foreground outline-none hover:bg-(--fill) hover:text-foreground"
      >
        {heading}
      </button>
      {find}
      <button
        type="button"
        aria-label={open ? "Show fewer devices" : "Show all devices"}
        title={open ? "Show fewer devices" : "Show all devices"}
        onClick={fold}
        className="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 whitespace-nowrap text-subtle-foreground outline-none hover:bg-(--fill) hover:text-foreground"
      >
        {count} of {rows.length} devices
        {open ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronUp aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  );
  if (!whole)
    return (
      <>
        {handle}
        <Scroller key="folded" rows={top.length + (small ? others.length : 0)}>
          <ul aria-label="Playing" className="grid">
            {top.map(row)}
            {extra}
            {small && others.map(row)}
          </ul>
        </Scroller>
      </>
    );
  return (
    <>
      {handle}
      <Scroller key="whole" rows={3} whole>
        <GroupsScope state={state} connected={connected}>
          {many && (finding || offered || query) && (
            <div className="grid gap-1.5 pb-2.5">
              <div data-nav-row className="flex">
                <FilterInput
                  label="Find a device"
                  placeholder="Find a device"
                  value={query}
                  onChange={setQuery}
                  className="sm:max-w-none"
                />
              </div>
              <ToggleGroup
                data-nav-row
                type="single"
                aria-label="Show"
                spacing={1}
                value={offered ?? ""}
                onValueChange={(next) => setFilter(next ? (next as Filter) : null)}
                className="-ml-1.5 max-w-full flex-wrap"
              >
                {summary.map((item) => (
                  <ToggleGroupItem
                    key={item.filter}
                    value={item.filter}
                    className="h-7 rounded-md border-b-2 border-transparent px-1.5 text-meta font-normal text-subtle-foreground data-[state=on]:border-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground"
                  >
                    {item.label}{" "}
                    <span className="font-medium text-muted-foreground">{item.count}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
          {!extra && !publisher && (
            <GroupChips state={state} connected={connected} rows={rows} title={playback?.title} />
          )}
          <ul aria-label="Playing" className="grid">
            {nothing}
            {top.map(row)}
            {extra}
          </ul>
          {others.length > 0 && (
            <>
              <h4 className="mt-2 flex h-9 items-end border-t pb-1.5 text-caption text-subtle-foreground">
                {extra ? "Add speakers" : "Other devices"}
              </h4>
              <ul aria-label="Not playing" className="grid">
                {others.map(row)}
              </ul>
            </>
          )}
          <Folds
            folds={[
              { label: "Private now", names: offlineNames(privately) },
              { label: "Offline", names: offlineNames(offline) },
            ]}
          />
          {many &&
            !top.length &&
            !others.length &&
            !privately.length &&
            !offline.length &&
            (offered || query) && (
              <p role="status" className="pt-2 text-meta text-subtle-foreground">
                No devices match.{" "}
                <button
                  type="button"
                  className="text-muted-foreground underline underline-offset-4"
                  onClick={() => {
                    setFilter(null);
                    setQuery("");
                  }}
                >
                  Clear
                </button>
              </p>
            )}
          {!extra && (
            <Advanced state={state} connected={connected} run={run} inSync={inSync} rows={rows} />
          )}
        </GroupsScope>
      </Scroller>
    </>
  );
}

/**
 * The rows' own scroll: every row while they fit, else at least four (or, opened, three) and the rest by scrolling,
 * softly cut where they go on. Where even those don't fit, they stick out of the column, which the side player reads
 * as its cue to set the picture beside its title.
 */
function Scroller({
  rows,
  whole = false,
  children,
}: {
  rows: number;
  whole?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const cut = () => {
      const more = element.scrollHeight - element.scrollTop - element.clientHeight > 2;
      element.dataset.cut = more ? "end" : "";
    };
    const observer = new ResizeObserver(cut);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", cut, { passive: true });
    cut();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", cut);
    };
  });
  return (
    <div
      ref={box}
      data-where-list={whole ? "whole" : ""}
      style={{
        minHeight: `calc(${Math.min(whole ? rows : 4, rows)} * var(--desk-row))`,
      }}
      className={cn(
        "-mx-2 min-h-0 shrink overflow-y-auto overscroll-contain px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {children}
    </div>
  );
}
