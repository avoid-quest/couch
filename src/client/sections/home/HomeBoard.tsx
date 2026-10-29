import type { ReactNode } from "react";
import { MediaArtwork } from "@/components/MediaArtwork";
import { MediaList } from "@/components/MediaRow";
import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { ShelfHeading } from "@/components/Shelf";

/**
 * Your own rows (Continue, For later, Played recently, Up next) as one board: short lists side by side, sharing the
 * page's width in columns of at least 20rem, so their titles have the room to be read whole. Phones stack them. Each list holds its first few; its heading opens the rest.
 */
export function Board({ children }: { children: ReactNode }) {
  return <div data-home-board className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] items-start gap-x-12 gap-y-10">{children}</div>;
}

export function BoardList({ title, href, time, loading = false, more, children }: { title: string; href?: string; time?: string; loading?: boolean; more?: ReactNode; children?: ReactNode }) {
  return <section aria-label={title} aria-busy={loading || undefined} className="grid min-w-0 content-start gap-2">
    <ShelfHeading title={title} href={href} time={time} loading={loading} />
    {loading ? <MediaRowsSkeleton compact shape="video" count={3} label={`Loading ${title}…`} /> : <MediaList aria-label={title} className="border-t-0 [&>li]:border-0 [&>li]:py-2.5">{children}</MediaList>}
    {more}
  </section>;
}

/** A board row's thumbnail: the artwork, and how far it got as a line along its foot. */
export function BoardArt({ thumbnail, title, progress }: { thumbnail?: string; title: string; progress?: number }) {
  return <>
    <MediaArtwork thumbnail={thumbnail} title={title} />
    {progress != null && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5! bg-black/60"><span className="block h-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} /></span>}
  </>;
}
