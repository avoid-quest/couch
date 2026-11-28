import { playbackControls } from "@/session/playback-controls";
import { useOptionalSessionGate } from "@/session/session-context";
import { browserActions, queuePageUrl } from "@/original-page";
import type { Credentials } from "../../session/session";
import type { Action, QueueEntry } from "../../../shared/protocol";
import type { MenuAction } from "@/components/RowMenu";
import { queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { saveAction, useDetailAction, useForLaterToggle } from "@/sections/details/save";

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

/**
 * An Up next entry's other verbs: Play next, Save, Details, its page, Move up, Move down and Remove from Up next.
 * Nothing for rows without them.
 */
export function useQueueActions(props?: QueueActionsProps): MenuAction[] {
  const details = useDetailNavigation();
  const session = useOptionalSessionGate();
  const save = useForLaterToggle(
    props ? queuePageUrl(props.entry) : undefined,
    () => ({ kind: "queue", id: props!.entry.id }),
    useDetailAction(),
  );
  if (!props || !playbackControls(session?.state).queue) return [];
  const { entry, index, queue, connected, run, firstUpcomingIndex, lastUpcomingIndex } = props;
  const upcoming = index >= firstUpcomingIndex && firstUpcomingIndex < lastUpcomingIndex;
  const move = (beforeEntryId: string | null) =>
    void run({ type: "move", entryId: entry.id, beforeEntryId });
  return [
    ...(upcoming && index > firstUpcomingIndex
      ? [
          {
            label: "Play next",
            group: "play",
            disabled: !connected,
            run: () => move(queue[firstUpcomingIndex]?.id ?? null),
          },
          {
            label: "Move up",
            group: "list",
            disabled: !connected,
            run: () => move(queue[index - 1]!.id),
          },
        ]
      : []),
    ...(upcoming && index < lastUpcomingIndex
      ? [
          {
            label: "Move down",
            group: "list",
            disabled: !connected,
            run: () => move(queue[index + 2]?.id ?? null),
          },
        ]
      : []),
    ...(!entry.liveSourceId
      ? [
          saveAction({ ...save, disabled: !connected || save.disabled }),
          // Details opens as any detail does, so it keeps the section (Home, the player) and Back finds the entry again.
          { label: "Details", group: "go", run: () => details.open(queueItemLocation(entry)) },
        ]
      : []),
    ...browserActions(queuePageUrl(entry), entry.title),
    {
      label: "Remove from Up next",
      group: "list",
      disabled: !connected,
      run: () => void run({ type: "remove", entryId: entry.id }),
    },
  ];
}
