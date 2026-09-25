import { SaveForLater } from "@/components/SaveForLater";
import type { Credentials } from "../../session/session";
import type { Action, QueueEntry } from "../../../shared/protocol";
import { Button } from "@/components/ui/button";

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
  return <>
    {index > firstUpcomingIndex && <Button variant="ghost" aria-label={`Move ${entry.title} earlier`} disabled={!connected} onClick={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index - 1]!.id })}>Earlier</Button>}
    {index < lastUpcomingIndex && <Button variant="ghost" aria-label={`Move ${entry.title} later`} disabled={!connected} onClick={() => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index + 2]?.id ?? null })}>Later</Button>}
    <SaveForLater origin={credentials.origin} token={credentials.token} connected={connected} reference={{ kind: "queue", id: entry.id }} title={entry.title} />
    <Button variant="ghost" aria-label={`Remove ${entry.title}`} disabled={!connected} onClick={() => void run({ type: "remove", entryId: entry.id })}>Remove</Button>
  </>;
}
