import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { playbackStatus } from "@/playback-status";
import { useOptionalSessionGate } from "@/session/session-context";
import { MediaContext, useRelatedMenu } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import {
  canReturn,
  linkOf,
  searchLocation,
  searchRelevance,
  type SearchRouteState,
} from "../../search";
import {
  chipScopes,
  chooseScope,
  hasScope,
  isChosen,
  scopeLabels,
  type SearchScope,
} from "../../search-palette";
import {
  memo,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { isTvPresentation } from "@/session/presentation";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TryAgain } from "@/components/TryAgain";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayPill, usePlayOn } from "@/components/PlayOn";
import type { Action, PlayOn } from "../../../shared/protocol";
import { browserActions } from "@/original-page";
import {
  linkTarget,
  type ProviderId,
  type ProviderItem,
  type VideoQuality,
} from "../../../shared/providers";
import { collectionLocation, detailHref, useDetailNavigation } from "@/detail-navigation";
import {
  SearchOnlineResults,
  providerNames,
  type SearchHit,
  type SearchResultSummary,
} from "./SearchOnlineResults";
import { Shelf } from "@/components/Shelf";
import { MediaTile } from "@/components/MediaTile";
import { artAspect, majorityShape, type ArtShape } from "@/art-shape";
import { episodeRow, metaLine, withoutUrls } from "@/media-caption";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { cn } from "@/lib/utils";
import { SearchRadioResults } from "./SearchRadioResults";
import { PastedLink } from "./PastedLink";
import { ScopeChips } from "./ScopeChips";
import { useEnqueueVideoQuality } from "../../video-quality";
import type { SourceKind } from "@/components/sourceTypes";
import { MediaArtwork } from "@/components/MediaArtwork";
import { RadioSlot } from "@/components/RadioSchedule";
import { ArtLevel, useLevel } from "@/components/Level";
import { DurationBar } from "@/components/DurationBar";
import { formatDuration } from "@/time-format";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveToggle, verbRow } from "@/components/DetailHeader";
import { StageTitle } from "@/components/Stage";
import { useRoomLead } from "@/components/AmbientLight";
import { useLiveSourceHits } from "./useLiveSourceHits";
import {
  hitContext,
  hitMeta,
  hitSources,
  names,
  pageAction,
  pressPlays,
  quickSources,
  shapeOf,
  sourceOrder,
  useSourceHits,
  useTopHit,
} from "./search-hits";
import {
  linkAction,
  listLabel,
  listLimit,
  listUnit,
  useListCommand,
  usePastedList,
  type LinkVerb,
} from "@/pasted-link";

export type Props = {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  defaultQuality?: VideoQuality;
  onCommand?: (action: Action) => Promise<boolean>;
  onManageSources?: (source?: SourceKind) => void;
  onOpenCollection?: (item: ProviderItem) => void;
  searchState: SearchRouteState;
  onSearchChange: (state: SearchRouteState) => void;
};
type Entry = [source: string, summary: SearchResultSummary];

const radioSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;

// One source's tiles wrap as ProviderPage's posters do, each as wide as its column.
const gridColumns = {
  poster: "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
  square: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]",
  round: "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]",
  video: "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]",
} as const satisfies Record<ArtShape, string>;
const fluidTile = {
  poster: "[--tile-art:150cqi]",
  square: "[--tile-art:100cqi]",
  round: "[--tile-art:100cqi]",
  video: "[--tile-art:56.25cqi]",
} as const satisfies Record<ArtShape, string>;

/**
 * Search's ground (docs/design.md, Room): while nothing plays, the top or focused item's artwork lights the room
 * (RoomLight.tsx), neutral without one.
 */
export function SearchRoom({ thumbnail }: { thumbnail?: string }) {
  useRoomLead(thumbnail);
  return null;
}

/**
 * On the TV the page's first verb (the hero's Play, a list's Play all) takes the focus once it shows and can be pressed,
 * unless the person already pressed something since what it shows (`shows`: the search, the link) began, or came Back
 * to it (the control they left from takes the focus again: useDetailNavigation).
 */
export function useFirstVerb(page: RefObject<HTMLElement | null>, ready: boolean, shows: string) {
  const pressed = useRef(false);
  // Before the focus below, so a search that shows its verb at once still takes it.
  useLayoutEffect(() => {
    pressed.current = false;
  }, [shows]);
  useEffect(() => {
    const press = () => {
      pressed.current = true;
    };
    addEventListener("keydown", press, true);
    addEventListener("pointerdown", press, true);
    return () => {
      removeEventListener("keydown", press, true);
      removeEventListener("pointerdown", press, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!ready || pressed.current || !isTvPresentation() || history.state?.detailFocus) return;
    page.current?.querySelector<HTMLElement>("[data-page-first]")?.focus({ preventScroll: true });
  }, [ready]);
}

/** The query or the list, set large in the display face; with no query yet, a heading named for screen readers alone. */
function SearchTitle({ title }: { title: string }) {
  return (
    <div className="search-title @container">
      <StageTitle title={title}>
        {title || <span className="sr-only">Search results</span>}
      </StageTitle>
    </div>
  );
}

/**
 * The results of the header's search (`searchState`, the route's), on the room: the query set large, the kinds it found,
 * the closest match as a hero, then a shelf per source in the order they answered, so a late source never moves what is
 * above it; one source fills the page as a grid. Sources that didn't answer close the page in one quiet line. Or a
 * pasted link.
 */
export function SearchPanel(props: Props) {
  const { searchState } = props;
  const query = searchState.query;
  const kind = searchState.kind;
  const [remoteSummaries, setSummaries] = useState<Record<string, SearchResultSummary>>({});
  const liveHits = useLiveSourceHits(query);
  const summaries = useMemo<Record<string, SearchResultSummary>>(
    () => ({
      ...remoteSummaries,
      "Shared sources": { count: liveHits.length, hits: liveHits, loading: false, error: false },
    }),
    [remoteSummaries, liveHits],
  );
  const resultsKey = JSON.stringify([query, props.origin, props.token]);
  const [seenResults, setSeenResults] = useState(resultsKey);
  if (resultsKey !== seenResults) {
    setSeenResults(resultsKey);
    setSummaries({});
  }
  const reportResults = useCallback(
    (source: string, summary: SearchResultSummary) =>
      setSummaries((current) => ({ ...current, [source]: summary })),
    [],
  );
  const [quality, setQuality, resetQuality] = useEnqueueVideoQuality(
    props.defaultQuality ?? "auto",
  );
  const panel = useRef<HTMLElement>(null);
  const url = linkOf(query);
  const filter = searchState.source;
  // Only the sources that can return the kind are asked, waited on, or report a problem.
  const inScope = (source: string) =>
    (filter === "All" || filter === source) && canReturn(source, kind);
  const providers = url
    ? []
    : (
        [
          "youtube",
          "bandcamp",
          "soundcloud",
          "archives",
          "mixcloud",
          "spotify",
          "raiplay",
          "twitch",
          "streamingcommunity",
          "movies123",
          "animesaturn",
          "animeunity",
        ] as ProviderId[]
      ).filter((provider) => inScope(providerNames[provider]));
  const pending = (source: string) => !summaries[source] || summaries[source].loading;
  // What the search asked for, and what merely came back: a hit is close when it mentions every word of the query.
  const { close } = searchRelevance(query);
  const { order, hits, within } = useSourceHits(resultsKey, summaries, query);
  const focusedHit = useRef<string | null>(null);
  // The kind and source are the header field's scope, chosen before or after the results. The filters come from what
  // was found, so no choice made here can come up empty: a kind is offered once it has a hit, and inside a kind, a
  // source once it has a hit of it. A scope chosen in the field shows too, and says so when it holds nothing.
  const isFound = (hit: SearchHit) =>
    close(hit) && (kind !== "audio" || canReturn(hit.source, kind));
  const found = hits.filter(isFound);
  const asking = sourceOrder.filter((source) => inScope(source) && pending(source));
  const scoped = within(filter, kind);
  const relevant = scoped.filter(close);
  const loose = scoped.filter((hit) => !close(hit));
  // The closest match leads and holds still for the query and kind, so nothing moves under the focus while browsing.
  // The room takes the colour of the focused item, else the top one's; once a hit has the focus, the top one holds.
  const [focused, setFocused] = useState<{ key: string; id: string } | null>(null);
  const lit = focused?.key === resultsKey ? focused.id : null;
  const waiting = quickSources.some((source) => inScope(source) && pending(source));
  const top = useTopHit(`${resultsKey}:${kind ?? "all"}`, relevant, query, waiting, !!lit);
  const litHit = relevant.find((hit) => hit.id === lit) ?? top;
  // The focus freezes the hero, so it waits for the quick sources a stronger match could still come from.
  useFirstVerb(panel, !!top && !top.primary.disabled && !waiting, resultsKey);
  const [expanded, setExpanded] = useState<{ key: string; sources: string[] }>({
    key: resultsKey,
    sources: [],
  });
  const expandedSources = expanded.key === resultsKey ? expanded.sources : [];
  const shelves = order
    .filter(inScope)
    .map((source) => ({
      source,
      hits: relevant.filter((hit) => hit !== top && hit.source === source),
    }))
    .filter((shelf) => shelf.hits.length);
  useLayoutEffect(() => {
    if (!props.active || !focusedHit.current || document.activeElement !== document.body) return;
    const row =
      panel.current?.querySelector<HTMLElement>(
        `[data-hit-id="${CSS.escape(focusedHit.current)}"] [data-play], [data-hit-id="${CSS.escape(focusedHit.current)}"][data-media-tile]`,
      ) ?? panel.current?.querySelector<HTMLElement>("[data-play], [data-media-tile]");
    row?.focus({ preventScroll: true });
  }, [relevant, props.active]);
  // A shelf heading that changed the source, or a chip that went once unchosen, left with its control; the focus goes to
  // the chosen chip.
  const shownFilters = useRef(`${kind}:${filter}`);
  useLayoutEffect(() => {
    if (shownFilters.current === `${kind}:${filter}`) return;
    shownFilters.current = `${kind}:${filter}`;
    if (document.activeElement === document.body)
      panel.current
        ?.querySelector<HTMLElement>('[data-chip][aria-pressed="true"]')
        ?.focus({ preventScroll: true });
  }, [kind, filter]);
  const shown: Entry[] = Object.entries(summaries).filter(([source]) => inScope(source));
  // The chips come from what was found, so no choice made here comes up empty: each counts what pressing it shows, and
  // shows once that is something. A chosen one always shows; the page says when it holds nothing. Audio overlaps music
  // and videos, so it shows only when chosen.
  const current: SearchScope = { kind, source: filter };
  const holds = (state: SearchScope) => within(state.source, state.kind).filter(isFound).length;
  const chips = [
    {
      label: "All",
      checked: !hasScope(current),
      // All clears the kind too, Audio's included.
      count: hits.filter(close).length,
      onPress: () => props.onSearchChange({ query, source: "All" }),
    },
    ...chipScopes(current).flatMap((scope) => {
      const checked = isChosen(current, scope);
      const count = holds(checked ? current : chooseScope(current, scope));
      if (!checked && (!count || scope.kind === "audio")) return [];
      return [
        {
          label: scope.label,
          checked,
          count,
          onPress: () => props.onSearchChange({ ...searchState, ...chooseScope(current, scope) }),
        },
      ];
    }),
  ];
  const everything = () => props.onSearchChange({ query, source: "All" });
  const [looseOpen, setLooseOpen] = useState(false);
  return (
    <section
      ref={panel}
      className="min-w-0 space-y-8"
      aria-label={url ? "Pasted link" : "Search results"}
      onFocusCapture={(event) => {
        focusedHit.current =
          (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId ??
          null;
        if (focusedHit.current) setFocused({ key: resultsKey, id: focusedHit.current });
      }}
      onBlurCapture={(event) => {
        if (event.relatedTarget instanceof Node && !panel.current?.contains(event.relatedTarget))
          focusedHit.current = null;
      }}
    >
      {!url && (
        <>
          <SearchRoom thumbnail={litHit?.thumbnail} />
          <SearchTitle title={query} />
          {/* The row holds its height while sources answer, so nothing below moves as chips arrive. On a phone or touch
              screen it stays under the header while the shelves scroll, as the palette's does. */}
          {(found.length > 0 || asking.length > 0 || hasScope(current)) && (
            <div className="min-h-control touch:sticky touch:top-(--top-bar) touch:z-20 touch:-mx-(--gutter) touch:-my-2 touch:min-h-15 touch:bg-background touch:px-(--gutter) touch:py-2">
              {(found.length > 0 || hasScope(current)) && (
                <ScopeChips query={resultsKey} chips={chips} />
              )}
            </div>
          )}
          <p role="status" className="sr-only">
            {!relevant.length && asking.length
              ? `Searching for “${query}”…`
              : `${relevant.length} ${relevant.length === 1 ? "result" : "results"} for “${query}”.`}
            {asking.length > 0 &&
              ` ${asking.length === 1 ? `Still asking ${asking[0]}.` : `Still asking ${asking.length} sources.`}`}
          </p>
          {!scoped.length && asking.length > 0 && <SearchSkeleton />}
          {/* The hero's place is kept while the quick sources answer, so nothing under it moves when it comes. */}
          {scoped.length > 0 && !top && waiting && <HeroSkeleton />}
          {top && <TopResult key={top.id} hit={top} />}
          {shelves.map((shelf, index) => {
            const shape = majorityShape(shelf.hits.slice(0, 12).map(shapeOf));
            // A word every hit of a shelf shares (RaiPlay's "Programme") says nothing, so it goes.
            const showCollection = !(
              shelf.hits.length > 1 &&
              shelf.hits.every(
                (hit) => hit.collection && hit.collection === shelf.hits[0]!.collection,
              )
            );
            // One source fills the page as a grid, without its heading or the twelve-tile cap.
            if (filter !== "All")
              return (
                <ul
                  key={shelf.source}
                  aria-label={shelf.source}
                  className={cn("grid list-none gap-x-4 gap-y-6 p-0", gridColumns[shape])}
                >
                  {shelf.hits.map((hit, position) => (
                    <li key={hit.id} className="@container min-w-0">
                      <HitTile
                        hit={hit}
                        shape={shape}
                        showSource={false}
                        showCollection={showCollection}
                        pageFirst={!top && position === 0}
                        className={cn(
                          "w-full [&_[data-media-tile]]:w-full [&_[data-tile-art]]:w-full",
                          fluidTile[shape],
                        )}
                      />
                    </li>
                  ))}
                </ul>
              );
            return (
              <Shelf
                key={shelf.source}
                title={shelf.source}
                href={searchLocation({ ...searchState, source: shelf.source })}
              >
                {shelf.hits
                  .slice(0, expandedSources.includes(shelf.source) ? undefined : 12)
                  .map((hit, position) => (
                    <li key={hit.id} className="shrink-0">
                      <HitTile
                        hit={hit}
                        shape={shape}
                        showSource={false}
                        showCollection={showCollection}
                        pageFirst={!top && index === 0 && position === 0}
                      />
                    </li>
                  ))}
                {!expandedSources.includes(shelf.source) && shelf.hits.length > 12 && (
                  <li className="shrink-0 self-center">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setExpanded({
                          key: resultsKey,
                          sources: [...expandedSources, shelf.source],
                        })
                      }
                    >
                      {shelf.hits.length - 12} more
                    </Button>
                  </li>
                )}
              </Shelf>
            );
          })}
          <MoreResults summaries={shown} />
          {/* A scope from the field that holds nothing says so, with the way back to everything the query found. */}
          {props.connected && !asking.length && !scoped.length && found.length > 0 && (
            <Empty role="status">
              <EmptyHeader>
                <EmptyTitle>
                  <h2>
                    Nothing in {scopeLabels({ kind, source: filter }).join(" on ")} for “{query}”
                  </h2>
                </EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button data-page-first variant="outline" onClick={everything}>
                  Show all {found.length} {found.length === 1 ? "result" : "results"}
                </Button>
              </EmptyContent>
            </Empty>
          )}
          {props.connected &&
            !asking.length &&
            !found.length &&
            !shown.some(([, summary]) => summary.error) && (
              <Empty role="status">
                <EmptyHeader>
                  <EmptyTitle>
                    <h2>Nothing found for “{query}”</h2>
                  </EmptyTitle>
                  <EmptyDescription>Try fewer words or paste a link.</EmptyDescription>
                </EmptyHeader>
                {props.onManageSources && (
                  <EmptyContent>
                    <Button variant="outline" onClick={() => props.onManageSources?.()}>
                      Add a source
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            )}
          {/* What came back without every word of the query waits behind one line, so a stray hit never leads. */}
          {loose.length > 0 && (
            <Collapsible open={looseOpen} onOpenChange={setLooseOpen} className="grid gap-3">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="-ml-2.5 h-auto min-h-8 max-w-full justify-self-start text-left whitespace-normal text-muted-foreground"
                >
                  {looseOpen ? "Hide" : "Show"} {loose.length}{" "}
                  {loose.length === 1 ? "result that doesn't" : "results that don't"} mention “
                  {query}”
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <HitList hits={loose} label="Other results" compact />
              </CollapsibleContent>
            </Collapsible>
          )}
          {/* Sources that didn't answer close the page in one quiet line, so the results lead. */}
          <SourcesUnanswered summaries={shown} />
        </>
      )}
      {providers.map((provider) => (
        <SearchOnlineResults
          key={`${provider}:${query}`}
          {...props}
          onResults={reportResults}
          active={props.active}
          provider={provider}
          query={query}
          quality={quality}
          onEnqueued={resetQuality}
        />
      ))}
      {!url &&
        radioSources
          .filter(inScope)
          .map((source) => (
            <SearchRadioResults
              key={`${source}:${query}`}
              {...props}
              onResults={reportResults}
              active={props.active}
              query={query}
              source={source}
            />
          ))}
      {url && linkTarget(url)?.shape === "playlist" && (
        <PastedList key={url} url={url} {...props} quality={quality} onDone={resetQuality} />
      )}
      {url && linkTarget(url)?.shape !== "playlist" && (
        <PastedLink
          key={url}
          url={url}
          {...props}
          quality={quality}
          onQualityChange={setQuality}
          onDone={resetQuality}
        />
      )}
    </section>
  );
}

/** Where a hit leads: its source's home, its creator, series or season, its station. */
const hitRelated = (
  hit: SearchHit,
  showSource = true,
  onPage?: { context: boolean; creator: boolean },
) => ({
  radio: hit.radio?.title !== hit.title ? hit.radio : undefined,
  source: showSource ? hit.source : undefined,
  collection: onPage?.context ? undefined : hit.context,
  creator: onPage?.creator ? undefined : hit.creator,
});

/**
 * The closest match as a hero on the room: its artwork standing as an object, its title, one meta line and its links,
 * then its main verb with where it plays (focused first, on the TV too), Save and its menu. On a phone the artwork sits beside the title, so
 * the first screen holds the shelves too.
 */
export function TopResult({ hit }: { hit: SearchHit }) {
  const { on } = usePlayOn();
  const main = hit.primary;
  const label = main.label === "Play" || main.label === "Resume" ? on(main.label) : main.label;
  // What plays leads with the pill, Play and where it plays; its page stays the title's link and the menu's Details.
  const play = hit.actions.find((action) => action.label === "Play" && action.run);
  const playOn =
    play &&
    hit.actions.find((action) => action.playOn && !action.sharingDeviceId && !action.liveAudio);
  const own = hit.actions.find((action) => action.group === "keep" && action.pressed !== undefined);
  // The "…" holds Play on… as well as the pill, then where it belongs, as the hit's row has it.
  const rest = useItemMenu([
    ...(play && main.label === "Open" && main.href
      ? [{ label: "Details", group: "go", disabled: main.disabled, run: main.run }]
      : []),
    ...hit.actions.filter(
      (action) => action !== play && action !== own && action.label !== main.label,
    ),
    ...useRelatedMenu(hitRelated(hit)),
  ]);
  const meta = hitMeta(hit);
  const level = useLevel(hitSources(hit));
  return (
    <section
      data-search-top
      data-hit-id={hit.id}
      aria-label={hit.title}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 md:grid-rows-[1fr_auto] md:gap-x-8 md:gap-y-3"
    >
      {/* Its shape's frame at a set height, as Details draws it, standing in the room with its shadow. */}
      <div
        aria-hidden="true"
        className={cn(
          "relative h-24 max-w-[36vw] overflow-hidden rounded-sm shadow-(--object-shadow) md:row-span-2 md:h-56 md:max-w-[40vw]",
          artAspect[shapeOf(hit)],
          shapeOf(hit) === "round" && "rounded-full",
        )}
      >
        <MediaArtwork
          thumbnail={hit.thumbnail}
          title={hit.title}
          collection={!!hit.collection && hit.collection !== "Album"}
          className="aspect-auto size-full object-cover"
        />
        <ArtLevel level={level} className="max-md:size-6 max-md:text-xs" />
      </div>
      <div className="grid min-w-0 gap-1 md:self-end">
        <h2 className="break-words text-xl leading-tight font-semibold tracking-tight md:text-4xl md:leading-[1.02] md:tracking-[-.03em]">
          {main.href ? (
            <ContentLink href={main.href} className="no-underline hover:underline">
              {hit.title}
            </ContentLink>
          ) : (
            hit.title
          )}
        </h2>
        {meta && <p className="text-sm text-muted-foreground break-words tabular-nums">{meta}</p>}
        <MediaContext {...hitRelated(hit)} />
      </div>
      <div data-nav-row className={cn("col-span-2 min-w-0 md:col-span-1 md:col-start-2", verbRow)}>
        {play ? (
          <PlayPill
            data-page-first
            data-play
            size="lg"
            label="Play"
            aria-label={on(`Play ${hit.title}`)}
            title={hit.title}
            thumbnail={hit.thumbnail}
            audioOnly={playOn?.audioOnly}
            disabled={play.disabled}
            onClick={() => play.run?.()}
            playOn={playOn?.playOn}
            playOnDisabled={playOn?.disabled}
          />
        ) : (
          <Button
            data-page-first
            data-play
            size="lg"
            asChild={!!main.href && !main.disabled}
            disabled={main.disabled}
            onClick={(event) => {
              if (
                main.href &&
                (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
              )
                return;
              if (main.href) event.preventDefault();
              main.run();
            }}
          >
            {main.href && !main.disabled ? <a href={detailHref(main.href)}>{label}</a> : label}
          </Button>
        )}
        {own && (
          <SaveToggle
            aria-label={`Save ${hit.title}`}
            saved={!!own.pressed}
            disabled={own.disabled}
            onClick={() => own.run?.()}
          />
        )}
        <ItemMenu menu={rest} size="icon-lg" title={hit.title} className="opacity-100" />
      </div>
    </section>
  );
}

/** The closest match's place while it is chosen. */
function HeroSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 md:grid-rows-[1fr_auto] md:gap-x-8 md:gap-y-3"
    >
      <Skeleton className="size-24 rounded-none md:row-span-2 md:size-56" />
      <div className="grid gap-2 md:self-end">
        <Skeleton className="h-7 w-3/5 max-w-96 md:h-8" />
        <Skeleton className="h-4 w-2/5 max-w-64" />
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 md:col-span-1 md:col-start-2">
        <Skeleton className="h-11 w-28 max-md:w-full" />
        <Skeleton className="h-11 w-20" />
        <Skeleton className="size-10" />
      </div>
    </div>
  );
}

/** Search's cold load in the geometry it becomes: the closest match, then a shelf. */
function SearchSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading search results…"
      data-loading="search"
      className="space-y-8"
    >
      <HeroSkeleton />
      <div aria-hidden="true" className="grid gap-3">
        <div className="flex min-h-11 items-center">
          <Skeleton className="h-6 w-40" />
        </div>
        <ol className="-m-1 flex gap-4 overflow-hidden p-1 pb-3">
          <MediaTilesSkeleton shape="square" />
        </ol>
      </div>
    </div>
  );
}

/** A hit as a tile: its press does its main verb (Play for a station or a live stream, else Open), the rest in its menu. */
export function HitTile({
  hit,
  shape,
  showCollection = true,
  showSource = true,
  pageFirst,
  className,
}: {
  hit: SearchHit;
  shape: ArtShape;
  showCollection?: boolean;
  /** A source's own shelf doesn't repeat its name. */
  showSource?: boolean;
  pageFirst: boolean;
  className?: string;
}) {
  const play =
    hit.live &&
    hit.actions.find((action) => action.label === "Play" && !action.disabled && action.run);
  const primary = play
    ? { label: play.label, run: play.run!, disabled: play.disabled }
    : hit.primary;
  return (
    <MediaTile
      related={hitRelated(hit)}
      className={className}
      data-hit-id={hit.id}
      data-page-first={pageFirst || undefined}
      shape={shape}
      own={shapeOf(hit)}
      title={hit.title}
      meta={metaLine(hitMeta(hit, showCollection), showSource && hit.source)}
      thumbnail={hit.thumbnail}
      source={hitSources(hit)}
      aria-label={`${primary.label} ${hit.title}`}
      disabled={primary.disabled}
      href={!play ? hit.primary.href : undefined}
      onClick={() => primary.run()}
      menu={[
        ...(play && hit.primary.label !== "Play" ? [pageAction(hit)] : []),
        ...hit.actions.filter((action) => action.label !== primary.label),
      ]}
    />
  );
}

/**
 * Search hits as divided rows; collection and station pages use the compact layout. An album's tracks (`numberOf`, a
 * track's place in the whole album, filtered or not) are a tracklist: number, title and time, with nothing the page
 * already says. `pageLinks` are what the page itself shows (its address, its creator, its trail): a row doesn't
 * repeat them.
 */
export const HitList = memo(function HitList({
  hits,
  label,
  compact = false,
  currentId,
  pageFirst = false,
  showSource = true,
  numberOf,
  pageLinks = [],
}: {
  hits: SearchHit[];
  label: string;
  compact?: boolean;
  currentId?: string;
  pageFirst?: boolean;
  showSource?: boolean;
  numberOf?: (hit: SearchHit) => number;
  pageLinks?: readonly (string | undefined)[];
}) {
  const session = useOptionalSessionGate();
  if (!hits.length) return null;
  // The list takes its majority shape; a word every row shares ("Programme") says nothing, so it goes.
  const shape = majorityShape(hits.map(shapeOf), compact ? "square" : "video");
  const sameKind =
    hits.length > 1 &&
    hits.every((hit) => hit.collection && hit.collection === hits[0]!.collection);
  const onPage = (url?: string) => !!url && pageLinks.includes(url);
  return (
    <div className="min-w-0">
      <MediaList aria-label={label}>
        {hits.map((hit, index) => {
          // A live hit's press plays it while Play is enabled; otherwise it keeps its Open destination.
          const play =
            hit.live &&
            hit.actions.find((action) => action.label === "Play" && !action.disabled && action.run);
          const track = !!numberOf;
          // An episode in its series' own list goes by its name, "S1 E1" leading its meta, even as the list's one row.
          const episode = !showSource ? episodeRow(hit.title) : { title: hit.title };
          return (
            <MediaRow
              related={
                track
                  ? undefined
                  : hitRelated(hit, showSource, {
                      context: onPage(hit.context?.url),
                      creator: onPage(hit.creator?.url),
                    })
              }
              key={hit.id}
              compact={compact}
              pageFirst={pageFirst && index === 0}
              data-hit-id={hit.id}
              source={hitSources(hit)}
              title={episode.title}
              number={numberOf?.(hit)}
              meta={
                track
                  ? !hit.live && hit.duration != null
                    ? formatDuration(hit.duration)
                    : undefined
                  : compact
                    ? metaLine(episode.lead, hitMeta(hit, !sameKind), showSource && hit.source)
                    : metaLine(
                        hitContext(hit),
                        !sameKind && hit.collection,
                        showSource && hit.source,
                      )
              }
              description={!compact ? withoutUrls(hit.description) || undefined : undefined}
              shape={shape}
              own={shapeOf(hit)}
              art={
                track ? undefined : (
                  <MediaArtwork
                    thumbnail={hit.thumbnail}
                    title={hit.title}
                    collection={!!hit.collection}
                  />
                )
              }
              primary={
                play
                  ? { label: play.label, onClick: play.run!, disabled: play.disabled }
                  : {
                      label: hit.primary.label,
                      onClick: hit.primary.run,
                      disabled: hit.primary.disabled,
                      href: hit.primary.href,
                    }
              }
              // A press that plays keeps the hit's own destination (a station's page) in the menu as Open.
              menu={
                play || hit.primary.label === "Play"
                  ? [
                      ...(play && hit.primary.label !== "Play" ? [pageAction(hit)] : []),
                      ...hit.actions.filter((action) => action.label !== "Play"),
                    ]
                  : hit.actions
              }
            >
              {hit.radio?.next && (
                <RadioSlot
                  show={hit.radio.next}
                  className="w-full text-meta break-words text-muted-foreground"
                />
              )}
              {hit.id === currentId && (
                <span className="text-sm font-medium">
                  {session
                    ? playbackStatus(session.state, session.connected).label
                    : "Current item"}
                </span>
              )}
              {!compact && !hit.collection && (
                <DurationBar duration={hit.duration} position={hit.position} live={hit.live} />
              )}
            </MediaRow>
          );
        })}
      </MediaList>
    </div>
  );
});

function MoreResults({ summaries }: { summaries: Entry[] }) {
  const more = summaries.filter(([, summary]) => summary.more);
  return more.length ? (
    <div className="flex flex-wrap gap-2">
      {more.map(([source, summary]) => (
        <Button
          key={source}
          variant="outline"
          className="h-auto min-h-8 max-w-full whitespace-normal"
          disabled={summary.moreDisabled}
          onClick={summary.more}
        >
          More from {source}
        </Button>
      ))}
    </div>
  ) : null;
}

/** A page whose one source failed: one Alert with its reason and Try again; then source notes. */
export function SourceProblems({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(
    ([, summary]) => summary.warning && summary.warning !== summary.errorMessage,
  );
  const messages = [
    ...new Set(failed.map(([, summary]) => summary.errorMessage || "Didn't respond.")),
  ];
  return (
    <>
      {failed.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load {names(failed.map(([source]) => source))}.</AlertTitle>
          <AlertDescription>
            {messages.length === 1 ? (
              messages[0]
            ) : (
              <ul>
                {failed.map(([source, summary]) => (
                  <li key={source} className="break-words">
                    {failed.length > 1 && `${source}: `}
                    {summary.errorMessage || "Didn't respond."}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
          <AlertAction>
            <TryAgain onClick={() => failed.forEach(([, summary]) => summary.retry?.())} />
          </AlertAction>
        </Alert>
      )}
      {notes.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul>
              {notes.map(([source, summary]) => (
                <li key={source}>
                  {source}: {summary.warning}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

/**
 * Sources that didn't answer, where others did or the page is something else (Search, a Details page's neighbours): one
 * muted line at the end with one Try again, then a muted line per source note. Their reasons wait on the source's own page.
 */
export function SourcesUnanswered({ summaries }: { summaries: Entry[] }) {
  const failed = summaries.filter(([, summary]) => summary.error);
  const notes = summaries.filter(
    ([, summary]) => summary.warning && summary.warning !== summary.errorMessage,
  );
  if (!failed.length && !notes.length) return null;
  return (
    <div data-source-problems className="grid gap-1 text-sm text-muted-foreground">
      {failed.length > 0 && (
        <p>
          {names(failed.map(([source]) => source))} didn't answer.{" "}
          <Button
            variant="link"
            className="h-auto p-0 align-baseline text-foreground touch:min-h-0"
            onClick={() => failed.forEach(([, summary]) => summary.retry?.())}
          >
            Try again
          </Button>
        </p>
      )}
      {notes.map(([source, summary]) => (
        <p key={source} className="break-words">
          {source}: {summary.warning}
        </p>
      ))}
    </div>
  );
}

/**
 * A pasted list (a set, an album, a show, a station's style page) as its own page on the room: its title set large, what
 * it holds, then Play all with where it plays (focused first), Save and its "…" (Play next, Queue all, Play on…, Open,
 * Copy link); then its items, a shelf per show when a radio list gathers several, else as rows.
 */
function PastedList({
  url,
  quality,
  onDone,
  ...props
}: Props & { url: string; quality: VideoQuality; onDone: () => void }) {
  const target = linkTarget(url)!;
  const credentials = props.origin && props.token ? props : null;
  const list = usePastedList(credentials, url, target);
  const [summary, setSummary] = useState<SearchResultSummary>();
  const onResults = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const [pending, setPending] = useState(false);
  const navigation = useDetailNavigation();
  const { on } = usePlayOn();
  const page = summary?.page;
  const hits = (summary?.hits ?? []).map(pressPlays);
  const [lit, setLit] = useState<string | null>(null);
  const title = list.title ?? page?.title ?? new URL(url).hostname;
  // A radio list of several shows (a station's style page) shelves each show's episodes.
  const shows =
    target.provider === "archives"
      ? [...new Set(hits.map((hit) => hit.creator?.url))].map((show) => ({
          show: hits.find((hit) => hit.creator?.url === show)?.creator,
          hits: hits.filter((hit) => hit.creator?.url === show),
        }))
      : [];
  const meta = metaLine(
    page?.subtitle,
    list.count !== undefined && listUnit(target.provider, list.count),
  );
  const listCommand = useListCommand(props.onCommand);
  // A command sent to another Core, or before a reconnect, no longer changes this one's controls (as PastedLink).
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setPending(false);
    return () => controller.abort();
  }, [props.origin, props.token, props.connected]);
  async function send(verb: LinkVerb, on?: PlayOn) {
    if (!props.onCommand || pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    try {
      const ok = await listCommand(linkAction(url, target, verb, quality, list, on), list, title);
      if (ok && !signal.aborted) onDone();
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  const disabled = !props.connected || pending || !props.onCommand;
  const limit = listLimit(list.count);
  const saves = summary?.collection;
  const menu = useItemMenu([
    {
      label: "Play next",
      group: "play",
      disabled,
      run: () => void send("next"),
    },
    {
      label: listLabel("Queue all", list.count),
      group: "play",
      disabled,
      run: () => void send("queue"),
    },
    {
      label: "Play on",
      group: "play",
      disabled: disabled || !props.canPlay,
      playOn: (on) => send("play", on),
    },
    {
      label: "Open",
      group: "go",
      run: () => navigation.open(collectionLocation({ provider: target.provider, url })),
    },
    ...browserActions(url, title),
  ]);
  const root = useRef<HTMLElement>(null);
  useFirstVerb(root, !disabled && props.canPlay, url);
  return (
    <section
      ref={root}
      aria-label={title}
      className="space-y-8"
      onFocusCapture={(event) => {
        const id = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset
          .hitId;
        if (id) setLit(id);
      }}
    >
      <SearchRoom
        thumbnail={
          hits.find((hit) => hit.id === lit)?.thumbnail ?? page?.thumbnail ?? hits[0]?.thumbnail
        }
      />
      <div className="grid gap-4">
        <SearchTitle title={title} />
        {meta && <p className="text-meta text-muted-foreground tabular-nums">{meta}</p>}
        <div data-nav-row className={verbRow}>
          <PlayPill
            data-page-first
            size="lg"
            label={listLabel("Play all", list.count)}
            aria-label={on(`${listLabel("Play all", list.count)} ${title}`)}
            title={title}
            thumbnail={page?.thumbnail}
            disabled={disabled || !props.canPlay}
            onClick={() => void send("play")}
            playOn={(playOn) => send("play", playOn)}
          />
          {saves?.save && (
            <SaveToggle
              aria-label={`Save ${title}`}
              saved={!!saves.saved}
              disabled={!props.connected || !!saves.saveDisabled}
              onClick={saves.save}
            />
          )}
          <ItemMenu menu={menu} size="icon-lg" title={title} className="opacity-100" />
        </div>
        {limit && (
          <p className="text-meta text-muted-foreground">
            Up next holds 500: Play all keeps the {limit}.
          </p>
        )}
      </div>
      {summary?.loading && <SearchSkeleton />}
      {shows.length > 1
        ? shows.map(({ show, hits: episodes }) => {
            const shape = majorityShape(episodes.slice(0, 12).map(shapeOf));
            return (
              <Shelf
                key={show?.url ?? ""}
                title={show?.title ?? title}
                href={show && collectionLocation({ provider: target.provider, url: show.url })}
              >
                {episodes.map((hit) => (
                  <li key={hit.id} className="shrink-0">
                    <HitTile hit={hit} shape={shape} showSource={false} pageFirst={false} />
                  </li>
                ))}
              </Shelf>
            );
          })
        : hits.length > 0 && <HitList hits={hits} label={title} compact showSource={false} />}
      <SourcesUnanswered summaries={summary ? [[providerNames[target.provider], summary]] : []} />
      <SearchOnlineResults
        {...props}
        onResults={onResults}
        provider={target.provider}
        query=""
        url={url}
        paged
        quality={quality}
        onEnqueued={onDone}
      />
    </section>
  );
}
