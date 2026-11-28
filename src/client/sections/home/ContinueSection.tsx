import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useItemLight, useRoomLead } from "@/components/AmbientLight";
import { SaveToggle } from "@/components/DetailHeader";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PlayPill, usePlayDestination, usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { useRelatedMenu } from "@/components/MediaContext";
import { ArtLevel, useLevel } from "@/components/Level";
import { ShelfHeading } from "@/components/Shelf";
import { historyShape, majorityShape } from "@/art-shape";
import { mediaCaption, metaLine } from "@/media-caption";
import { formatRuntime } from "@/time-format";
import { historyReference, useDetailAction, useForLaterToggle } from "@/sections/details/save";
import { isTvPresentation } from "@/session/presentation";
import type { PlayOn } from "../../../shared/protocol";
import type { HistoryItem } from "../../../shared/viewing";
import { BoardArt } from "./HomeBoard";
import { SectionOptions } from "./SectionOptions";

type Resume = (item: HistoryItem, options: { fromStart: boolean; on?: PlayOn }) => unknown;
type Props = {
  /** What to continue, in the order Home opened with: the first leads, the next few are listed beside it. */
  items: HistoryItem[];
  loading: boolean;
  resume: Resume;
  resumable: (item: HistoryItem) => boolean;
  menu: (item: HistoryItem) => MenuAction[];
  /** Whether it plays now: what plays doesn't make way for itself. */
  playing: (item: HistoryItem) => boolean;
  /** A quiet line after the heading (a refresh that failed). */
  note?: ReactNode;
};

// The programme an item belongs to ("Splendida Cornice"), not the list it came from ("Clip").
const programme = (item: Pick<HistoryItem, "collection" | "creator" | "title">) =>
  item.collection?.parent?.title ?? item.collection?.title ?? item.creator?.title;
const left = (item: HistoryItem) =>
  item.duration ? `${formatRuntime(Math.max(0, item.duration - item.position))} left` : undefined;
// The next items say which episode where the title is the series, and how much is left.
const rowCaption = (item: HistoryItem) => {
  const caption = mediaCaption(item);
  return { title: caption.title, meta: metaLine(caption.lead, left(item)) };
};

/**
 * Continue, Home's first section of your own: what you stopped last leads, large, with Resume and where it plays,
 * beside a short list of the next. It keeps the order Home opened with, so nothing takes the lead's place while you
 * look at it; with nothing to continue there is no section.
 */
export function ContinueSection({ items, loading, resume, resumable, menu, playing, note }: Props) {
  const [lead, ...next] = items;
  if (!loading && !lead) return null;
  const rows = next.slice(0, 3);
  const shape = majorityShape(rows.map(historyShape));
  return (
    <section aria-label="Continue" aria-busy={loading || undefined} className="grid min-w-0 gap-3">
      <div className="flex items-center gap-4">
        <ShelfHeading title="Continue" href="/saved?tab=played" loading={loading} />
        {note}
        <SectionOptions id="continue" name="Continue" />
      </div>
      {!lead ? (
        <LeadSkeleton />
      ) : (
        <div className="grid items-start gap-x-8 gap-y-4 md:grid-cols-[minmax(0,min(56%,30rem))_minmax(0,1fr)] tv:grid-cols-[minmax(0,min(56%,20rem))_minmax(0,1fr)] tv:gap-x-6">
          <Lead
            item={lead}
            resume={resume}
            resumable={resumable(lead)}
            menu={menu(lead)}
            playing={playing(lead)}
          />
          {rows.length > 0 && (
            <MediaList
              aria-label="Next to continue"
              className="border-t-0 [&>li:first-child]:pt-0 [&>li:last-child]:border-b-0"
            >
              {rows.map((item) => (
                <MediaRow
                  key={item.mediaId}
                  compact
                  data-history-details={item.mediaId}
                  className="[--row-art:8rem] lg:[--row-art:9.5rem] tv:[--row-art:6.5rem]"
                  related={{ collection: item.collection, creator: item.creator }}
                  shape={shape}
                  own={historyShape(item)}
                  {...rowCaption(item)}
                  source={item.url}
                  art={
                    <BoardArt
                      thumbnail={item.thumbnail}
                      title={item.title}
                      progress={item.duration ? item.position / item.duration : undefined}
                    />
                  }
                  primary={{
                    label: "Resume",
                    disabled: !resumable(item),
                    onClick: () => resume(item, { fromStart: false }),
                  }}
                  menu={menu(item)}
                />
              ))}
            </MediaList>
          )}
        </div>
      )}
    </section>
  );
}

/** The lead's shape while what leads is read. */
export function LeadSkeleton() {
  return (
    <div aria-hidden="true" className="grid max-w-[30rem] gap-3 tv:max-w-[20rem]">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="h-6 w-4/5" />
      <Skeleton className="h-control w-48" />
    </div>
  );
}

/**
 * Continue's lead: its whole picture, title and meta as one press that resumes it, then Resume with where it goes
 * (which opens Choose where it plays), Save and its "…", and what Resume ends there.
 */
function Lead({
  item,
  resume,
  resumable,
  menu,
  playing,
}: {
  item: HistoryItem;
  resume: Resume;
  resumable: boolean;
  menu: MenuAction[];
  playing: boolean;
}) {
  const { on } = usePlayOn();
  const destination = usePlayDestination();
  const save = useForLaterToggle(item.url, () => historyReference(item), useDetailAction());
  // The pill holds Resume and Play on, and the icon Save, so the "…" holds the rest, Play on… too. The TV has no Save or
  // "…" beside Resume: a held OK opens the menu, from the artwork, and Save is in it.
  const tv = isTvPresentation();
  const related = useRelatedMenu({ collection: item.collection, creator: item.creator });
  const options = useItemMenu([
    ...menu.filter((action) => tv || action.pressed === undefined),
    ...related,
  ]);
  const light = useItemLight(item.thumbnail);
  // With nothing playing, the lead lights the room a little (RoomLight.tsx).
  useRoomLead(item.thumbnail);
  const level = useLevel(item.url);
  const caption = mediaCaption(item);
  const meta = metaLine(caption.lead ?? programme(item), left(item));
  const makesWay = !playing && destination.playing;
  const label = on(`Resume ${item.title}`);
  return (
    <div className="grid min-w-0 content-start gap-3">
      <div
        data-tile
        {...options.item}
        onPointerEnter={light.onPointerEnter}
        onFocus={light.onFocus}
        className="relative flex min-w-0"
      >
        <Button
          variant="ghost"
          data-media-tile
          data-page-first
          data-history-details={item.mediaId}
          {...options.target}
          aria-label={label}
          disabled={!resumable}
          onClick={() => resume(item, { fromStart: false })}
          className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-3 rounded-none border-0 p-0 text-left font-normal whitespace-normal text-foreground hover:bg-transparent active:bg-transparent"
        >
          <span
            data-tile-art
            data-own={historyShape(item)}
            className="relative block aspect-video w-full overflow-hidden rounded-xl bg-black"
          >
            <MediaArtwork
              priority
              thumbnail={item.thumbnail}
              title={item.title}
              className="size-full object-contain"
            />
            {item.duration ? (
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1 bg-black/45">
                <span
                  className="block h-full bg-white"
                  style={{ width: `${Math.min(1, item.position / item.duration) * 100}%` }}
                />
              </span>
            ) : null}
            <ArtLevel level={level} className="size-10 text-lg" />
          </span>
          <span className="grid gap-1">
            <span className="font-heading text-title font-semibold text-balance wrap-anywhere">
              {caption.title}
            </span>
            {meta && (
              <span data-tile-meta className="text-meta text-muted-foreground wrap-anywhere">
                {meta}
              </span>
            )}
          </span>
        </Button>
        {tv && (
          <span className="pointer-events-none absolute inset-x-0 top-0 aspect-video">
            <ItemMenu hidden menu={options} title={item.title} />
          </span>
        )}
      </div>
      <div data-nav-row className="flex min-w-0 flex-wrap items-center gap-1.5">
        <PlayPill
          label="Resume"
          aria-label={label}
          title={item.title}
          thumbnail={item.thumbnail}
          verb={item.position > 0 ? "Resume" : undefined}
          disabled={!resumable}
          onClick={() => resume(item, { fromStart: false })}
          playOn={(on) => resume(item, { fromStart: false, on })}
          playOnDisabled={!item.playable}
        />
        {!tv && item.url && (
          <SaveToggle size="icon" saved={save.saved} disabled={save.disabled} onClick={save.run} />
        )}
        {!tv && <ItemMenu menu={options} title={item.title} />}
      </div>
      {makesWay && (
        <p className="-mt-1 text-meta text-muted-foreground">
          {programme(makesWay) ?? makesWay.title} makes way for it there.
        </p>
      )}
    </div>
  );
}
