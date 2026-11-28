import { CommandGroup, CommandItem } from "@/components/ui/command";
import { collectionLocation } from "@/detail-navigation";
import { cn } from "@/lib/utils";
import { linkPlays, listLabel, listLimit, usePastedList, type LinkVerb } from "@/pasted-link";
import { useSessionGate } from "@/session/session-context";
import { linkTarget } from "../../../shared/providers";

/**
 * The palette for a pasted link: a list's Play all and Queue all, one thing's Play, Queue and Play next, a page's Open,
 * each named by what it plays once its page says; then Choose how to play, on the results page.
 */
export function PaletteLink({
  url,
  connected,
  onOpen,
  onLink,
  onSearch,
}: {
  url: string;
  connected: boolean;
  onOpen: (href: string) => void;
  onLink: (verb: LinkVerb, list: { title?: string; count?: number }) => void;
  onSearch: () => void;
}) {
  const { credentials } = useSessionGate();
  const target = linkTarget(url);
  const list = usePastedList(credentials, url, target);
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
      <CommandItem value="query" onSelect={onSearch}>
        Choose how to play
      </CommandItem>
    </CommandGroup>
  );
}
