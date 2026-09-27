import type { SessionGateValue } from "@/session/session-context";

type PlaybackSelection = Pick<SessionGateValue, "state" | "rendererTargetId" | "run">;

// HTTP source actions share the same first-play choice as WebSocket Play actions.
export async function selectPlaybackForPlay(session: PlaybackSelection | null) {
  if (!session?.state || session.state.deviceIds?.length || !session.rendererTargetId) return;
  if (!await session.run({ type: "assignDevices", deviceIds: [session.rendererTargetId] })) {
    throw new Error("Couldn't select this device for playback.");
  }
}
