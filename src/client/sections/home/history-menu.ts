import { useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { historyQuery, markWatched, removeFromContinue, undoProgressAction } from "@/api/progress";
import { usePlayOn } from "@/components/PlayOn";
import type { MenuAction } from "@/components/RowMenu";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import {
  historyReference,
  saveAction,
  useDetailAction,
  useForLaterSaves,
} from "@/sections/details/save";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { failed } from "@/toasts";
import type { PlayOn } from "../../../shared/protocol";
import type { HistoryItem } from "../../../shared/viewing";
import { itemTarget, useHomeAction } from "./AddToHome";

/**
 * A played item's menu, on Home and in Saved's Played. `press` is what the item's press does, so the menu doesn't
 * repeat it; in Continue (`continues`) it also holds Remove from Continue. An episode can be marked as watched, so its
 * series' Play goes on to the next one.
 */
export function useHistoryMenu() {
  const shell = useShell();
  const { credentials, available } = shell;
  const { connected, state, queue, offerUndo } = useSessionGate();
  const { play } = usePlayOn();
  const details = useDetailNavigation();
  const client = useQueryClient();
  const saves = useForLaterSaves(useDetailAction());
  const homeAction = useHomeAction();
  const refresh = () =>
    void client.invalidateQueries({ queryKey: historyQuery(credentials).queryKey.slice(0, 1) });
  const attempt = (title: string, work: () => Promise<unknown>) =>
    void work().catch((reason) => failed(`Couldn't change ${title}.`, reason));
  const remove = async (item: HistoryItem) => {
    const result = await removeFromContinue(credentials, item.mediaId);
    refresh();
    if (result.undoToken && result.expiresAt && result.expiresAt > Date.now())
      offerUndo(
        `Removed ${item.title} from Continue.`,
        async () => {
          await undoProgressAction(credentials, result.undoToken!);
          refresh();
        },
        result.expiresAt - Date.now(),
      );
  };
  const mark = async (item: HistoryItem, watched: boolean) => {
    await markWatched(credentials, item.mediaId, watched);
    refresh();
    offerUndo(`Marked ${item.title} as ${watched ? "watched" : "unwatched"}.`, async () => {
      await markWatched(credentials, item.mediaId, !watched);
      refresh();
    });
  };
  return (
    item: HistoryItem,
    { press, continues = false }: { press: "Resume" | "Details"; continues?: boolean },
  ): MenuAction[] => {
    const playable = connected && available && !!(item.playable || item.queueEntryId);
    const resumes = item.position > 0 && !item.watched;
    const start = (fromStart: boolean, on?: PlayOn) =>
      void play((on) => shell.playHistory(item, { fromStart, on }), on).catch((reason) =>
        failed(`Couldn't play ${item.title}.`, reason),
      );
    return [
      ...(press === "Details"
        ? [
            {
              label: resumes ? "Resume" : "Play",
              group: "play",
              disabled: !playable,
              run: () => start(!resumes),
            },
          ]
        : []),
      ...(item.position > 0
        ? [{ label: "From start", group: "play", disabled: !playable, run: () => start(true) }]
        : []),
      {
        label: "Queue",
        group: "play",
        disabled: !connected,
        run: () =>
          void queue(item.title, () =>
            apiSend(credentials, `/api/progress/${encodeURIComponent(item.mediaId)}/queue`, {
              profileId: state?.activeProfile.id,
            }),
          ).catch((reason) => failed(`Couldn't queue ${item.title}.`, reason)),
      },
      {
        label: "Play on",
        group: "play",
        disabled: !playable || !item.playable,
        thumbnail: item.thumbnail,
        verb: resumes ? "Resume" : undefined,
        playOn: (on) => start(!resumes, on),
      },
      ...(item.url ? [saveAction(saves(item.url, () => historyReference(item)))] : []),
      ...homeAction(itemTarget(item)),
      ...(press === "Resume"
        ? [
            {
              label: "Details",
              group: "go",
              run: () => details.open(itemLocation("history", item.mediaId)),
            },
          ]
        : []),
      ...browserActions(item.url, item.title),
      ...(item.collection
        ? [
            {
              label: item.watched ? "Mark as unwatched" : "Mark as watched",
              group: "list",
              disabled: !connected,
              run: () => attempt(item.title, () => mark(item, !item.watched)),
            },
          ]
        : []),
      ...(continues
        ? [
            {
              label: "Remove from Continue",
              group: "list",
              disabled: !connected,
              run: () => attempt(item.title, () => remove(item)),
            },
          ]
        : []),
    ];
  };
}
