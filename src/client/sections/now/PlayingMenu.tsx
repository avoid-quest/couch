import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { radioStationQuery } from "@/api/radio";
import { useRelatedMenu } from "@/components/MediaContext";
import { playbackCapabilities } from "@/components/PlaybackTransport";
import { ItemMenu, useItemMenu, type MenuAction } from "@/components/RowMenu";
import { saveLabel } from "@/copy";
import { queueItemLocation, useDetailNavigation } from "@/detail-navigation";
import { browserActions, queuePageUrl } from "@/original-page";
import { saveAction, useDetailAction, useForLaterToggle } from "@/sections/details/save";
import { entryTarget, useHomeAction } from "@/sections/home/AddToHome";
import { useStationSave } from "@/sections/home/on-air";
import { useShell } from "@/sections/shell/shell-context";
import { PlaybackClockContext, positionAt } from "@/session/playback-clock";
import type { ClientSessionState } from "@/session/session";
import { isRadio } from "../../../shared/radio";
import type { Action } from "../../../shared/protocol";

// Past its first minute an item can go back to its start; before it, the timeline's start is a tap away anyway.
const fromStartAfter = 60;

/**
 * What plays, its "…" at the top right of the full player and in the side player (docs/design.md "Menus"): From start,
 * Save, Add to Home, Details and where it belongs, and its page beyond Couch. The gear keeps the settings.
 */
export function PlayingMenu({
  state,
  connected,
  run,
  back,
  className,
}: {
  state: ClientSessionState;
  connected: boolean;
  run: (action: Action) => Promise<boolean>;
  /** Where Back from Details returns focus to: this "…" in its player (`[data-playing-menu]`). */
  back?: string;
  className?: string;
}) {
  const { credentials } = useShell();
  const details = useDetailNavigation();
  const homeAction = useHomeAction();
  const current = state.queue.find((entry) => entry.id === state.currentEntryId);
  const page = current && queuePageUrl(current);
  const save = useForLaterToggle(
    page,
    () => ({ kind: "queue", id: current!.id }),
    useDetailAction(),
  );
  const stationId = current?.source.startsWith("radio:") ? current.source.slice(6) : "";
  const station = useQuery({
    ...radioStationQuery(credentials, stationId),
    enabled: connected && !!stationId,
  }).data;
  const stationSave = useStationSave();
  const related = useRelatedMenu(
    current && {
      collection: current.collection,
      creator: current.creator,
      radio: stationId ? { id: stationId, title: current.title } : undefined,
    },
  );
  const player = state.player;
  // Read as the menu draws, which opening it does: no tick while it is closed.
  const clock = useContext(PlaybackClockContext);
  const actions: MenuAction[] = !current
    ? []
    : [
        // Only where this viewer may seek, as the timeline is.
        ...(!current.endless &&
        playbackCapabilities(state, connected).seekable &&
        positionAt(clock) > fromStartAfter
          ? [
              {
                label: "From start",
                group: "play",
                disabled: !connected || !player.playbackId,
                run: () => void run({ type: "seek", playbackId: player.playbackId!, position: 0 }),
              },
            ]
          : []),
        ...(isRadio(current)
          ? station
            ? [
                (() => {
                  const favorite = stationSave(station);
                  return {
                    label: saveLabel(favorite.saved, "Saved"),
                    group: "keep",
                    pressed: favorite.saved,
                    disabled: favorite.disabled,
                    run: favorite.run,
                  };
                })(),
              ]
            : []
          : current.liveSourceId
            ? []
            : [saveAction({ ...save, disabled: !connected || save.disabled })]),
        ...homeAction(entryTarget(current), current),
        ...(current.liveSourceId
          ? []
          : [
              {
                label: "Details",
                group: "go",
                run: () => details.open(queueItemLocation(current), back),
              },
            ]),
        ...related,
        ...browserActions(page ?? station?.homepage, current.title),
      ];
  return (
    <ItemMenu
      menu={useItemMenu(actions)}
      title={current?.title ?? "What plays"}
      data-playing-menu
      size="icon-lg"
      className={className ?? "opacity-100"}
    />
  );
}
