import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { RadioRecognitionEntry } from "../../shared/radio-recognition";
import { searchLocation } from "@/search";
import { MediaArtwork } from "./MediaArtwork";
import { Button } from "./ui/button";
import { Item } from "./ui/item";

/** A found song opens Couch's existing search across all sources. */
export function RadioRecognitionItem({ entry, history = false, onDismiss }: {
  entry: RadioRecognitionEntry; history?: boolean; onDismiss?: () => void;
}) {
  const { track } = entry;
  const time = new Date(entry.sampledAt);
  const title = track?.title ?? "No song identified";
  const query = [track?.artist, track?.title].filter(Boolean).join(" ");
  const content = <>
    <MediaArtwork thumbnail={track?.artworkUrl} title={title} className="aspect-square size-14 shrink-0 rounded-sm object-contain" />
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span data-recognition-title className={`line-clamp-2 text-base leading-snug font-medium break-words underline-offset-4${track ? " underline decoration-foreground/40 group-hover/item:decoration-foreground" : ""}`}>{title}</span>
      {track?.artist && <span className="text-sm text-muted-foreground">{track.artist}</span>}
      {history && track?.album && <span className="text-sm text-muted-foreground">{track.album}</span>}
      {history && <span className="text-sm text-pretty text-muted-foreground">{entry.station.name}{entry.programme && `, ${entry.programme}`}</span>}
      <span className="text-meta text-muted-foreground">{!history && "Identified at "}<time dateTime={time.toISOString()}>{history ? time.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
      {history && <span className="text-meta text-muted-foreground">Requested by {entry.requestedBy.name}</span>}
    </span>
  </>;
  return <div className="flex min-w-0 items-center gap-3">
    <Item asChild size="sm" className="min-w-0 flex-1 flex-nowrap gap-3 rounded-sm border-0 p-0 text-left">
      {track ? <Link to={searchLocation({ query, source: "All" })} aria-label={`Search Couch for ${query}`}>{content}</Link> : <div>{content}</div>}
    </Item>
    {onDismiss && <Button variant="ghost" size="icon-sm" aria-label="Clear result" title="Clear result" onClick={onDismiss}><X aria-hidden="true" /></Button>}
  </div>;
}
