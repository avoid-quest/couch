import { deviceId } from "@/session/device-id";
import { useMemo } from "react";
import { useSessionGate } from "@/session/session-context";
import { playbackControls } from "@/session/playback-controls";
import { showShare } from "@/sections/share/share-view";
import { useShell } from "@/sections/shell/shell-context";
import { leftLive } from "@/toasts";
import type { SearchHit } from "./SearchOnlineResults";
import { heldOutOf, liveTitle, type LiveSource } from "../../../shared/live-input";

/** What a shared source is, in a few words: "Screen with sound", "System audio", "Side A, track 3, Live audio". */
const sharedKind = (source: LiveSource) =>
  source.intent === "live"
    ? [source.metadata?.description, "Live audio"].filter(Boolean).join(", ")
    : source.video
      ? source.audio
        ? "Screen with sound"
        : "Screen"
      : source.kind === "system-audio"
        ? "System audio"
        : source.kind === "airplay"
          ? "AirPlay"
          : "Audio input";

/**
 * Active device inputs use the same search rows and playback actions as other sources. Each has one verb: Play, Join or
 * Leave for Live audio, and Open where it already plays here or on the device that shares it, which shows it in the
 * player.
 */
export function useLiveSourceHits(query: string): SearchHit[] {
  const { state, connected, run } = useSessionGate();
  const { selectPlayback, openPlayer } = useShell();
  return useMemo(
    () =>
      (state?.liveSources ?? [])
        .filter((source) =>
          [source.name, source.metadata?.title, source.metadata?.description].some((text) =>
            text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          ),
        )
        .map((source) => {
          const here = deviceId();
          const live = source.intent === "live";
          const mine = source.deviceId === here;
          // Where it plays on this device: a Playback of it with this device among its outputs. The one this device
          // controls says it through its controls: a listener there can Leave.
          const playback = state?.playbacks?.find(
            (item) =>
              item.liveSourceId === source.id &&
              item.outputs.some((output) => output.deviceId === here) &&
              (item.id !== state.playback || !live || playbackControls(state).leave),
          );
          const play = () => {
            void run({
              type: "playLive",
              sourceId: source.id,
              ...(live ? { deviceId: here } : {}),
            });
          };
          const primary = mine
            ? { label: "Open", disabled: false, run: () => showShare(true) }
            : live && playback
              ? {
                  label: "Leave",
                  disabled: !connected,
                  run: () =>
                    void run({ type: "leave", playbackId: playback.id }).then((done) => {
                      if (done) leftLive(liveTitle(source), play);
                    }),
                }
              : playback
                ? {
                    label: "Open",
                    disabled: !connected,
                    run: () => void selectPlayback(playback.id).then(() => openPlayer()),
                  }
                : { label: live ? "Join" : "Play", disabled: !connected, run: play };
          return {
            id: `live:${source.id}`,
            source: "Shared sources",
            title: liveTitle(source),
            meta: sharedKind(source),
            kind: "Stream",
            live: true,
            video: source.video,
            primary,
            actions: [
              { ...primary, group: "play" },
              {
                label: "Play on",
                group: "play",
                disabled: !connected,
                sharingDeviceId: heldOutOf(source),
                liveAudio: live,
                playOn: ({ deviceId }) => {
                  void run({ type: "playLive", sourceId: source.id, deviceId });
                },
              },
              ...(live
                ? []
                : [
                    {
                      label: "Play next",
                      group: "play",
                      disabled: !connected,
                      run: () => {
                        void run({
                          type: "playLive",
                          sourceId: source.id,
                          playNow: false,
                          placement: "next",
                        });
                      },
                    },
                    {
                      label: "Queue",
                      group: "play",
                      disabled: !connected,
                      run: () => {
                        void run({ type: "playLive", sourceId: source.id, playNow: false });
                      },
                    },
                  ]),
            ],
          };
        }),
    [state?.liveSources, state?.playbacks, connected, run, query, selectPlayback, openPlayer],
  );
}
