import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { tileAspect, type TileShape } from "@/components/MediaTile";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { BrowseActions } from "@/sections/find/SearchPanel";
import type { SearchHit } from "@/sections/find/SearchOnlineResults";
import { cn } from "@/lib/utils";

type Verb = { label: string; run: () => void; disabled?: boolean };

/**
 * An item or collection page's top, laid out like Home's hero: contained artwork at the left (stacked above on narrow
 * screens), the title at display size, one muted meta line, how far it got, the synopsis, then one row of verbs: Play
 * (or Resume, with From start beside it), Queue, Save and Play on, with anything else in one "…" menu. The row is one
 * focus stop per verb, and its first verb is where the page starts.
 */
export function DetailHeader({ title, meta, description, thumbnail, shape = "video", duration, position, play, fromStart, queue, save, playOn, more = [], children }: {
  title: string; meta?: string; description?: string | null; thumbnail?: string; shape?: TileShape;
  duration?: number | null; position?: number;
  /** Play, Resume or Play all; `aria` names what plays when it isn't the title (a station's show). */
  play?: Verb & { aria?: string };
  fromStart?: Verb; queue?: Verb;
  save?: { saved: boolean; run: () => void; disabled?: boolean };
  playOn?: { run: (deviceId: string) => void; disabled?: boolean };
  /** Every other verb (Play next, Remove, ordering), in one "…" menu. */
  more?: SearchHit["actions"];
  children?: ReactNode;
}) {
  const { on } = usePlayOn();
  const first = play ? "play" : queue ? "queue" : save ? "save" : undefined;
  const verbs = !!(play || fromStart || queue || save || playOn || more.length);
  return <header className="grid gap-x-12 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
    {/* Artwork as it comes, at its own aspect ratio on black; missing artwork keeps its shape's frame. */}
    {thumbnail && <div aria-hidden="true" className="h-56 min-w-0 md:h-64 tv:h-72 [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={thumbnail} title={title} className={cn("h-full w-auto max-w-full object-contain", tileAspect[shape])} /></div>}
    <div className="grid min-w-0 content-start gap-2 [--duration-width:6rem] sm:[--duration-width:14rem] lg:[--duration-width:18rem]">
      <h1 tabIndex={-1} className="text-3xl font-semibold tracking-tight break-words outline-none">{title}</h1>
      {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
      {duration != null && <DurationBar duration={duration} position={position} />}
      {description && <p className="mt-2 max-w-prose text-sm leading-relaxed break-words text-muted-foreground">{description}</p>}
      {verbs && <div data-nav-row className="mt-4 flex flex-wrap items-center gap-1 max-md:[&>[data-page-first]]:w-full">
        {play && <Button data-page-first size="lg" aria-label={on(`${play.label} ${play.aria ?? title}`)} disabled={play.disabled} onClick={play.run}>{on(play.label)}</Button>}
        {fromStart && <Button variant="ghost" size="lg" disabled={fromStart.disabled} onClick={fromStart.run}>{fromStart.label}</Button>}
        {queue && <Button data-page-first={first === "queue" || undefined} variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>{queue.label}</Button>}
        {save && <Button data-page-first={first === "save" || undefined} variant="ghost" size="lg" aria-pressed={save.saved} disabled={save.disabled} onClick={save.run}>{save.saved ? "Saved" : "Save"}</Button>}
        {/* Play on waits for another device that can play it. */}
        {playOn && <PlayOnMenu size="lg" title={title} disabled={playOn.disabled} onPlay={playOn.run} />}
        <BrowseActions size="icon-lg" title={title} actions={more} />
      </div>}
      {children}
    </div>
  </header>;
}
