import { deviceId } from "@/session/device-id";
import { useMemo } from "react";
import { useSessionGate } from "@/session/session-context";
import type { SearchHit } from "./SearchOnlineResults";
import { liveTitle } from "../../../shared/live-input";

/** Active device inputs use the same search rows and playback actions as other sources. */
export function useLiveSourceHits(query: string): SearchHit[] {
  const { state, connected, run } = useSessionGate();
  return useMemo(() => (state?.liveSources ?? [])
    .filter(source => [source.name, source.metadata?.title, source.metadata?.description].some(text => text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .map(source => {
      // Play on the publisher, or while controlling it, waits in Where it plays to choose receivers.
      const live = source.intent === "live";
      const publisher = live && source.deviceId === deviceId();
      const disabled = !connected || publisher;
      const primary = publisher ? "Sharing" : live ? "Join" : "Play";
      const play = () => { void run({ type: "playLive", sourceId: source.id, ...live ? { deviceId: deviceId() } : {} }); };
      const label = source.video ? source.audio ? "Screen and audio" : "Screen without audio" : source.kind === "system-audio" ? "System audio" : source.kind === "airplay" ? "AirPlay" : "Audio input";
      const meta = live ? "Live audio" : label;
      return {
        id: `live:${source.id}`, source: "Shared sources", title: liveTitle(source), meta: source.metadata?.description || (source.name.endsWith(` · ${meta}`) ? "" : meta), kind: "Live", live: true, video: source.video,
        primary: { label: primary, disabled, run: play },
        actions: [
          { label: primary, disabled, run: play },
          { label: "Play on", disabled: !connected, sharingDeviceId: source.deviceId, liveAudio: live, playOn: deviceId => { void run({ type: "playLive", sourceId: source.id, deviceId }); } },
          ...live ? [] : [{ label: "Play next", disabled: !connected, run: () => { void run({ type: "playLive", sourceId: source.id, playNow: false, placement: "next" }); } },
          { label: "Queue", disabled: !connected, run: () => { void run({ type: "playLive", sourceId: source.id, playNow: false }); } }],
        ],
      };
    }), [state?.liveSources, connected, run, query]);
}
