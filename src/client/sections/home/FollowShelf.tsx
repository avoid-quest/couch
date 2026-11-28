import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { mediaSubtitle } from "@/components/MediaContext";
import { MediaTile } from "@/components/MediaTile";
import { RowOptions, type MenuAction } from "@/components/RowMenu";
import { Shelf, ShelfHeading } from "@/components/Shelf";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { majorityShape, providerItemShape } from "@/art-shape";
import { collectionLocation } from "@/detail-navigation";
import { metaLine } from "@/media-caption";
import { TRY_AGAIN } from "@/copy";
import { undoable } from "@/toasts";
import { progressFor } from "@/sections/find/provider-progress";
import { SearchOnlineResults, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import type { HistoryItem } from "../../../shared/viewing";
import { providerNames, type ProviderId } from "../../../shared/providers";
import { renameHomeFollow, type HomeFollow } from "./home-follows";
import { removeHomeFollow, setHomeSectionShown } from "./home-rows";
import { FollowPanel, panelAnchor, revealFollow } from "./AddToHome";

// A shelf scrolls, so it holds more than fits; its heading opens the whole list.
const shelfLength = 12;
// The catalogues that list a series' episodes oldest first; their section shows the newest first.
const oldestFirst: ProviderId[] = ["streamingcommunity", "movies123", "animesaturn", "animeunity"];
const control = ":is(button, a[href]):not(:disabled):not([tabindex='-1'])";

/**
 * Where the focus goes when a followed section leaves Home (Hide, Remove): the next section's first control, else
 * the previous one's, so a remote stays on Home. Taken before the section goes; given once it has.
 */
function focusAfter(section: HTMLElement | null) {
  const page = section?.closest("[data-page]");
  if (!section || !page) return;
  const sections = [...page.querySelectorAll<HTMLElement>("section")].filter(
    (other) => other.parentElement?.closest("section, [data-page]") === page,
  );
  const at = sections.findIndex((other) => section.contains(other));
  const next = [...sections.slice(at + 1), ...sections.slice(0, at).reverse()]
    .map((other) => other.querySelector<HTMLElement>(control))
    .find(Boolean);
  // Home draws the change on a later frame, a few on the TV: wait for the section to go, a third of a second at most.
  const give = (frames: number) =>
    requestAnimationFrame(() => {
      if (!next?.isConnected) return;
      if (!section.isConnected) next.focus();
      else if (frames) give(frames - 1);
    });
  give(20);
}

/** The hits a followed list's page holds that are its items, each with what it is. */
function entries(summary: SearchResultSummary | undefined, url: string) {
  // The list's own page (a Twitch channel offline) isn't one of its items; live, it leads them.
  return (summary?.hits ?? []).flatMap((hit) => {
    // The hit's id as SearchOnlineResults makes it, from the item and its place in a list.
    const item = summary?.page?.items.find(
      (item) =>
        hit.id ===
        `${item.provider}:${item.id}${item.collection?.index == null ? "" : `:${item.collection.index}`}`,
    );
    return item && !(item.url === url && !item.live) ? [{ hit, item }] : [];
  });
}

/**
 * A Home section that follows a list a source publishes: its latest items, read again each
 * time Home opens (a Twitch channel's live state every 20 seconds, as its page does). Its "…" holds what Home's settings
 * do to it. A list that can't be read is said quietly in the section's place.
 */
export function FollowShelf({
  follow,
  lead,
  first,
  last,
  move,
}: {
  follow: HomeFollow;
  /** What leads Home from Continue, which this section leaves out as Home's shelves do. */
  lead?: HistoryItem;
  first: boolean;
  last: boolean;
  move: (by: -1 | 1) => void;
}) {
  const { credentials, available, openProvider, playHistory } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  // A long list in pages oldest first (an anime's episodes) is read from its last page, and the one before it when
  // that holds too few to fill the shelf.
  const [opening, setOpening] = useState<SearchResultSummary>();
  const [newest, setNewest] = useState<SearchResultSummary>();
  const [before, setBefore] = useState<SearchResultSummary>();
  const reportOpening = useCallback((_: string, next: SearchResultSummary) => setOpening(next), []);
  const reportNewest = useCallback((_: string, next: SearchResultSummary) => setNewest(next), []);
  const reportBefore = useCallback((_: string, next: SearchResultSummary) => setBefore(next), []);
  const lastCursor = opening?.page?.lastCursor;
  const previousCursor =
    newest?.page && newest.page.items.length < shelfLength ? newest.page.previousCursor : undefined;
  const summary = lastCursor ? newest : opening;
  const loading = !summary || summary.loading || (!!previousCursor && (!before || before.loading));
  const [renaming, setRenaming] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => revealFollow(follow.id), [follow.id]);
  const source = providerNames[follow.provider];
  const href = collectionLocation({ provider: follow.provider, url: follow.url });
  const leave = (text: string, go: () => void, undo: () => void) => {
    focusAfter(root.current);
    go();
    undoable(text, undo);
  };
  const options: MenuAction[] = [
    {
      label: "Rename",
      run: () =>
        setRenaming(
          panelAnchor() ?? root.current?.querySelector<HTMLElement>("[data-row-options]") ?? null,
        ),
    },
    { label: "Move up", disabled: first, run: () => move(-1) },
    { label: "Move down", disabled: last, run: () => move(1) },
    {
      label: "Hide",
      run: () =>
        leave(
          `${follow.name} is hidden.`,
          () => setHomeSectionShown(follow.id, false),
          () => setHomeSectionShown(follow.id, true),
        ),
    },
    {
      label: "Remove from Home",
      run: () => {
        let undo = () => {};
        leave(
          `${follow.name} is off Home.`,
          () => (undo = removeHomeFollow(follow.id)),
          () => undo(),
        );
      },
    },
  ];
  const menu = <RowOptions title={follow.name} actions={options} />;
  const items = lastCursor
    ? [...entries(newest, follow.url).reverse(), ...entries(before, follow.url).reverse()]
    : entries(opening, follow.url);
  // Only a whole list can be turned round: a list in pages starts with its oldest page.
  if (!lastCursor && oldestFirst.includes(follow.provider) && !opening?.page?.nextCursor)
    items.reverse();
  // What leads Home is never in a shelf too.
  const shelved = items.filter(({ item }) => !lead || !progressFor(item, [lead]));
  const shape = (item: (typeof items)[number]["item"]) => providerItemShape(source, item);
  const frame = majorityShape(shelved.slice(0, shelfLength).map(({ item }) => shape(item)));
  const quiet = (text: string, retry?: () => void) => (
    <section aria-label={follow.name} className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <ShelfHeading title={follow.name} href={href} />
        {menu}
      </div>
      <p
        role="status"
        className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground"
      >
        {text}
        {retry && (
          <Button variant="ghost" size="sm" onClick={retry}>
            {TRY_AGAIN}
          </Button>
        )}
      </p>
    </section>
  );
  const read = (
    cursor: string | undefined,
    onResults: (source: string, summary: SearchResultSummary) => void,
  ) => (
    <SearchOnlineResults
      provider={follow.provider}
      query=""
      url={follow.url}
      paged
      cursor={cursor}
      onOpenCollection={openProvider}
      onResults={onResults}
      onPlayHistory={playHistory}
      origin={credentials.origin}
      token={credentials.token}
      connected={connected}
      canPlay={available}
      active
      onCommand={run}
      quality={videoQualityPreference.quality}
      onEnqueued={() => {}}
    />
  );
  return (
    <div ref={root} data-follow-section={follow.id} className="grid min-w-0">
      {read(undefined, reportOpening)}
      {lastCursor && read(lastCursor, reportNewest)}
      {previousCursor && read(previousCursor, reportBefore)}
      {(opening?.error || summary?.error) && !items.length ? (
        quiet(
          `Couldn't load ${follow.list} from ${source}.`,
          opening?.error ? opening.retry : summary?.retry,
        )
      ) : !loading && !shelved.length ? (
        quiet(`${source} lists nothing here right now.`)
      ) : (
        <Shelf title={follow.name} href={href} loading={loading} options={menu}>
          {loading ? (
            <MediaTilesSkeleton shape={frame} />
          ) : (
            shelved.slice(0, shelfLength).map(({ hit, item }) => (
              <li key={hit.id} className="flex shrink-0">
                <MediaTile
                  natural
                  related={{ collection: item.collection, creator: item.creator }}
                  shape={frame}
                  own={shape(item)}
                  title={item.title}
                  meta={metaLine(mediaSubtitle(item))}
                  thumbnail={item.thumbnail}
                  source={item.url}
                  aria-label={`Open ${item.title}`}
                  href={collectionLocation(item)}
                  onClick={() => openProvider(item)}
                  menu={hit.actions}
                />
              </li>
            ))
          )}
        </Shelf>
      )}
      <RenameSection follow={follow} anchor={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}

/** Renames a followed section on this device, from the control `anchor`; its list stays the same. */
export function RenameSection({
  follow,
  anchor,
  onClose,
}: {
  follow: HomeFollow;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  return (
    <FollowPanel open={!!anchor} anchor={anchor} title={`Rename ${follow.name}`} onClose={onClose}>
      {anchor && <RenameForm follow={follow} done={onClose} />}
    </FollowPanel>
  );
}

function RenameForm({ follow, done }: { follow: HomeFollow; done: () => void }) {
  const [draft, setDraft] = useState(follow.name);
  function submit(event: FormEvent) {
    event.preventDefault();
    renameHomeFollow(follow.id, draft);
    done();
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <PopoverHeader>
        <PopoverTitle className="font-heading text-base font-semibold">
          Rename {follow.name}
        </PopoverTitle>
        <PopoverDescription>
          It follows {follow.list} on {providerNames[follow.provider]}.
        </PopoverDescription>
      </PopoverHeader>
      <Field>
        <FieldLabel htmlFor={`rename-${follow.id}`}>Name</FieldLabel>
        <Input
          id={`rename-${follow.id}`}
          autoFocus
          autoComplete="off"
          maxLength={120}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
        />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.trim() || draft.trim() === follow.name}>
          Save
        </Button>
      </div>
    </form>
  );
}
