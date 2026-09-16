import { SaveForLater } from "./SaveForLater";
import type { Credentials } from "./session/session";
import { useState } from "react";
import { MoreHorizontal, ArrowUp, ArrowDown, X, RotateCcw } from "lucide-react";
import type { Action, QueueEntry } from "../shared/protocol";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function QueueActions({ entry, index, queue, connected, canPlay, run, credentials }: {
  credentials: Credentials;
  entry: QueueEntry; index: number; queue: QueueEntry[]; connected: boolean; canPlay: boolean;
  run: (action: Action) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon" aria-label={`Queue options for ${entry.title}`}><MoreHorizontal /></Button></PopoverTrigger>
    <PopoverContent align="end" className="queue-actions grid w-60 gap-1 p-2" aria-label={`Queue options for ${entry.title}`}>
      <SaveForLater origin={credentials.origin} token={credentials.token} connected={connected} reference={{ kind: "queue", id: entry.id }} title={entry.title} />
      {/^(library:|file:|jellyfin:)/.test(entry.source) && <Button variant="ghost" className="justify-start" disabled={!canPlay} onClick={async () => { if (await run({ type: "play", entryId: entry.id, fromStart: true })) setOpen(false); }}><RotateCcw />Play from start</Button>}
      <Button variant="ghost" className="justify-start" aria-label={`Move ${entry.title} up`} disabled={!connected || index === 0} onClick={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index - 1]!.id })}><ArrowUp />Move up</Button>
      <Button variant="ghost" className="justify-start" aria-label={`Move ${entry.title} down`} disabled={!connected || index === queue.length - 1} onClick={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index + 2]?.id ?? null })}><ArrowDown />Move down</Button>
      <Button variant="ghost" className="justify-start" aria-label={`Remove ${entry.title}`} disabled={!connected} onClick={async () => {
        if (await run({ type: "remove", entryId: entry.id })) {
          setOpen(false);
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.queue-play:not(:disabled)')?.focus());
        }
      }}><X />Remove from queue</Button>
    </PopoverContent>
  </Popover>;
}
