import { Bookmark, Play } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Stage, StageTitle } from "@/components/Stage";
import { Button } from "@/components/ui/button";
import { DurationBar } from "@/components/DurationBar";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import type { ArtShape } from "@/art-shape";
import { metaLine, withoutUrls } from "@/media-caption";
import { cn } from "@/lib/utils";

type Verb = { label: string; run: () => void; disabled?: boolean };

/** A header's verbs: on a phone the primary takes the line, and the verb that starts the next pulls back by its padding
 * so its word or glyph lines up with the title above. */
export const verbRow = "flex flex-wrap items-center gap-2 max-md:[&>:first-child]:w-full max-md:[&>:nth-child(2)[data-size=lg]]:-ml-5 max-md:[&>:nth-child(2)[data-size=icon-lg]]:-ml-3";


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
 * An item or collection page's top, a Stage (Stage.tsx) as Home's hero is: the picture at the right under the header,
 * then at the bottom left the trail, the title at display size, one muted meta line and its links, how far it got, then
 * one row of verbs before the synopsis: Play (or Resume, with From start beside it), Queue, Save and Play on, with
 * anything else in one "…" menu. The row is one focus stop per verb, and its first enabled verb is where the page starts.
 */
export function DetailHeader({ title, meta, context, description, thumbnail, shape = "video", fit, duration, position, play, fromStart, queue, save, playOn, more = [], trail, children }: {
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
  /** The page's ancestors (ContentBreadcrumb), above the title. */
  trail?: ReactNode;
  children?: ReactNode;
}) {
  const { on } = usePlayOn();
  const rest = useItemMenu(more);
  // Navigation passes disabled controls by, so the page starts on the first verb you can press.
  const first = [!play?.disabled && play && "play", !queue?.disabled && queue && "queue", !save?.disabled && save && "save"].find(Boolean);
  const verbs = !!(play || fromStart || queue || save || playOn || more.length);
  return <Stage data-detail-header thumbnail={thumbnail ?? ""} shape={shape} fit={fit} title={title}>
    <div className="grid w-full justify-items-start gap-3">
      {trail}
      <StageTitle title={title} />
    </div>
    {(meta || context || duration != null) && <div className="grid justify-items-start gap-1">
      {meta && <p className="text-base text-muted-foreground">{metaLine(meta)}</p>}
      {context}
      {duration != null && <DurationBar duration={duration} position={position} />}
    </div>}
    {verbs && <div data-nav-row className={cn("mt-1 w-full", verbRow)}>
      {play && <Button data-page-first={first === "play" || undefined} size="lg" aria-label={on(`${play.label} ${play.aria ?? title}`)} disabled={play.disabled} onClick={play.run}><Play aria-hidden="true" className="fill-current" />{on(play.label)}</Button>}
      {fromStart && <Button variant="ghost" size="lg" disabled={fromStart.disabled} onClick={fromStart.run}>{fromStart.label}</Button>}
      {queue && <Button data-page-first={first === "queue" || undefined} variant="ghost" size="lg" disabled={queue.disabled} onClick={queue.run}>{queue.label}</Button>}
      {/* Play on waits for another device that can play it. */}
      {playOn && <PlayOnMenu size="lg" title={title} disabled={playOn.disabled} onPlay={playOn.run} />}
      {save && <SaveToggle data-page-first={first === "save" || undefined} saved={save.saved} disabled={save.disabled} onClick={save.run} />}
      {/* The page's own "…", always shown: the header is no item that reveals it. */}
      <ItemMenu menu={rest} size="icon-lg" title={title} className="opacity-100" />
    </div>}
    <Description text={description} />
    {children}
  </Stage>;
}
