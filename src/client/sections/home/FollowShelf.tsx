import { useCallback, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { MediaTilesSkeleton } from "@/components/LoadingMedia";
import { mediaSubtitle } from "@/components/MediaContext";
import { MediaTile } from "@/components/MediaTile";
import { RowOptions, type MenuAction } from "@/components/RowMenu";
import { Shelf, ShelfHeading } from "@/components/Shelf";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { majorityShape, providerItemShape } from "@/art-shape";
import { collectionLocation } from "@/detail-navigation";
import { metaLine } from "@/media-caption";
import { TRY_AGAIN } from "@/copy";
import { undoable } from "@/toasts";
import { SearchOnlineResults, type SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { providerNames, type ProviderId } from "../../../shared/providers";
import { renameHomeFollow, type HomeFollow } from "./home-follows";
import { removeHomeFollow } from "./home-rows";

// A shelf scrolls, so it holds more than fits; its heading opens the whole list.
const shelfLength = 12;
// The catalogues that list a series' episodes oldest first; their section shows the newest first.
const oldestFirst: ProviderId[] = ["streamingcommunity", "movies123", "animesaturn", "animeunity"];

/**
 * A Home section that follows a list a source publishes: its latest items, read again each
 * time Home opens (a Twitch channel's live state every 20 seconds, as its page does). Its "…" holds what Home's settings
 * do to it. A source that can't be reached is said quietly in the section's place.
 */
export function FollowShelf({
  follow,
  first,
  last,
  layout,
}: {
  follow: HomeFollow;
  first: boolean;
  last: boolean;
  layout: {
    toggle: (id: HomeFollow["id"], shown: boolean) => void;
    move: (id: HomeFollow["id"], by: -1 | 1) => void;
  };
}) {
  const { credentials, available, openProvider, playHistory } = useShell();
  const { connected, run, videoQualityPreference } = useSessionGate();
  const [summary, setSummary] = useState<SearchResultSummary>();
  const report = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const [renaming, setRenaming] = useState(false);
  const source = providerNames[follow.provider];
  const href = collectionLocation({ provider: follow.provider, url: follow.url });
  const options: MenuAction[] = [
    { label: "Rename", run: () => setRenaming(true) },
    { label: "Move up", disabled: first, run: () => layout.move(follow.id, -1) },
    { label: "Move down", disabled: last, run: () => layout.move(follow.id, 1) },
    {
      label: "Hide",
      run: () => {
        layout.toggle(follow.id, false);
        undoable(`${follow.name} is hidden.`, () => layout.toggle(follow.id, true));
      },
    },
    {
      label: "Remove from Home",
      run: () => undoable(`${follow.name} is off Home.`, removeHomeFollow(follow.id)),
    },
  ];
  const menu = <RowOptions title={follow.name} actions={options} />;
  // The list's own page (a Twitch channel offline) isn't one of its items; live, it leads them.
  const items = (summary?.hits ?? []).flatMap((hit) => {
    // The hit's id as SearchOnlineResults makes it, from the item and its place in a list.
    const item = summary?.page?.items.find(
      (item) =>
        hit.id ===
        `${item.provider}:${item.id}${item.collection?.index == null ? "" : `:${item.collection.index}`}`,
    );
    return item && !(item.url === follow.url && !item.live) ? [{ hit, item }] : [];
  });
  // Only a whole list can be turned round: a list in pages starts with its oldest page.
  if (oldestFirst.includes(follow.provider) && !summary?.page?.nextCursor) items.reverse();
  const shape = (item: (typeof items)[number]["item"]) => providerItemShape(source, item);
  const frame = majorityShape(items.slice(0, shelfLength).map(({ item }) => shape(item)));
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
  return (
    <>
      <SearchOnlineResults
        provider={follow.provider}
        query=""
        url={follow.url}
        paged
        onOpenCollection={openProvider}
        onResults={report}
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
      {summary?.error && !items.length ? (
        quiet(
          `Couldn't reach ${source}. ${follow.name} shows again once it answers.`,
          summary.retry,
        )
      ) : summary && !summary.loading && !items.length ? (
        quiet(`${source} lists nothing here right now.`)
      ) : (
        <Shelf title={follow.name} href={href} loading={!summary || summary.loading} options={menu}>
          {!summary || summary.loading ? (
            <MediaTilesSkeleton shape={frame} />
          ) : (
            items.slice(0, shelfLength).map(({ hit, item }) => (
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
      <RenameSection follow={follow} open={renaming} onOpenChange={setRenaming} />
    </>
  );
}

/** Renames a followed section on this device; its list stays the same. */
export function RenameSection({
  follow,
  open,
  onOpenChange,
}: {
  follow: HomeFollow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Opened from a menu or a button, it gives the focus back to that control as it closes.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open)
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        {open && <RenameForm follow={follow} done={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
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
      <DialogHeader>
        <DialogTitle>Rename {follow.name}</DialogTitle>
        <DialogDescription>
          It follows {follow.list} on {providerNames[follow.provider]}.
        </DialogDescription>
      </DialogHeader>
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
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={done}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.trim() || draft.trim() === follow.name}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
