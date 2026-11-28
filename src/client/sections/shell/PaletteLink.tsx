import { useEffect, useState } from "react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { collectionLocation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import {
  linkPlays,
  listLabel,
  listLimit,
  useLinkStation,
  usePastedList,
  type LinkVerb,
} from "@/pasted-link";
import { useSessionGate } from "@/session/session-context";
import { linkTarget } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";

/**
 * The palette for a pasted link: a list's Play all and Queue all, one thing's Play, Queue and Play next, a page's Open,
 * each named by what it plays once its page says, a station's page its station's Play; then Choose how to play, on the
 * results page.
 */
export function PaletteLink({
  url,
  connected,
  onOpen,
  onLink,
  onPlayStation,
  onSearch,
}: {
  url: string;
  connected: boolean;
  onOpen: (href: string) => void;
  onLink: (verb: LinkVerb, list: { title?: string; count?: number }) => void;
  onPlayStation: (station: RadioStation) => void;
  onSearch: () => void;
}) {
  const { credentials } = useSessionGate();
  const target = linkTarget(url);
  const list = usePastedList(credentials, url, target);
  const station = useLinkStation(credentials, url, target);
  // Enter before Couch has found the station waits for it, then plays it (or opens the page when there's none); the press
  // belongs to the link it was made on, so editing the field drops it.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const waiting = waitingFor === url;
  useEffect(() => {
    if (waitingFor && waitingFor !== url) setWaitingFor(null);
  }, [url]);
  useEffect(() => {
    if (!waiting || station === undefined) return;
    setWaitingFor(null);
    if (station) onPlayStation(station);
    else window.open(url, "_blank", "noopener,noreferrer");
  }, [waiting, station]);
  const where = url.replace(/^https?:\/\//i, "");
  const shape = target?.shape ?? "atom";
  // The first row reads as the link itself; the verbs after it are plain rows.
  const lead = "min-h-11! text-title! font-medium tv:min-h-14! tv:text-2xl! tv:tracking-tight";
  const open = target && (
    <CommandItem
      value="link:open"
      className={cn(shape === "page" && lead)}
      onSelect={() => onOpen(collectionLocation({ provider: target.provider, url }))}
    >
      <span className="shrink-0">Open</span>
      {shape === "page" && (
        <span className="min-w-0 truncate font-normal text-muted-foreground">{where}</span>
      )}
    </CommandItem>
  );
  const verb = (value: LinkVerb, label: string, className?: string) => (
    <CommandItem
      value={`link:${value}`}
      disabled={!connected}
      onSelect={() => onLink(value, list)}
      className={className}
    >
      <span className="shrink-0">{label}</span>
      {value === "play" && (
        <span className="min-w-0 truncate font-normal text-muted-foreground">
          {list.title ?? where}
        </span>
      )}
      {shape === "playlist" && listLimit(list.count, value === "play" ? 0 : list.queued) && (
        <span className="ml-auto shrink-0 font-normal text-muted-foreground">
          {listLimit(list.count, value === "play" ? 0 : list.queued)}
        </span>
      )}
    </CommandItem>
  );
  const choose = (
    <CommandItem value="query" onSelect={onSearch}>
      Choose how to play
    </CommandItem>
  );
  // A station's page plays its station live, once Couch finds it, else opens in the browser; nothing here plays the
  // page itself.
  if (shape === "station")
    return (
      <CommandGroup>
        {station && (
          <CommandItem
            value="link:play"
            disabled={!connected}
            onSelect={() => onPlayStation(station)}
            className={lead}
          >
            <span className="shrink-0">Play</span>
            <span className="min-w-0 truncate font-normal text-muted-foreground">
              {station.name}
            </span>
          </CommandItem>
        )}
        {station === undefined && (
          <CommandItem
            value="link:play"
            disabled={!connected}
            onSelect={() => setWaitingFor(url)}
            className={lead}
          >
            <span className="shrink-0">Play</span>
            <span className="min-w-0 truncate font-normal text-muted-foreground">
              {waiting ? "Finding the station…" : where}
            </span>
          </CommandItem>
        )}
        {station === null && (
          <CommandItem
            value="link:play"
            onSelect={() => window.open(url, "_blank", "noopener,noreferrer")}
            className={lead}
          >
            <span className="shrink-0">Open in browser</span>
            <span className="min-w-0 truncate font-normal text-muted-foreground">{where}</span>
          </CommandItem>
        )}
        {choose}
      </CommandGroup>
    );
  return (
    <CommandGroup>
      {shape === "page" && open}
      {shape === "playlist" ? (
        <>
          {verb("play", listLabel("Play all", list.count), lead)}
          {verb("queue", listLabel("Queue all", list.count))}
        </>
      ) : (
        <>
          {linkPlays(target) && verb("play", "Play", shape === "page" ? undefined : lead)}
          {shape !== "page" && verb("queue", "Queue")}
        </>
      )}
      {shape !== "page" && verb("next", "Play next")}
      {shape !== "page" && open}
      {choose}
    </CommandGroup>
  );
}
