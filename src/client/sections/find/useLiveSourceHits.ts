import { useMemo } from "react";
import { deviceId } from "@/session/device-id";
import { useSessionGate } from "@/session/session-context";
import type { SearchHit } from "./SearchOnlineResults";

/** Active device inputs use the same search rows and playback actions as other sources. */
export function useLiveSourceHits(query: string): SearchHit[] {
  const { state, connected, run } = useSessionGate();
  return useMemo(() => (state?.liveSources ?? [])
    .filter(source => source.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .map(source => {
      const excludeDeviceId = !source.video && source.kind !== "microphone" ? source.deviceId : undefined;
      const disabled = !connected || excludeDeviceId === (state?.controlling ?? deviceId());
      const play = () => { void run({ type: "playLive", sourceId: source.id }); };
      const label = source.video ? source.audio ? "Screen & audio" : "Screen without audio" : source.kind === "system-audio" ? "System audio" : "Audio input";
      return {
        id: `live:${source.id}`, source: "Shared sources", title: source.name, meta: label, kind: "Live", live: true, video: source.video,
        primary: { label: "Play", disabled, run: play },
        actions: [
          { label: "Play", disabled, run: play },
          { label: "Play on", disabled: !connected, excludeDeviceId, playOn: deviceId => { void run({ type: "playLive", sourceId: source.id, deviceId }); } },
          { label: "Play next", disabled: !connected, run: () => { void run({ type: "playLive", sourceId: source.id, playNow: false, placement: "next" }); } },
          { label: "Queue", disabled: !connected, run: () => { void run({ type: "playLive", sourceId: source.id, playNow: false }); } },
        ],
      };
    }), [state?.liveSources, state?.controlling, connected, run, query]);
}
