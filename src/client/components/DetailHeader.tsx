import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { tileAspect, type TileShape } from "@/components/MediaTile";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { cn } from "@/lib/utils";

type Verb = { label: string; run: () => void; disabled?: boolean };

/**
 * An item or collection page's top, laid out like Home's hero: contained artwork at the left (stacked above on narrow
 * screens), the title at display size, one muted meta line, how far it got, then one row of verbs before the synopsis: Play
 * (or Resume, with From start beside it), Queue, Save and Play on, with anything else in one "…" menu. The row is one
 * focus stop per verb, and its first enabled verb is where the page starts.
 */
export function DetailHeader({ title, meta, context, description, thumbnail, shape = "video", duration, position, play, fromStart, queue, save, playOn, more = [], children }: {
  title: string; meta?: string; context?: ReactNode; description?: string | null; thumbnail?: string; shape?: TileShape;
  duration?: number | null; position?: number;
  /** Play, Resume or Play all; `aria` names what plays when it isn't the title (a station's show). */
  play?: Verb & { aria?: string };
  fromStart?: Verb; queue?: Verb;
  save?: { saved: boolean; run: () => void; disabled?: boolean };
  playOn?: { run: (deviceId: string) => void; disabled?: boolean };
  /** Every other verb (Play next, Remove, ordering), in one "…" menu. */
  more?: MenuAction[];
  children?: ReactNode;
}) {
  const { on } = usePlayOn();
  const rest = useItemMenu(more);
  // Navigation passes disabled controls by, so the page starts on the first verb you can press.
  const first = [!play?.disabled && play && "play", !queue?.disabled && queue && "queue", !save?.disabled && save && "save"].find(Boolean);
  const verbs = !!(play || fromStart || queue || save || playOn || more.length);
  return <header className={cn("grid gap-x-8 gap-y-6 md:items-start lg:gap-x-12", thumbnail && "md:grid-cols-[fit-content(min(45%,36rem))_minmax(0,1fr)]")}>
    {/* Artwork as it comes, at a set height and its own width (Home's hero), so the title follows it whatever its shape;
        a wide one stops at the column's cap. Missing artwork keeps its shape's frame. */}
    {thumbnail && <div aria-hidden="true" className="flex h-56 min-w-0 md:h-64 xl:h-80 [&_img]:aspect-auto [&_img]:bg-transparent"><MediaArtwork thumbnail={thumbnail} title={title} className={cn("h-full w-auto max-w-full object-contain object-left-top", tileAspect[shape])} /></div>}
    <div className="grid min-w-0 content-start gap-2">
      <h1 tabIndex={-1} className="text-3xl leading-tight md:text-4xl font-semibold tracking-tight break-words outline-none">{title}</h1>
      {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
      {context}
      {duration != null && <DurationBar duration={duration} position={position} />}
      {verbs && <div data-nav-row className="mt-4 flex flex-wrap items-center gap-2 max-md:[&>:first-child]:w-full">
        {play && <Button data-page-first={first === "play" || undefined} size="lg" aria-label={on(`${play.label} ${play.aria ?? title}`)} disabled={play.disabled} onClick={play.run}><Play aria-hidden="true" />{on(play.label)}</Button>}
        {fromStart && <Button variant="ghost" size="lg" disabled={fromStart.disabled} onClick={fromStart.run}>{fromStart.label}</Button>}
        {queue && <Button data-page-first={first === "queue" || undefined} variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>{queue.label}</Button>}
        {save && <Button data-page-first={first === "save" || undefined} variant="ghost" size="lg" aria-pressed={save.saved} disabled={save.disabled} onClick={save.run}>{save.saved ? "Saved" : "Save"}</Button>}
        {/* Play on waits for another device that can play it. */}
        {playOn && <PlayOnMenu size="lg" title={title} disabled={playOn.disabled} onPlay={playOn.run} />}
        {/* The page's own "…", always shown: the header is no item that reveals it. */}
        <ItemMenu menu={rest} size="icon-lg" title={title} className="opacity-100" />
      </div>}
      {description && <p className="mt-4 max-w-prose whitespace-pre-line text-sm leading-relaxed break-words text-muted-foreground">{description}</p>}
      {children}
    </div>
  </header>;
}
