import { ChevronRight, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { RadioRecognitionEntry } from "../../shared/radio-recognition";
import { MediaArtwork } from "./MediaArtwork";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Item } from "./ui/item";

/** The same observation in the player and Saved; the whole row opens its details. */
export function RadioRecognitionItem({ entry, history = false, onDismiss }: {
  entry: RadioRecognitionEntry; history?: boolean; onDismiss?: () => void;
}) {
  const { track } = entry;
  const time = new Date(entry.sampledAt);
  const title = track?.title ?? "No song identified";
  return <Dialog>
    <div className="flex min-w-0 items-start gap-1">
      <DialogTrigger asChild>
        <Item asChild size="sm" className="min-w-0 flex-1 flex-nowrap gap-3 rounded-sm border-0 p-0 text-left hover:[&_[data-recognition-title]]:underline">
          <button type="button" aria-label={`Details for ${title}`}>
            <MediaArtwork thumbnail={track?.artworkUrl} title={title} className="aspect-square size-14 shrink-0 rounded-sm object-contain" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span data-recognition-title className="line-clamp-2 text-base leading-snug font-medium break-words underline-offset-4">{title}</span>
              {track?.artist && <span className="truncate text-sm text-muted-foreground">{track.artist}</span>}
              {history && <span className="line-clamp-2 text-sm text-pretty text-muted-foreground">{entry.station.name}{entry.programme && `, ${entry.programme}`}</span>}
              <span className="text-meta text-muted-foreground">{!history && "Identified at "}<time dateTime={time.toISOString()}>{history ? time.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </Item>
      </DialogTrigger>
      {onDismiss && <Button variant="ghost" size="icon-sm" aria-label="Clear result" title="Clear result" onClick={onDismiss}><X aria-hidden="true" /></Button>}
    </div>
    <DialogContent aria-describedby={undefined} className="gap-6 sm:max-w-xl">
      <div className="grid min-w-0 gap-5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
        <MediaArtwork thumbnail={track?.artworkUrl} title={title} className="aspect-square w-40 rounded-sm object-contain max-sm:mx-auto" />
        <div className="grid min-w-0 gap-2 pr-5">
          <DialogTitle className="text-2xl leading-tight break-words">{title}</DialogTitle>
          {track?.artist && <p className="text-base break-words">{track.artist}</p>}
          {track?.album && <p className="text-sm text-muted-foreground break-words">{track.album}</p>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm [&>dt]:text-muted-foreground [&>dd]:break-words">
        <dt>Time</dt><dd><time dateTime={time.toISOString()}>{time.toLocaleString([], { dateStyle: "long", timeStyle: "short" })}</time></dd>
        <dt>Radio</dt><dd>{entry.station.name}</dd>
        {entry.programme && <><dt>Programme</dt><dd>{entry.programme}</dd></>}
        <dt>Requested by</dt><dd>{entry.requestedBy.name}</dd>
      </dl>
      {!history && <Button asChild variant="secondary" className="justify-self-start"><Link to="/saved" search={{ tab: "identified" }}>View history</Link></Button>}
    </DialogContent>
  </Dialog>;
}
