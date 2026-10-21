import { Bookmark, Play } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { artAspect, detailArt, type ArtShape } from "@/art-shape";
import { withoutUrls } from "@/media-caption";
import { cn } from "@/lib/utils";
import { AmbientLight } from "@/components/AmbientLight";

type Verb = { label: string; run: () => void; disabled?: boolean };


/** Save as a bookmark that fills once saved: one fixed-width toggle, so Saved moves nothing beside it. */
export function SaveToggle({ saved, ...props }: { saved: boolean } & Omit<ComponentProps<typeof Button>, "children">) {
  return <Button variant="ghost" size="icon-lg" aria-label="Save" aria-pressed={saved} title={saved ? "Saved" : "Save"} {...props}>
    <Bookmark aria-hidden="true" className={cn(saved && "fill-current")} />
  </Button>;
}

/** A synopsis without bare addresses, three lines until More. */
export function Description({ text, className }: { text?: string | null; className?: string }) {
  const shown = withoutUrls(text);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const node = body.current;
    if (node && !open) setLong(node.scrollHeight > node.clientHeight + 1);
  }, [shown, open]);
  if (!shown) return null;
  return <div className={cn("grid max-w-prose justify-items-start", className)}>
    <p ref={body} id={id} className={cn("whitespace-pre-line text-sm leading-relaxed break-words text-muted-foreground", !open && "line-clamp-3")}>{shown}</p>
    {(long || open) && <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} className="-ml-2 px-2" onClick={() => setOpen(value => !value)}>{open ? "Less" : "More"}</Button>}
  </div>;
}

/**
 * An item or collection page's top, laid out like Home's hero: artwork in its shape at the left (stacked above on narrow
 * screens), the title at display size, one muted meta line, how far it got, then one row of verbs before the synopsis: Play
 * (or Resume, with From start beside it), Queue, Save and Play on, with anything else in one "…" menu. The row is one
 * focus stop per verb, and its first enabled verb is where the page starts.
 */
export function DetailHeader({ title, meta, context, description, thumbnail, shape = "video", fit, duration, position, play, fromStart, queue, save, playOn, more = [], children }: {
  title: string; meta?: string; context?: ReactNode; description?: string | null; thumbnail?: string; shape?: ArtShape;
  /** Logos keep their margins: contain them in the frame. */
  fit?: "contain";
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
  const art = useRef<HTMLDivElement>(null);
  // The cover lights the page around it, out to the window's edges (AmbientLight), and falls away above it, where the
  // trail's muted links sit close.
  return <header className={cn("relative grid gap-x-8 gap-y-6 md:items-start lg:gap-x-12", thumbnail && "md:grid-cols-[fit-content(45%)_minmax(0,1fr)]")}>
    {thumbnail && <AmbientLight src={thumbnail} anchor={art} className="-inset-x-(--gutter) -bottom-16 [mask-image:linear-gradient(transparent,#000_1.5rem,#000_calc(100%-3rem),transparent)]" />}
    {thumbnail && <div ref={art} data-detail-art aria-hidden="true" className={cn("max-w-full overflow-hidden bg-muted", artAspect[shape], detailArt[shape])}>
      <MediaArtwork thumbnail={thumbnail} title={title} className={cn("aspect-auto size-full", fit === "contain" ? "object-contain" : "object-cover")} />
    </div>}
    <div className="grid min-w-0 content-start gap-2">
      <h1 tabIndex={-1} className="text-3xl leading-tight md:text-4xl font-semibold tracking-tight break-words outline-none">{title}</h1>
      {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
      {context}
      {duration != null && <DurationBar duration={duration} position={position} />}
      {verbs && <div data-nav-row className="mt-4 flex flex-wrap items-center gap-2 max-md:[&>:first-child]:w-full">
        {play && <Button data-page-first={first === "play" || undefined} size="lg" aria-label={on(`${play.label} ${play.aria ?? title}`)} disabled={play.disabled} onClick={play.run}><Play aria-hidden="true" />{on(play.label)}</Button>}
        {fromStart && <Button variant="ghost" size="lg" disabled={fromStart.disabled} onClick={fromStart.run}>{fromStart.label}</Button>}
        {queue && <Button data-page-first={first === "queue" || undefined} variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>{queue.label}</Button>}
        {/* Play on waits for another device that can play it. */}
        {playOn && <PlayOnMenu size="lg" title={title} disabled={playOn.disabled} onPlay={playOn.run} />}
        {save && <SaveToggle data-page-first={first === "save" || undefined} saved={save.saved} disabled={save.disabled} onClick={save.run} />}
        {/* The page's own "…", always shown: the header is no item that reveals it. */}
        <ItemMenu menu={rest} size="icon-lg" title={title} className="opacity-100" />
      </div>}
      <Description text={description} className="mt-4" />
      {children}
    </div>
  </header>;
}
