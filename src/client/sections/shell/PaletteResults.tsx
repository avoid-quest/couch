import { useCallback, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { CommandItem } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { MediaArtwork } from "@/components/MediaArtwork";
import { usePlayOn } from "@/components/PlayOn";
import { metaLine } from "@/media-caption";
import { cn } from "@/lib/utils";
import { startHold } from "@/hold";
import { canReturn, searchRelevance, type SearchKind } from "@/search";
import type { SearchScope } from "@/search-palette";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import {
  SearchOnlineResults,
  type SearchHit,
  type SearchResultSummary,
} from "@/sections/find/SearchOnlineResults";
import {
  hitMeta,
  names,
  quickSources,
  shapeOf,
  useSourceHits,
  useTopHit,
} from "@/sections/find/search-hits";
import { providerNames, type ProviderId } from "../../../shared/providers";

// While typing, the palette asks only the quick sources, never one that takes a yt-dlp slot from playback; See all
// results asks the rest. A source the person chose is asked whatever it is, since it's the only one, and so are a
// kind's own where no quick source leads it: the catalogues for films and series, and YouTube beside Twitch for videos
// (an exact YouTube channel then outranks a fan's Twitch channel for the top row).
const allProviders = Object.keys(providerNames) as ProviderId[];
const kindSources: Partial<Record<SearchKind, string[]>> = {
  films: ["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity", "RaiPlay"],
  videos: ["YouTube", "Twitch"],
};
function paletteSources(scope: SearchScope) {
  if (scope.source !== "All") return [scope.source];
  return (scope.kind && kindSources[scope.kind]) || quickSources;
}
// A source's first few hits keep the palette a glance, and hold an artist's top four songs, as Spotify leads with.
const perSource = 4;
// The sources are asked once typing pauses a quarter second, from three characters, so a word in progress asks nobody.
const pause = 250;
const shortest = 3;

/** The verbs a row's menu offers in the palette besides its main one, in this order. */
const menuVerbs = ["Play", "Play all", "Play next", "Queue", "Queue all", "Open", "Details"];
export const rowMenu = (hit: SearchHit) =>
  hit.actions
    .filter(
      (action) =>
        menuVerbs.includes(action.label) && action.label !== hit.primary.label && action.run,
    )
    .sort((a, b) => menuVerbs.indexOf(a.label) - menuVerbs.indexOf(b.label));

/**
 * The palette's remote tier: the fast sources' hits for what's typed, each source a section in the order it answered,
 * each recording once, and the strongest match as the top row, held once the selection moves (`moved`). The sources
 * report through SearchOnlineResults, so See all results opens on what the palette already has.
 */
export function usePaletteHits(text: string, scope: SearchScope, moved: boolean) {
  const shell = useShell();
  const { connected, credentials, run, videoQualityPreference } = useSessionGate();
  // As typed, so a space after the last word finishes it (searchRelevance).
  const [typed] = useDebouncedValue(text, { wait: pause });
  const settled = typed.trim();
  const query = settled.length >= shortest ? settled : "";
  const providers = query
    ? allProviders.filter(
        (provider) =>
          paletteSources(scope).includes(providerNames[provider]) &&
          canReturn(providerNames[provider], scope.kind),
      )
    : [];
  const [reported, setReported] = useState<Record<string, SearchResultSummary>>({});
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    setReported({});
  }
  const report = useCallback(
    (source: string, summary: SearchResultSummary) =>
      setReported((current) => ({ ...current, [source]: summary })),
    [],
  );
  const asked = providers.map((provider) => providerNames[provider]);
  const summaries = Object.fromEntries(
    Object.entries(reported).filter(([source]) => asked.includes(source)),
  );
  const key = JSON.stringify([query, scope]);
  const { order, within } = useSourceHits(key, summaries, query);
  // Only what names every word of the query in its title, artist or album, in the chosen kind and source as the results
  // show them, so the palette stays a glance and Enter never plays what the scope left out.
  const { close } = searchRelevance(typed, true);
  const relevant = within(scope.source, scope.kind).filter(close);
  const asking = asked.filter((source) => !summaries[source] || summaries[source].loading);
  const top = useTopHit(key, relevant, typed, asking.length > 0, moved, true);
  const sections = order
    .map((source) => ({
      source,
      hits: relevant.filter((hit) => hit !== top && hit.source === source).slice(0, perSource),
    }))
    .filter((section) => section.hits.length);
  const sources = credentials
    ? providers.map((provider) => (
        <SearchOnlineResults
          key={`${provider}:${query}`}
          origin={credentials.origin}
          token={credentials.token}
          connected={connected}
          canPlay={shell.available}
          active={false}
          onCommand={run}
          onOpenCollection={shell.openProvider}
          onResults={report}
          provider={provider}
          query={query}
          quality={videoQualityPreference?.quality ?? "auto"}
          onEnqueued={() => {}}
        />
      ))
    : [];
  return {
    query,
    typed,
    top,
    sections,
    hits: relevant,
    asking,
    failed: asked.filter((source) => summaries[source]?.error),
    sources,
  };
}

function Art({ hit, className }: { hit: SearchHit; className?: string }) {
  return (
    <MediaArtwork
      thumbnail={hit.thumbnail}
      title={hit.title}
      collection={!!hit.collection && hit.collection !== "Album"}
      className={cn(
        "w-auto shrink-0 object-cover",
        shapeOf(hit) === "round" ? "aspect-square rounded-full" : "rounded-sm",
        shapeOf(hit) === "video" ? "aspect-video" : "aspect-square",
        className,
      )}
    />
  );
}

/** A touch screen's "…" on a row: it opens the row's menu, as → does on a keyboard. */
function MoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`More for ${label}`}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onPress();
      }}
      className="-my-1 ml-auto hidden size-11 shrink-0 place-items-center rounded-full text-muted-foreground touch:grid tv:hidden"
    >
      <Ellipsis aria-hidden="true" className="size-5" />
    </button>
  );
}

/** The verbs in a row's menu, under it and indented to its title. */
function MenuRows({
  hit,
  indent,
  onRun,
}: {
  hit: SearchHit;
  indent: string;
  onRun: (run: () => void) => void;
}) {
  const { on } = usePlayOn();
  return rowMenu(hit).map((action) => (
    <CommandItem
      key={action.label}
      value={`menu:${hit.id}:${action.label}`}
      disabled={action.disabled}
      onSelect={() => onRun(action.run!)}
      className={indent}
    >
      {action.label === "Play" ? on("Play") : action.label}
    </CommandItem>
  ));
}

/**
 * A row's menu by right-click or a long press, as every item's (RowMenu's useItemMenu); the click a long press ends in
 * doesn't also press the row. Android's own contextmenu during a long press opens it only once.
 */
function useRowHold(onMenu: () => void) {
  const press = useRef<{ release: () => boolean; x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    press.current?.release();
    press.current = null;
  };
  return {
    className: "select-none [-webkit-touch-callout:none]",
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      const opened = held.current;
      if (press.current) held.current = true;
      cancel();
      if (!opened) onMenu();
    },
    onPointerDown: (event: PointerEvent) => {
      held.current = false;
      if (event.pointerType !== "touch") return;
      press.current = {
        ...startHold(() => {
          held.current = true;
          onMenu();
        }),
        x: event.clientX,
        y: event.clientY,
      };
    },
    onPointerMove: (event: PointerEvent) => {
      if (
        press.current &&
        Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!held.current) return;
      event.preventDefault();
      event.stopPropagation();
      held.current = false;
    },
  };
}

/**
 * A source's hit as a palette row: its artwork, its title over one meta line. Enter does its main verb (Play, or Open
 * for a film, series or list); its menu (→, "…" on a touch screen, right-click or a long press) opens under it. The top
 * row is a size larger.
 */
export function HitRow({
  hit,
  large = false,
  menu,
  onMenu,
  onRun,
}: {
  hit: SearchHit;
  large?: boolean;
  menu: boolean;
  onMenu: () => void;
  onRun: (run: () => void) => void;
}) {
  const { className, ...hold } = useRowHold(onMenu);
  const menuable = rowMenu(hit).length > 0;
  // With its main verb unavailable, a row with a menu stays selectable, dimmed, for the menu's Queue.
  const unavailable = hit.primary.disabled;
  return (
    <>
      <CommandItem
        value={`hit:${hit.id}`}
        disabled={unavailable && !menuable}
        onSelect={() => {
          if (!unavailable) onRun(hit.primary.run);
        }}
        {...(menuable ? hold : {})}
        className={cn("gap-3", large && "py-2", menuable && className)}
      >
        <Art
          hit={hit}
          className={cn(large ? "h-14" : "h-10", unavailable && menuable && "opacity-50")}
        />
        <span className={cn("grid min-w-0 flex-1", unavailable && menuable && "opacity-50")}>
          <span className={cn("truncate", large ? "text-title font-medium" : "text-body")}>
            {hit.title}
          </span>
          <span className="truncate text-meta text-muted-foreground tv:text-sm">
            {large ? metaLine(hitMeta(hit), hit.source) : hitMeta(hit)}
          </span>
        </span>
        {menuable && <MoreButton label={hit.title} onPress={onMenu} />}
      </CommandItem>
      {menu && (
        <MenuRows hit={hit} onRun={onRun} indent={large ? "pl-[4.75rem]" : "pl-[3.875rem]"} />
      )}
    </>
  );
}

/**
 * The TV's top row: the closest match as a hero, its main verb selected first, then Queue and "…" on one line that
 * Left and Right move along. Its menu opens under it.
 */
export function TopHero({
  hit,
  menu,
  onMenu,
  onRun,
}: {
  hit: SearchHit;
  menu: boolean;
  onMenu: () => void;
  onRun: (run: () => void) => void;
}) {
  const { on } = usePlayOn();
  const queue = hit.actions.find((action) => action.label.startsWith("Queue") && action.run);
  const verb = "min-h-12! rounded-full px-6 text-lg";
  return (
    <>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-x-8 px-2 pb-4">
        <Art hit={hit} className="h-48 shadow-(--object-shadow)" />
        <div className="grid min-w-0 gap-3">
          <p className="font-display text-4xl leading-tight font-semibold tracking-tight">
            {hit.title}
          </p>
          <p className="text-base text-muted-foreground">{metaLine(hitMeta(hit), hit.source)}</p>
          <div className="flex gap-2">
            <CommandItem
              value="top:main"
              disabled={hit.primary.disabled}
              onSelect={() => onRun(hit.primary.run)}
              className={cn(verb, "bg-secondary")}
            >
              {hit.primary.label === "Play" ? on("Play") : hit.primary.label}
            </CommandItem>
            {queue && (
              <CommandItem
                value="top:queue"
                disabled={queue.disabled}
                onSelect={() => onRun(queue.run!)}
                className={verb}
              >
                {queue.label}
              </CommandItem>
            )}
            {rowMenu(hit).length > 0 && (
              <CommandItem value="top:more" aria-label="More" onSelect={onMenu} className={verb}>
                <Ellipsis aria-hidden="true" className="size-6!" />
              </CommandItem>
            )}
          </div>
        </div>
      </div>
      {menu && <MenuRows hit={hit} onRun={onRun} indent="pl-4" />}
    </>
  );
}

/**
 * The palette's foot: which fast sources are still answering or didn't, in one quiet line, and on a screen with a
 * pointer the keys for the selected row.
 */
export function PaletteFoot({
  asking,
  failed,
  keys,
}: {
  asking: string[];
  failed: string[];
  keys?: { enter: string; queue?: string; menu: boolean };
}) {
  const status = [
    asking.length > 0 && `Searching ${names(asking)}…`,
    failed.length > 0 && `${names(failed)} didn't answer.`,
  ].filter(Boolean);
  const key = (label: ReactNode, verb: string) => (
    <span className="flex items-center gap-1">
      {label} {verb}
    </span>
  );
  if (!status.length && !keys) return null;
  return (
    <div
      className={cn(
        "sticky -bottom-2 mt-1 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t bg-popover px-2.5 pt-2 pb-3 text-caption text-muted-foreground touch:bg-background tv:bg-background tv:text-sm",
        // Only a screen with a pointer shows the keys; elsewhere the foot is there only while it has a status.
        status.length ? "flex" : "hidden pointer-fine:flex touch:hidden tv:hidden",
      )}
    >
      <span role="status" className="flex min-w-0 items-center gap-1.5">
        {asking.length > 0 && <Spinner aria-hidden="true" className="size-3" />}
        {status.join(" ")}
      </span>
      {keys && (
        <span
          aria-hidden="true"
          className="hidden items-center gap-3 pointer-fine:flex touch:hidden tv:hidden"
        >
          {key(<Kbd>Enter</Kbd>, keys.enter)}
          {keys.queue &&
            key(
              <>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd>
              </>,
              keys.queue,
            )}
          {keys.menu && key(<Kbd>→</Kbd>, "More")}
        </span>
      )}
    </div>
  );
}
