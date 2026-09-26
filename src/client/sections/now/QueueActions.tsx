import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { apiSend } from "@/api/client";
import type { Credentials } from "../../session/session";
import type { Action, QueueEntry } from "../../../shared/protocol";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export function QueueActions({ entry, index, queue, connected, run, credentials, firstUpcomingIndex, lastUpcomingIndex }: {
  credentials: Credentials;
  entry: QueueEntry;
  index: number;
  queue: QueueEntry[];
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  firstUpcomingIndex: number;
  lastUpcomingIndex: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const save = useMutation({
    mutationFn: () => apiSend(credentials, "/api/for-later", { reference: { kind: "queue", id: entry.id } }, "POST", 20_000),
    onError: error => toast.error(error.message || `Couldn't save ${entry.title}.`),
  });
  return <DropdownMenu modal={false} onOpenChange={open => { if (open) trigger.current?.focus(); }}>
    <DropdownMenuTrigger asChild><Button ref={trigger} data-queue-menu variant="ghost" size="icon" aria-label={`Options for ${entry.title}`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={event => { if (!trigger.current?.isConnected) event.preventDefault(); }}>
      {index >= firstUpcomingIndex && firstUpcomingIndex < lastUpcomingIndex && <>
      {index > firstUpcomingIndex && <><DropdownMenuItem disabled={!connected} onSelect={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[firstUpcomingIndex]?.id ?? null })}>Play next</DropdownMenuItem>
      <DropdownMenuItem disabled={!connected} onSelect={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index - 1]!.id })}>Earlier</DropdownMenuItem></>}
      {index < lastUpcomingIndex && <DropdownMenuItem disabled={!connected} onSelect={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index + 2]?.id ?? null })}>Later</DropdownMenuItem>}
      <DropdownMenuSeparator />
      </>}
      <DropdownMenuItem disabled={!connected || save.isPending} onSelect={() => save.mutate()}>Save for later</DropdownMenuItem>
      <DropdownMenuItem disabled={!connected} onSelect={() => void run({ type: "remove", entryId: entry.id })}>Remove</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
