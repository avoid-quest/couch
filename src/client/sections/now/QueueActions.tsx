import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiSend } from "@/api/client";
import type { Credentials } from "../../session/session";
import type { Action, QueueEntry } from "../../../shared/protocol";
import type { MenuAction } from "@/components/RowMenu";
import { queueItemLocation } from "@/detail-navigation";
import { failed } from "@/toasts";

export type QueueActionsProps = {
  credentials: Credentials;
  entry: QueueEntry;
  index: number;
  queue: QueueEntry[];
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  firstUpcomingIndex: number;
  lastUpcomingIndex: number;
};

/** An Up next entry's other verbs: Details, Play next, Earlier, Later, Save for later and Remove. Nothing for rows without them. */
export function useQueueActions(props?: QueueActionsProps): MenuAction[] {
  const save = useMutation({
    mutationFn: () => apiSend(props!.credentials, "/api/for-later", { reference: { kind: "queue", id: props!.entry.id } }, "POST", 20_000),
    onError: error => failed(`Couldn't save ${props?.entry.title}.`, error),
  });
  if (!props) return [];
  const { entry, index, queue, connected, run, firstUpcomingIndex, lastUpcomingIndex } = props;
  const upcoming = index >= firstUpcomingIndex && firstUpcomingIndex < lastUpcomingIndex;
  return [
    ...(!entry.liveSourceId ? [{ label: "Details", node: <Link to={queueItemLocation(entry)}>Details</Link> }] : []),
    ...(upcoming && index > firstUpcomingIndex ? [
      { label: "Play next", disabled: !connected, run: () => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[firstUpcomingIndex]?.id ?? null }) },
      { label: "Earlier", disabled: !connected, run: () => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index - 1]!.id }) },
    ] : []),
    ...(upcoming && index < lastUpcomingIndex ? [{ label: "Later", disabled: !connected, run: () => void run({ type: "move", entryId: entry.id, beforeEntryId: queue[index + 2]?.id ?? null }) }] : []),
    ...(!entry.liveSourceId ? [{ label: "Save for later", disabled: !connected || save.isPending, run: () => save.mutate() }] : []),
    { label: "Remove", disabled: !connected, run: () => void run({ type: "remove", entryId: entry.id }) },
  ];
}
