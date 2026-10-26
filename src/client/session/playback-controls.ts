import type { ClientSessionState } from "./session";

type State = ClientSessionState | null | undefined;
export const livePlayback = (state: State) => {
  const playback = state?.playbacks?.find(item => item.id === state.playback);
  return playback?.intent === "live" || state?.liveSources?.some(source => source.id === playback?.liveSourceId && source.intent === "live") === true;
};

// Core supplies actor-specific rights. Older sessions keep their ordinary controls.
export function playbackControls(state: Pick<ClientSessionState, "controls"> | null | undefined) {
  return state?.controls ?? { programme: true, queue: true, seek: true, speed: true, audioDelay: true, subtitleDelay: true, leave: false };
}
