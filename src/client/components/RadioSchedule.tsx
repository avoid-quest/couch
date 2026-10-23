import type { ReactNode } from "react";
import type { RadioProgrammeDetails, RadioScheduleEntry } from "../../shared/radio";
import { ProgressLine } from "./DurationBar";
import { useRadioClock } from "@/radio-clock";
import { MediaArtwork } from "./MediaArtwork";
import { metaLine } from "@/media-caption";
import { cn } from "@/lib/utils";

/** Couch's clock (time-format.ts): local hours and minutes, with the weekday only when it isn't today. */
export const radioTime = (at: number, now = Date.now()) => new Date(at).toLocaleString([], {
  ...new Date(at).toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" }, hour: "2-digit", minute: "2-digit", hour12: false,
});

/** A broadcast's progress as the Stage's progress line, with what's left and its local window; never a seek control. */
export function RadioProgress({ show }: { show?: RadioProgrammeDetails | null }) {
  const now = useRadioClock([], show);
  if (show?.start === undefined || show.end === undefined || now < show.start || now >= show.end) return null;
  return <ProgressLine position={(now - show.start) / 1000} duration={(show.end - show.start) / 1000} label={`${Math.ceil((show.end - now) / 60_000)} min left, ${radioTime(show.start, now)}–${radioTime(show.end, now)}`} />;
}

/** A schedule line, as Live TV's guide says it: the start time, light, then the title. */
export function RadioSlot({ show, className }: { show: Pick<RadioScheduleEntry, "start" | "title">; className?: string }) {
  return <span className={className}><time dateTime={new Date(show.start).toISOString()} className="font-light tabular-nums">{radioTime(show.start)}</time> {show.title}</span>;
}

/** What follows the show: a schedule line, its categories and end, then its synopsis. Nothing of the live show carries over. */
export function RadioNext({ show, className }: { show?: RadioScheduleEntry; className?: string }) {
  if (!show) return null;
  return <section aria-label="Next programme" className={cn("flex w-full max-w-prose min-w-0 items-start gap-3", className)}>
    {show.artworkUrl && <div aria-hidden="true" className="size-14 shrink-0 overflow-hidden rounded-sm bg-muted [&>*]:size-full [&_img]:object-cover"><MediaArtwork thumbnail={show.artworkUrl} title={show.title} /></div>}
    <div className="grid min-w-0 gap-caption">
      <RadioSlot show={show} className="text-body break-words" />
      <p className="text-meta text-muted-foreground">{metaLine(...show.categories ?? [], `until ${radioTime(show.end)}`)}</p>
      {show.description && <p className="line-clamp-2 text-meta break-words text-muted-foreground">{show.description}</p>}
    </div>
  </section>;
}

/** A station under its show: its link (or its name on its own page), then its tags. */
export function RadioStationLine({ station, tags = [], className }: { station: ReactNode; tags?: string[]; className?: string }) {
  return <span className={cn("flex min-w-0 flex-wrap items-baseline gap-x-3 text-muted-foreground [&_[data-media-context]]:[font-size:inherit]", className)}>{station}{!!tags.length && <span>{tags.join(", ")}</span>}</span>;
}
